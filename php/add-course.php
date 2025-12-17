<?php
// php/add-course.php
header('Content-Type: application/json');
ini_set('display_errors','1'); error_reporting(E_ALL);
session_start();

require __DIR__ . '/database.php';

function jerr($http, $msg, $extra = []) {
  http_response_code($http);
  echo json_encode(['success'=>false, 'message'=>$msg] + $extra);
  exit;
}

try {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') jerr(405, 'Method not allowed');

  // Use the logged-in user
  $author_id = $_SESSION['id'] ?? null; // you store numeric id in session
  if (!$author_id) jerr(401, 'Not authenticated');

  // ---- Validate & normalize inputs ----
  $course_name  = trim($_POST['course_name'] ?? '');
  $abbreviation = trim($_POST['abbreviation'] ?? '');

  if ($course_name === '' || $abbreviation === '') {
    jerr(422, 'Course name and abbreviation are required.');
  }

  // Normalize (you can adjust these rules to taste)
  // Collapse multiple spaces in course_name
  $course_name = preg_replace('/\s+/',' ', $course_name);
  // Abbreviation: uppercase, strip spaces
  $abbreviation = strtoupper(preg_replace('/\s+/', '', $abbreviation));

  // Basic format checks
  if (mb_strlen($course_name) < 3) jerr(422, 'Course name is too short.');
  if (!preg_match('/^[A-Z0-9\-]{2,20}$/', $abbreviation)) {
    jerr(422, 'Abbreviation must be 2–20 chars (A–Z, 0–9, hyphen), no spaces.');
  }

  $status = 'Active';
  $image_path = null;

  // ---- Handle image upload (optional) ----
  if (!empty($_FILES['image_path']['name'])) {
    $targetDir = __DIR__ . '/../uploads/courses/';
    if (!is_dir($targetDir) && !mkdir($targetDir, 0777, true)) {
      jerr(500, 'Failed to create upload directory.');
    }

    // Validate size/type quickly (adjust limits as needed)
    if (!empty($_FILES['image_path']['error']) && $_FILES['image_path']['error'] !== UPLOAD_ERR_OK) {
      jerr(400, 'Image upload error code: '.$_FILES['image_path']['error']);
    }
    $maxBytes = 5 * 1024 * 1024; // 5 MB
    if ($_FILES['image_path']['size'] > $maxBytes) jerr(413, 'Image too large (max 5MB).');

    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime  = finfo_file($finfo, $_FILES['image_path']['tmp_name']);
    finfo_close($finfo);
    $allowed = ['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp'];
    if (!isset($allowed[$mime])) jerr(415, 'Only JPG/PNG/WebP allowed.');

    $ext = $allowed[$mime];
    $fileName = time() . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
    $targetFile = $targetDir . $fileName;

    if (!move_uploaded_file($_FILES['image_path']['tmp_name'], $targetFile)) {
      jerr(500, 'Failed to move uploaded image.');
    }
    $image_path = 'uploads/courses/' . $fileName; // web path
  }

  // ---- Insert with duplicate protection ----
  // Rely on UNIQUE constraints and also soft pre-check to give nice errors.
  $pdo->beginTransaction();

  // Soft existence check (case-insensitive because of default collations, but we’ll be explicit)
  $check = $pdo->prepare("
    SELECT id, status
      FROM courses
     WHERE LOWER(course_name) = LOWER(?)
        OR LOWER(abbreviation) = LOWER(?)
     LIMIT 1
  ");
  $check->execute([$course_name, $abbreviation]);
  if ($check->fetch(PDO::FETCH_ASSOC)) {
    $pdo->rollBack();
    jerr(409, 'Course with same name or abbreviation already exists.');
  }

  // Insert (UNIQUE keys still protect against race conditions)
  $stmt = $pdo->prepare("
    INSERT INTO courses (course_name, abbreviation, image_path, status, author_id)
    VALUES (?, ?, ?, ?, ?)
  ");
  $stmt->execute([$course_name, $abbreviation, $image_path, $status, $author_id]);

  $pdo->commit();
  echo json_encode(['success'=>true, 'message'=>'Course added successfully']);

} catch (PDOException $e) {
  // Handle duplicate key race condition gracefully
  if ($pdo->inTransaction()) $pdo->rollBack();
  if ($e->getCode() === '23000') {
    // Duplicate key (violated UNIQUE)
    echo json_encode(['success'=>false, 'message'=>'Course already exists (duplicate).']);
  } else {
    echo json_encode(['success'=>false, 'message'=>'Database error', 'error'=>$e->getMessage()]);
  }
} catch (Throwable $e) {
  if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
  echo json_encode(['success'=>false, 'message'=>'Server error', 'error'=>$e->getMessage()]);
}
