<?php
// php/home-dashboard-summary.php
// Dashboard summary for super-admin home (organizations + fees + event funds)

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
session_start();

try {
    require __DIR__ . '/database.php';

    if (!isset($pdo)) {
        throw new RuntimeException('DB connection not available');
    }

    // --- Auth: require a logged-in super-admin (id_number + role in session) ---
    if (empty($_SESSION['id_number']) || empty($_SESSION['role'])) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'error'   => 'Not authenticated.',
        ]);
        exit;
    }

    $role = strtolower((string)$_SESSION['role']);
    if ($role !== 'super-admin' && $role !== 'special-admin') {
        http_response_code(403);
        echo json_encode([
            'success' => false,
            'error'   => 'Access denied. Super-admin only.',
        ]);
        exit;
    }

    // --- Determine current academic year (same logic style as your other scripts) ---
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

    // Semester label (like in your JS helpers)
    $semesterLabel = null;
    if ($ay === $sy) {
        $semesterLabel = '1st Semester';
    } elseif ($ay === $ey) {
        $semesterLabel = '2nd Semester';
    }

    // ---------------- Organizations + total collected fees ----------------
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
        GROUP BY
            o.id, o.name, o.abbreviation, o.scope,
            o.course_abbr, o.status
        ORDER BY total_collected DESC, o.abbreviation ASC
    ";

    $stmtOrg = $pdo->prepare($orgSql);
    $stmtOrg->execute([
        ':sy' => $sy,
        ':ey' => $ey,
        ':ay' => $ay,
    ]);

    $orgRows = [];
    $activeOrgCount = 0;
    $totalOrgCollected = 0.0;

    while ($row = $stmtOrg->fetch(PDO::FETCH_ASSOC)) {
        $total  = (float)$row['total_collected'];
        $status = (string)$row['org_status'];

        if ($status === 'Accredited' || $status === 'Reaccredited') {
            $activeOrgCount++;
        }
        $totalOrgCollected += $total;

        $orgRows[] = [
            'org_id'         => (int)$row['org_id'],
            'name'           => $row['org_name'],
            'abbreviation'   => $row['org_abbr'],
            'scope'          => $row['org_scope'],
            'course_abbr'    => $row['course_abbr'],
            'status'         => $status,
            'total_collected'=> $total,
        ];
    }

    // ---------------- Event funds (credits vs debits) ----------------
    // 1) Pull events for current AY + link to organization label
    $evSql = "
        SELECT
            e.id,
            e.title,
            e.scope,
            e.organization_abbr,
            e.start_year,
            e.end_year,
            e.active_year,
            e.status,
            e.created_at,
            org.name         AS org_name,
            org.abbreviation AS org_abbr
        FROM event_events e
        LEFT JOIN organizations org
          ON org.abbreviation = e.organization_abbr
        WHERE e.start_year = :sy
          AND e.end_year   = :ey
          AND e.active_year = :ay
        ORDER BY e.created_at DESC, e.id DESC
    ";
    $stmtEv = $pdo->prepare($evSql);
    $stmtEv->execute([
        ':sy' => $sy,
        ':ey' => $ey,
        ':ay' => $ay,
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

        $orgLabel = 'General (Campus-Wide)';
        if ($ev['scope'] === 'organization') {
            if (!empty($ev['org_name'])) {
                $orgLabel = $ev['org_name'];
            } elseif (!empty($ev['org_abbr'])) {
                $orgLabel = $ev['org_abbr'];
            } else {
                $orgLabel = 'Organization';
            }
        }

        $eventRows[] = [
            'id'           => $eventId,
            'title'        => $ev['title'],
            'org_label'    => $orgLabel,
            'scope'        => $ev['scope'],
            'start_year'   => (int)$ev['start_year'],
            'end_year'     => (int)$ev['end_year'],
            'active_year'  => (int)$ev['active_year'],
            'status'       => $ev['status'],
            'created_at'   => $ev['created_at'],
            'total_credits'=> $creditsTotal,
            'total_debits' => $debitsTotal,
        ];
    }

    // Limit events for chart (top N by absolute funds)
    usort($eventRows, function(array $a, array $b): int {
        $aTotal = abs($a['total_credits']) + abs($a['total_debits']);
        $bTotal = abs($b['total_credits']) + abs($b['total_debits']);
        return $bTotal <=> $aTotal;
    });
    $eventRowsForChart = array_slice($eventRows, 0, 7);

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
