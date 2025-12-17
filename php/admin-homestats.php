<?php
// php/home-dashboard-summary-admin.php
// Dashboard summary for department admin home
// (organizations + fees + event funds, filtered by orgs/events the admin handles)

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
session_start();

try {
    require __DIR__ . '/database.php';

    if (!isset($pdo)) {
        throw new RuntimeException('DB connection not available');
    }

    // --- Auth: require a logged-in admin with department in session ---
    if (empty($_SESSION['id_number']) || empty($_SESSION['role'])) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'error'   => 'Not authenticated.',
        ]);
        exit;
    }

    $role       = strtolower((string)$_SESSION['role']);
    $department = trim((string)($_SESSION['department'] ?? ''));
    $adminId    = trim((string)$_SESSION['id_number']); // current admin id_number

    if ($role !== 'admin' && $role !== 'treasurer') {
        http_response_code(403);
        echo json_encode([
            'success' => false,
            'error'   => 'Access denied. Admin only.',
        ]);
        exit;
    }

    if ($department === '') {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error'   => 'Department not set for this admin account.',
        ]);
        exit;
    }

    // --- Determine current academic year ---
    $stmt = $pdo->query(
        "SELECT start_year, end_year, active_year
         FROM academic_years
         WHERE status = 'Active'
         ORDER BY id DESC
         LIMIT 1"
    );
    $ayRow = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$ayRow) {
        // Fallback: last row if no 'Active'
        $stmt2 = $pdo->query(
            "SELECT start_year, end_year, active_year
             FROM academic_years
             ORDER BY id DESC
             LIMIT 1"
        );
        $ayRow = $stmt2->fetch(PDO::FETCH_ASSOC);
    }

    if (!$ayRow) {
        echo json_encode([
            'success' => false,
            'error'   => 'No academic year configured.',
        ]);
        exit;
    }

    $sy = (int)$ayRow['start_year'];
    $ey = (int)$ayRow['end_year'];
    $ay = (int)$ayRow['active_year'];
    $schoolYearText = sprintf('%d-%d', $sy, $ey);

    // Semester label
    $semesterLabel = null;
    if ($ay === $sy) {
        $semesterLabel = '1st Semester';
    } elseif ($ay === $ey) {
        $semesterLabel = '2nd Semester';
    }

    // -----------------------------------------------------------------
    // Organizations + total collected fees
    // Admin sees:
    //   - ONLY orgs they handle (admin_id_number or authors_id_number)
    //   - OR orgs where they are treasurer (in organization_fees.treasurer_id_number)
    //   - If org.scope = 'exclusive'  -> also require course_abbr = admin's dept
    //   - If org.scope = 'general'    -> department does NOT matter
    // -----------------------------------------------------------------
    $orgSql = "
        SELECT
            o.id              AS org_id,
            o.name            AS org_name,
            o.abbreviation    AS org_abbr,
            o.scope           AS org_scope,
            o.course_abbr     AS course_abbr,
            o.status          AS org_status,
            COALESCE(SUM(p.paid_amount), 0) AS total_collected
        FROM organizations o
        LEFT JOIN organization_fees f
            ON f.org_id      = o.id
           AND f.start_year  = :sy
           AND f.end_year    = :ey
        LEFT JOIN organization_fee_payments p
            ON p.org_fee_id  = f.id
           AND p.status      = 'confirmed'
           AND p.start_year  = :sy
           AND p.end_year    = :ey
           AND p.active_year = :ay
        WHERE o.start_year   = :sy
          AND o.end_year     = :ey
          AND (
                -- EXCLUSIVE orgs: must match admin's department
                (o.scope = 'exclusive' AND o.course_abbr = :dept)
                -- GENERAL orgs: department does NOT matter
                OR (o.scope = 'general')
          )
          AND (
                -- User is admin or author of the organization
                o.admin_id_number   = :adminId
             OR o.authors_id_number = :adminId
             -- OR user is treasurer for this organization (from organization_fees table)
             OR EXISTS (
                 SELECT 1 FROM organization_fees f2
                 WHERE f2.org_id = o.id
                   AND f2.start_year = :sy
                   AND f2.end_year = :ey
                   AND f2.treasurer_id_number = :adminId
             )
          )
        GROUP BY
            o.id, o.name, o.abbreviation, o.scope,
            o.course_abbr, o.status
        ORDER BY o.name ASC, o.abbreviation ASC
    ";

    $stmtOrg = $pdo->prepare($orgSql);
    $stmtOrg->execute([
        ':sy'      => $sy,
        ':ey'      => $ey,
        ':ay'      => $ay,
        ':dept'    => $department,
        ':adminId' => $adminId,
    ]);

    $orgRows = [];
    $activeOrgCount    = 0;
    $totalOrgCollected = 0.0;

    while ($row = $stmtOrg->fetch(PDO::FETCH_ASSOC)) {
        $total  = (float)$row['total_collected'];
        $status = (string)$row['org_status'];

        if ($status === 'Accredited' || $status === 'Reaccredited') {
            $activeOrgCount++;
        }
        $totalOrgCollected += $total;

        $orgRows[] = [
            'org_id'          => (int)$row['org_id'],
            'name'            => $row['org_name'],
            'abbreviation'    => $row['org_abbr'],
            'scope'           => $row['org_scope'],
            'course_abbr'     => $row['course_abbr'],
            'status'          => $status,
            'total_collected' => $total,
        ];
    }

    // -----------------------------------------------------------------
    // Event funds (credits vs debits)
    //
    // For events linked to an org:
    //   - If org.scope = 'exclusive' -> org.course_abbr must match admin's dept
    //   - If org.scope = 'general'   -> department does NOT matter
    //   - In both cases: admin must handle the org (admin/author OR treasurer)
    //
    // For events with NO org (organization_abbr NULL):
    //   - Show only if authored by this admin (author_id_number = adminId)
    // -----------------------------------------------------------------
    $evSql = "
        SELECT
            e.id,
            e.title,
            e.scope,
            e.location,
            e.organization_abbr,
            e.start_year,
            e.end_year,
            e.active_year,
            e.status,
            e.author_id_number,
            e.created_at,
            e.updated_at,
            org.id           AS org_id,
            org.name         AS org_name,
            org.abbreviation AS org_abbr,
            org.course_abbr  AS org_course_abbr,
            org.scope        AS org_scope,
            org.admin_id_number,
            org.authors_id_number
        FROM event_events e
        LEFT JOIN organizations org
          ON org.abbreviation = e.organization_abbr
         AND org.start_year   = e.start_year
         AND org.end_year     = e.end_year
        WHERE e.start_year = :sy
          AND e.end_year   = :ey
          AND e.active_year = :ay
          AND (
                -- Events tied to an org the admin handles
                (
                    org.id IS NOT NULL
                    AND (
                          -- Exclusive org: must match department
                          (org.scope = 'exclusive' AND org.course_abbr = :dept)
                          -- General org: ignore department
                          OR (org.scope = 'general')
                    )
                    AND (
                          -- User is admin or author of the organization
                          org.admin_id_number   = :adminId
                       OR org.authors_id_number = :adminId
                       -- OR user is treasurer for this organization
                       OR EXISTS (
                           SELECT 1 FROM organization_fees f
                           WHERE f.org_id = org.id
                             AND f.start_year = :sy
                             AND f.end_year = :ey
                             AND f.treasurer_id_number = :adminId
                       )
                    )
                )
                -- Pure general events with no org: only if this admin is the author
                OR (
                    org.id IS NULL
                    AND e.author_id_number = :adminId
                )
          )
        ORDER BY e.created_at DESC, e.id DESC
    ";

    $stmtEv = $pdo->prepare($evSql);
    $stmtEv->execute([
        ':sy'      => $sy,
        ':ey'      => $ey,
        ':ay'      => $ay,
        ':dept'    => $department,
        ':adminId' => $adminId,
    ]);

    $eventRows = [];
    $totalEventCredits = 0.0;
    $totalEventDebits  = 0.0;

    while ($ev = $stmtEv->fetch(PDO::FETCH_ASSOC)) {
        $eventId = (int)$ev['id'];

        // Sum credits
        $stmtC = $pdo->prepare(
            "SELECT COALESCE(SUM(amount), 0) AS total
             FROM event_credits
             WHERE event_id = :id"
        );
        $stmtC->execute([':id' => $eventId]);
        $creditsTotal = (float)$stmtC->fetchColumn();

        // Sum debits
        $stmtD = $pdo->prepare(
            "SELECT COALESCE(SUM(amount), 0) AS total
             FROM event_debits
             WHERE event_id = :id"
        );
        $stmtD->execute([':id' => $eventId]);
        $debitsTotal = (float)$stmtD->fetchColumn();

        // Skip completely empty events if you like
        if ($creditsTotal == 0.0 && $debitsTotal == 0.0) {
            continue;
        }

        $totalEventCredits += $creditsTotal;
        $totalEventDebits  += $debitsTotal;

        // Label
        $orgLabel = 'General (No Org Linked)';
        if (!empty($ev['org_id'])) {
            if (!empty($ev['org_name'])) {
                $orgLabel = $ev['org_name'];
            } elseif (!empty($ev['org_abbr'])) {
                $orgLabel = $ev['org_abbr'];
            } else {
                $orgLabel = 'Organization';
            }
        }

        $eventRows[] = [
            'id'            => $eventId,
            'title'         => $ev['title'],
            'org_label'     => $orgLabel,
            'scope'         => $ev['scope'],
            'location'      => $ev['location'],
            'start_year'    => (int)$ev['start_year'],
            'end_year'      => (int)$ev['end_year'],
            'active_year'   => (int)$ev['active_year'],
            'status'        => $ev['status'],
            'created_at'    => $ev['created_at'],
            'total_credits' => $creditsTotal,
            'total_debits'  => $debitsTotal,
        ];
    }

    // Limit events for chart (top N by absolute funds)
    usort($eventRows, function (array $a, array $b): int {
        $aTotal = abs($a['total_credits']) + abs($a['total_debits']);
        $bTotal = abs($b['total_credits']) + abs($b['total_debits']);
        return $bTotal <=> $aTotal;
    });
    $eventRowsForChart = array_slice($eventRows, 0, 7);

    // Final JSON
    echo json_encode([
        'success' => true,
        'academic_year' => [
            'start_year'     => $sy,
            'end_year'       => $ey,
            'active_year'    => $ay,
            'school_year'    => $schoolYearText,
            'semester_label' => $semesterLabel,
        ],
        'cards' => [
            'active_organizations' => $activeOrgCount,
            'total_org_fees'       => $totalOrgCollected,
            'total_event_credits'  => $totalEventCredits,
            'total_event_debits'   => $totalEventDebits,
        ],
        'org_fees' => $orgRows,
        'events'   => $eventRowsForChart,
    ], JSON_PRETTY_PRINT);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error'   => 'Internal server error.',
        'details' => $e->getMessage(),
    ]);
}