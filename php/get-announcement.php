<?php
// php/get-announcement.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors', '1'); 
error_reporting(E_ALL);
session_start();

try {
    require __DIR__ . '/database.php';
    if (!isset($pdo)) throw new Exception('Database connection not available.');

    if (empty($_SESSION['id_number'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);
        exit;
    }

    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid announcement ID']);
        exit;
    }

    $currentUser = $_SESSION['id_number'];

    // Normalize role
    $rawRole = trim((string)($_SESSION['role'] ?? ''));
    $normalizedRole = strtolower(str_replace([' ', '_'], '-', $rawRole));
    $isSuperAdmin =
        $normalizedRole === 'super-admin' ||
        $normalizedRole === 'superadmin' ||
        (strpos($normalizedRole, 'super') !== false && strpos($normalizedRole, 'admin') !== false);
    
    $isSpecialAdmin =
        $normalizedRole === 'special-admin' ||
        $normalizedRole === 'specialadmin' ||
        (strpos($normalizedRole, 'special') !== false && strpos($normalizedRole, 'admin') !== false);    

    // Fetch announcement with NEW author full name
    $stmt = $pdo->prepare("
    SELECT 
        a.*,

        -- Build readable full name from updated schema (NULL-safe)
        TRIM(CONCAT_WS(' ',
            NULLIF(u.first_name, ''),
            NULLIF(u.middle_name, ''),
            NULLIF(u.last_name, ''),
            NULLIF(u.suffix, '')
        )) AS author_name,

        u.profile_picture AS author_picture

    FROM announcements a
    LEFT JOIN users u ON u.id_number = a.author_id
    WHERE a.id = :id
    LIMIT 1
    ");


    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Announcement not found']);
        exit;
    }

    // Access control for editing
    $isAuthor = ($row['author_id'] === $currentUser);

    if ($isAuthor || $isSuperAdmin || $isSpecialAdmin) {
        $row['edit_allowed'] = true;
    } else {
        $row['edit_allowed'] = false;
    }

    echo json_encode([
        'success' => true,
        'announcement' => $row
    ], JSON_UNESCAPED_UNICODE);
    exit;

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Server error',
        'detail' => $e->getMessage()
    ]);
    exit;
}
