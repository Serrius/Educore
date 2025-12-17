<?php
// php/add-student.php
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

  // Required minimal fields - split names
  $first_name  = trim($in['first_name'] ?? '');
  $middle_name = trim($in['middle_name'] ?? '');
  $last_name   = trim($in['last_name'] ?? '');
  $suffix      = trim($in['suffix'] ?? '');
  
  $id_number  = trim($in['id_number'] ?? '');
  $email      = trim($in['email'] ?? '');
  $department = trim($in['department'] ?? '');
  $year       = trim($in['year'] ?? '');
  $status     = $in['status'] ?? 'Inactive';
  $role       = $in['role'] ?? 'non-admin';
  $user_type  = 'student';
  $password   = $in['password'] ?? '';

  $allowed_status = ['Active','Inactive','Unlisted'];
  $allowed_roles  = ['non-admin','admin','super-admin','special-admin','treasurer'];

  if ($first_name === '' || $last_name === '' || $id_number === '' || $department === '' || $year === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Missing required fields (first_name, last_name, id_number, department, year).']);
    exit;
  }
  
  if (!in_array($status, $allowed_status, true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid status.']);
    exit;
  }
  
  if (!in_array($role, $allowed_roles, true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid role.']);
    exit;
  }

  // Prevent creating super-admins via this endpoint
  if ($role === 'super-admin') {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Cannot create super-admin here.']);
    exit;
  }

  // ID number must be unique
  $stmt = $pdo->prepare("SELECT id FROM users WHERE id_number = ? LIMIT 1");
  $stmt->execute([$id_number]);
  if ($stmt->fetch(PDO::FETCH_ASSOC)) {
    http_response_code(409);
    echo json_encode(['success' => false, 'message' => 'ID Number already in use by another user.']);
    exit;
  }

  // Resolve department to abbreviation
  $stmt = $pdo->prepare("SELECT abbreviation FROM courses WHERE course_name = ? OR abbreviation = ? LIMIT 1");
  $stmt->execute([$department, $department]);
  $course = $stmt->fetch(PDO::FETCH_ASSOC);
  if (!$course) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid course/department.']);
    exit;
  }
  $deptAbbr = $course['abbreviation'];

  // Treasurer uniqueness (per dept, excluding Unlisted)
  if ($role === 'treasurer') {
    $stmt = $pdo->prepare("
      SELECT id FROM users
       WHERE role = 'treasurer'
         AND department = ?
         AND status IN ('Active','Inactive')
       LIMIT 1
    ");
    $stmt->execute([$deptAbbr]);
    if ($stmt->fetch(PDO::FETCH_ASSOC)) {
      http_response_code(409);
      echo json_encode(['success' => false, 'message' => 'There is already a Treasurer for this course/department.']);
      exit;
    }
  }

  // Determine school_year
  if ($status === 'Active') {
    $stmt = $pdo->query("SELECT start_year, end_year FROM academic_years WHERE status = 'Active' ORDER BY id DESC LIMIT 1");
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $school_year = $row ? ($row['start_year'] . '-' . $row['end_year']) : null;
  } else {
    $school_year = trim($in['school_year'] ?? '');
    if ($school_year === '') $school_year = null;
  }

  // Password (required NOT NULL in schema): fallback to id_number
  $pwdPlain = trim((string)$password);
  if ($pwdPlain === '') $pwdPlain = $id_number;
  $pwdHash = password_hash($pwdPlain, PASSWORD_BCRYPT);

  // Insert with split name fields
  $stmt = $pdo->prepare("
    INSERT INTO users
      (id_number, first_name, middle_name, last_name, suffix, password, user_type, role, department, status, email, school_year, year, created_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  ");
  $stmt->execute([
    $id_number,
    $first_name,
    $middle_name !== '' ? $middle_name : null,
    $last_name,
    $suffix !== '' ? $suffix : null,
    $pwdHash,
    $user_type,
    $role,
    $deptAbbr,
    $status,
    $email !== '' ? $email : null,
    $school_year,
    $year
  ]);

  echo json_encode(['success' => true, 'id' => $pdo->lastInsertId()]);
  
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['success' => false, 'message' => 'Server error']);
}