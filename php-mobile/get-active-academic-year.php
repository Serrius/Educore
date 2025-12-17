<?php
// get-active-academic-year.php
header('Content-Type: application/json');

require __DIR__ . '/database.php';

try {
    // 1) Try to get the row where status = 'Active'
    $stmt = $pdo->query("
        SELECT start_year, end_year, active_year, status
        FROM academic_years
        WHERE status = 'Active'
        ORDER BY id DESC
        LIMIT 1
    ");

    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $source = 'active_status';

    // 2) If no active row, fall back to the latest row in the table
    if (!$row) {
        $stmt = $pdo->query("
            SELECT start_year, end_year, active_year, status
            FROM academic_years
            ORDER BY id DESC
            LIMIT 1
        ");
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $source = 'latest_row';
    }

    if ($row) {
        $startYear   = (string)$row['start_year'];
        $endYear     = (string)$row['end_year'];
        $activeYear  = isset($row['active_year']) ? (string)$row['active_year'] : null;
        $status      = (string)$row['status'];

        echo json_encode([
            'success'      => true,
            'school_year'  => $startYear . '-' . $endYear, // e.g. "2025-2026"
            'active_year'  => $activeYear,                 // e.g. "2025"
            'status'       => $status,                     // "Active" / "Closed"
            'source'       => $source                      // "active_status" or "latest_row"
        ]);
    } else {
        // No rows at all in academic_years
        echo json_encode([
            'success'      => false,
            'school_year'  => null,
            'active_year'  => null,
            'message'      => 'No academic year records found.'
        ]);
    }

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error'   => 'DB error',
        'detail'  => $e->getMessage()
    ]);
}
