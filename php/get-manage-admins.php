<?php
// php/get-manage-admins.php
header('Content-Type: application/json');
ini_set('display_errors', '1');
error_reporting(E_ALL);

try {
    require __DIR__ . '/database.php';

    // Fetch all staff admins (including treasurers or special-admins)
    $sql = "
        SELECT 
            id,
            id_number,
            first_name,
            middle_name,
            last_name,
            suffix,
            email,
            role,
            status,
            department
        FROM users
        WHERE user_type = 'staff'
          AND status = 'Active'
          AND role IN ('admin', 'super-admin', 'special-admin', 'treasurer')
          AND id <> 1
        ORDER BY id DESC
    ";

    $stmt = $pdo->query($sql);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Build full_name dynamically for UI compatibility
    foreach ($rows as &$u) {
        $parts = [];

        if (!empty($u['first_name']))  $parts[] = $u['first_name'];
        if (!empty($u['middle_name'])) $parts[] = $u['middle_name'];
        if (!empty($u['last_name']))   $parts[] = $u['last_name'];

        $full = trim(implode(' ', $parts));
        if (!empty($u['suffix'])) {
            $full .= ' ' . trim($u['suffix']);
        }

        $u['full_name'] = trim($full);
    }
    unset($u); // safety

    echo json_encode($rows);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'error'  => 'DB error',
        'detail' => $e->getMessage()
    ]);
}
