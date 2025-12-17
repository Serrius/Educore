<?php
// php/get-active-academic-year-row.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors', '1');
error_reporting(E_ALL);
session_start();

try {
    require __DIR__ . '/database.php';
    if (!isset($pdo)) {
        throw new Exception('Database not available');
    }

    // Optional: require login (same pattern as others)
    if (empty($_SESSION['id_number'])) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'message' => 'Not authenticated'
        ]);
        exit;
    }

    // Get the single active academic year row
    $stmt = $pdo->prepare("
        SELECT id, start_year, end_year, active_year, status, created_at
        FROM academic_years
        WHERE status = 'Active'
        ORDER BY id DESC
        LIMIT 1
    ");
    $stmt->execute();
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'message' => 'No active academic year found'
        ]);
        exit;
    }

    // Build a friendly school_year string too (e.g. "2025-2026")
    $schoolYear = $row['start_year'] . '-' . $row['end_year'];

    echo json_encode([
        'success'      => true,
        'id'           => (int)$row['id'],
        'start_year'   => (int)$row['start_year'],
        'end_year'     => (int)$row['end_year'],
        'active_year'  => (int)$row['active_year'],
        'status'       => $row['status'],
        'created_at'   => $row['created_at'],
        'school_year'  => $schoolYear
    ]);
    exit;

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Server error',
        'detail'  => $e->getMessage()
    ]);
    exit;
}
