<?php
// php/add-admin.php
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

  // Required - split names
  $first_name  = trim($in['first_name'] ?? '');
  $middle_name = trim($in['middle_name'] ?? '');
  $last_name   = trim($in['last_name'] ?? '');
  $suffix      = trim($in['suffix'] ?? '');
  
  $id_number = trim($in['id_number'] ?? '');
  $status    = $in['status'] ?? 'Inactive';
  $department = trim($in['department'] ?? ''); // Can be empty for "None"

  if ($first_name === '' || $last_name === '' || $id_number === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'First name, last name and ID number are required.']);
    exit;
  }
  
  if (!in_array($status, ['Active','Inactive','Unlisted'], true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid status.']);
    exit;
  }

  // Optional
  $email = trim($in['email'] ?? '');

  // If department is provided (not empty), validate it exists and is Active
  if ($department !== '') {
    $stmt = $pdo->prepare("SELECT id FROM courses WHERE abbreviation = ? AND status = 'Active' LIMIT 1");
    $stmt->execute([$department]);
    if (!$stmt->fetch(PDO::FETCH_ASSOC)) {
      http_response_code(400);
      echo json_encode(['success' => false, 'message' => 'Selected course is invalid or not active.']);
      exit;
    }
  }

  // Uniqueness of id_number
  $stmt = $pdo->prepare("SELECT id FROM users WHERE id_number = ? LIMIT 1");
  $stmt->execute([$id_number]);
  if ($stmt->fetch(PDO::FETCH_ASSOC)) {
    http_response_code(409);
    echo json_encode(['success' => false, 'message' => 'ID Number already exists.']);
    exit;
  }

  // Defaults enforced for Admin creation
  $user_type = 'staff';
  $role      = 'admin';
  $password_hash = password_hash($id_number, PASSWORD_BCRYPT);

  // Handle department - empty string becomes null
  $db_department = ($department !== '') ? $department : null;

  $stmt = $pdo->prepare("
    INSERT INTO users
      (id_number, first_name, middle_name, last_name, suffix, password, user_type, role, department, status, email, created_at)
    VALUES
      (:id_number, :first_name, :middle_name, :last_name, :suffix, :password, :user_type, :role, :department, :status, :email, NOW())
  ");
  $stmt->execute([
    ':id_number'   => $id_number,
    ':first_name'  => $first_name,
    ':middle_name' => $middle_name !== '' ? $middle_name : null,
    ':last_name'   => $last_name,
    ':suffix'      => $suffix !== '' ? $suffix : null,
    ':password'    => $password_hash,
    ':user_type'   => $user_type,
    ':role'        => $role,
    ':department'  => $db_department,
    ':status'      => $status,
    ':email'       => ($email !== '' ? $email : null),
  ]);

  echo json_encode(['success' => true, 'id' => $pdo->lastInsertId()]);
  
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['success' => false, 'message' => 'Server error']);
}