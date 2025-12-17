<?php
// php/update-admin.php
header('Content-Type: application/json');
ini_set('display_errors', '1');
error_reporting(E_ALL);

try {
    require __DIR__ . '/database.php';

    $in_raw = file_get_contents('php://input');
    $in = json_decode($in_raw, true);
    if (!is_array($in)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON payload.']);
        exit;
    }

    $id = $in['id'] ?? null;
    if (!$id || !ctype_digit((string)$id)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Missing or invalid id.']);
        exit;
    }

    $allowed_status = ['Active', 'Inactive', 'Unlisted'];

    // Split name fields
    $first_name  = trim($in['first_name'] ?? '');
    $middle_name = trim($in['middle_name'] ?? '');
    $last_name   = trim($in['last_name'] ?? '');
    $suffix      = trim($in['suffix'] ?? '');

    $id_number = trim($in['id_number'] ?? '');
    $email     = trim($in['email'] ?? '');
    $department = trim($in['department'] ?? '');
    $status    = $in['status'] ?? null;

    if ($status && !in_array($status, $allowed_status, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid status.']);
        exit;
    }

    if ((int)$id === 1) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Editing super-admin is not allowed.']);
        exit;
    }

    // Load existing
    $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ? LIMIT 1");
    $stmt->execute([$id]);
    $existing = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$existing) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'User not found.']);
        exit;
    }
    
    if ($existing['role'] === 'super-admin') {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Editing super-admin is not allowed.']);
        exit;
    }

    // Validate required name fields if provided
    if ($first_name !== '' && $last_name === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Last name is required when providing first name.']);
        exit;
    }
    
    if ($last_name !== '' && $first_name === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'First name is required when providing last name.']);
        exit;
    }

    // Unique id_number
    if ($id_number !== '' && $id_number !== (string)$existing['id_number']) {
        $chk = $pdo->prepare("SELECT id FROM users WHERE id_number = ? AND id <> ?");
        $chk->execute([$id_number, $id]);
        if ($chk->fetch()) {
            http_response_code(409);
            echo json_encode(['success' => false, 'message' => 'ID Number already taken by another user.']);
            exit;
        }
    }

    // Build dynamic update
    $fields = [];
    $vals   = [];
    $add = function($col, $val) use (&$fields, &$vals) {
        $fields[] = "`$col` = ?";
        $vals[] = $val;
    };

    $add('first_name',  $first_name !== '' ? $first_name : null);
    $add('middle_name', $middle_name !== '' ? $middle_name : null);
    $add('last_name',   $last_name !== '' ? $last_name : null);
    $add('suffix',      $suffix !== '' ? $suffix : null);

    $add('id_number', $id_number !== '' ? $id_number : null);
    $add('email',     $email !== '' ? $email : null);

    // FIXED: Always include department, even if empty (null)
    $add('department', $department !== '' ? $department : null);

    if ($status !== null) {
        $add('status', $status);
    }

    // Enforce role/user_type
    $add('role', 'admin');
    $add('user_type', 'staff');

    if (empty($fields)) {
        echo json_encode(['success'=>true,'message'=>'No changes.']);
        exit;
    }

    $sql = "UPDATE users SET ".implode(', ', $fields)." WHERE id = ? AND role <> 'super-admin'";
    $vals[] = $id;

    $stmt = $pdo->prepare($sql);
    $stmt->execute($vals);

    echo json_encode(['success'=>true,'updated'=>$stmt->rowCount()]);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Server error']);
}