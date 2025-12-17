<?php
// php/get-organization.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors', '1');
error_reporting(E_ALL);
session_start();

try {
    require __DIR__ . '/database.php';
    if (!isset($pdo)) {
        throw new Exception('DB connection not available');
    }

    // Require login
    if (empty($_SESSION['id_number'])) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'message' => 'Not authenticated',
        ]);
        exit;
    }

    $orgId = isset($_GET['id']) ? (int)$_GET['id'] : 0;
    if ($orgId <= 0) {
        http_response_code(422);
        echo json_encode([
            'success' => false,
            'message' => 'Invalid organization id.',
        ]);
        exit;
    }

    // ========= Fetch organization + admin full name =========
    $sqlOrg = "
        SELECT 
            o.id,
            o.name,
            o.abbreviation,
            o.logo_path,
            o.scope,
            o.application_type,
            o.course_abbr,
            o.authors_id_number,
            o.admin_id_number,
            o.status,
            o.active_year,
            o.start_year,
            o.end_year,
            o.created_at,

            -- admin full name for the JS (admin_full_name)
            CONCAT(
                u.first_name,
                CASE 
                    WHEN u.middle_name IS NOT NULL AND u.middle_name <> '' 
                        THEN CONCAT(' ', u.middle_name)
                    ELSE ''
                END,
                ' ',
                u.last_name,
                CASE 
                    WHEN u.suffix IS NOT NULL AND u.suffix <> '' 
                        THEN CONCAT(' ', u.suffix)
                    ELSE ''
                END
            ) AS admin_full_name,

            u.role       AS admin_role,
            u.department AS admin_department,
            u.email      AS admin_email
        FROM organizations o
        LEFT JOIN users u
            ON u.id_number = o.admin_id_number
        WHERE o.id = ?
        LIMIT 1
    ";

    $stmt = $pdo->prepare($sqlOrg);
    $stmt->execute([$orgId]);
    $org = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$org) {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'message' => 'Organization not found.',
        ]);
        exit;
    }

    // ========= Get currently ACTIVE academic year (if any) =========
    $activeAy = null;

    $sqlAY = "
        SELECT start_year, end_year, active_year
        FROM academic_years
        WHERE status = 'Active'
        ORDER BY id DESC
        LIMIT 1
    ";
    $ayStmt = $pdo->query($sqlAY);
    $ayRow  = $ayStmt ? $ayStmt->fetch(PDO::FETCH_ASSOC) : false;

    if ($ayRow) {
        $activeAy = [
            'start_year'  => (int)$ayRow['start_year'],
            'end_year'    => (int)$ayRow['end_year'],
            'active_year' => (int)$ayRow['active_year'],
        ];
    }

    // ========= Fetch accreditation files for this organization =========
    // **IMPORTANT FIX: Use the organization's own academic year span, not the active academic year**
    // This ensures we show files from the organization's specific accreditation period
    $sqlFiles = "
        SELECT 
            id,
            org_id,
            doc_group,
            doc_type,
            file_path,
            active_year,
            start_year,
            end_year,
            status,
            reason,
            uploaded_by,
            created_at
        FROM accreditation_files
        WHERE org_id = :org_id
          AND start_year = :org_start_year
          AND end_year = :org_end_year
        ORDER BY doc_group, doc_type, id
    ";

    $stmtFiles = $pdo->prepare($sqlFiles);
    $stmtFiles->execute([
        ':org_id' => $orgId,
        ':org_start_year' => $org['start_year'],
        ':org_end_year' => $org['end_year']
    ]);
    $files = $stmtFiles->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success'     => true,
        'org'         => $org,
        'files'       => $files,
        'active_ay'   => $activeAy,
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Server error: ' . $e->getMessage(),
    ]);
}