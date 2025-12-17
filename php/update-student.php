<?php
// php/update-student.php
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

    // Required id
    $id = $in['id'] ?? null;
    if (!$id || !ctype_digit((string)$id)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid or missing id.']);
        exit;
    }

    $allowed_status = ['Active', 'Inactive', 'Unlisted'];
    $allowed_roles  = ['non-admin','admin','super-admin','special-admin','treasurer'];

    // Split name fields
    $first_name  = trim($in['first_name'] ?? '');
    $middle_name = trim($in['middle_name'] ?? '');
    $last_name   = trim($in['last_name'] ?? '');
    $suffix      = trim($in['suffix'] ?? '');

    $id_number   = trim($in['id_number'] ?? '');
    $email       = trim($in['email'] ?? '');
    $department  = trim($in['department'] ?? '');
    $year        = trim($in['year'] ?? '');
    $status      = $in['status'] ?? null;
    $role        = $in['role'] ?? 'non-admin';

    if ($status && !in_array($status, $allowed_status, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid status provided.']);
        exit;
    }

    if ($role && !in_array($role, $allowed_roles, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid role provided.']);
        exit;
    }

    if ((int)$id === 1) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Editing super-admin user is not allowed.']);
        exit;
    }

    // Load existing student
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
        echo json_encode(['success' => false, 'message' => 'Editing super-admin user is not allowed.']);
        exit;
    }

    // Ensure unique ID number
    if ($id_number !== '' && $id_number !== (string)$existing['id_number']) {
        $stmt = $pdo->prepare("SELECT id FROM users WHERE id_number = ? AND id <> ?");
        $stmt->execute([$id_number, $id]);
        if ($stmt->fetch()) {
            http_response_code(409);
            echo json_encode(['success' => false, 'message' => 'ID Number already in use.']);
            exit;
        }
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

    // Resolve department → abbreviation
    if ($department !== '') {
        $stmt = $pdo->prepare("SELECT abbreviation FROM courses WHERE course_name = ? OR abbreviation = ? LIMIT 1");
        $stmt->execute([$department, $department]);
        $found = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$found) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid department/course.']);
            exit;
        }
        $deptAbbr = $found['abbreviation'];
    } else {
        $deptAbbr = $existing['department'];
    }

    // Handle school year logic
    if ($status === 'Active') {
        $ay = $pdo->query("SELECT start_year, end_year FROM academic_years WHERE status='Active' ORDER BY id DESC LIMIT 1")
                  ->fetch(PDO::FETCH_ASSOC);
        $school_year = $ay ? ($ay['start_year']."-".$ay['end_year']) : null;
    } else {
        $school_year = trim($in['school_year'] ?? '') ?: null;
    }

    // Build dynamic update
    $fields = [];
    $vals   = [];
    $add = function($col, $val) use (&$fields, &$vals) {
        if ($val !== null) { $fields[] = "`$col` = ?"; $vals[] = $val; }
    };

    $add('first_name',  $first_name !== '' ? $first_name : null);
    $add('middle_name', $middle_name !== '' ? $middle_name : null);
    $add('last_name',   $last_name !== '' ? $last_name : null);
    $add('suffix',      $suffix !== '' ? $suffix : null);

    $add('id_number', $id_number !== '' ? $id_number : null);
    $add('email',     $email !== '' ? $email : null);

    $add('department',  $deptAbbr);
    $add('year',        $year !== '' ? $year : null);
    $add('status',      $status);
    $add('role',        $role);
    $add('school_year', $school_year);
    $add('user_type',   'student');

    if (empty($fields)) {
        echo json_encode(['success' => true, 'message' => 'No changes.']);
        exit;
    }

    $sql = "UPDATE users SET ".implode(', ', $fields)." WHERE id = ? AND id <> 1";
    $vals[] = $id;

    $stmt = $pdo->prepare($sql);
    $stmt->execute($vals);

    echo json_encode(['success' => true, 'updated' => $stmt->rowCount()]);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Server error']);
}