<?php
// php/edit-course.php
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
  $author_id = $_SESSION['id'] ?? null;
  if (!$author_id) jerr(401, 'Not authenticated');

  // ---- Validate & normalize inputs ----
  $id = $_POST['id'] ?? '';
  $course_name  = trim($_POST['course_name'] ?? '');
  $abbreviation = trim($_POST['abbreviation'] ?? '');
  $status = $_POST['status'] ?? 'Active';

  if (!$id || $course_name === '' || $abbreviation === '') {
    jerr(422, 'All fields are required.');
  }

  // Normalize
  $course_name = preg_replace('/\s+/',' ', $course_name);
  $abbreviation = strtoupper(preg_replace('/\s+/', '', $abbreviation));

  // Basic format checks
  if (mb_strlen($course_name) < 3) jerr(422, 'Course name is too short.');
  if (!preg_match('/^[A-Z0-9\-]{2,20}$/', $abbreviation)) {
    jerr(422, 'Abbreviation must be 2–20 chars (A–Z, 0–9, hyphen), no spaces.');
  }

  // Convert "Archived" to "Unlisted" for database
  if ($status === 'Archived') {
    $status = 'Unlisted';
  }

  // ---- Handle image upload (optional) ----
  $image_path = null;
  $update_image = false;

  if (!empty($_FILES['image']['name'])) {
    $targetDir = __DIR__ . '/../uploads/courses/';
    if (!is_dir($targetDir) && !mkdir($targetDir, 0777, true)) {
      jerr(500, 'Failed to create upload directory.');
    }

    if (!empty($_FILES['image']['error']) && $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
      jerr(400, 'Image upload error code: '.$_FILES['image']['error']);
    }
    
    $maxBytes = 5 * 1024 * 1024; // 5 MB
    if ($_FILES['image']['size'] > $maxBytes) jerr(413, 'Image too large (max 5MB).');

    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime  = finfo_file($finfo, $_FILES['image']['tmp_name']);
    finfo_close($finfo);
    $allowed = ['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp'];
    if (!isset($allowed[$mime])) jerr(415, 'Only JPG/PNG/WebP allowed.');

    $ext = $allowed[$mime];
    $fileName = time() . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
    $targetFile = $targetDir . $fileName;

    if (!move_uploaded_file($_FILES['image']['tmp_name'], $targetFile)) {
      jerr(500, 'Failed to move uploaded image.');
    }
    $image_path = 'uploads/courses/' . $fileName;
    $update_image = true;
  }

  // ---- Check if course exists ----
  $check = $pdo->prepare("SELECT id, image_path FROM courses WHERE id = ?");
  $check->execute([$id]);
  $course = $check->fetch(PDO::FETCH_ASSOC);
  
  if (!$course) {
    jerr(404, 'Course not found.');
  }

  // ---- Check for duplicate name/abbreviation (excluding current course) ----
  $checkDuplicate = $pdo->prepare("
    SELECT id FROM courses 
    WHERE (LOWER(course_name) = LOWER(?) OR LOWER(abbreviation) = LOWER(?))
      AND id != ?
    LIMIT 1
  ");
  $checkDuplicate->execute([$course_name, $abbreviation, $id]);
  if ($checkDuplicate->fetch(PDO::FETCH_ASSOC)) {
    jerr(409, 'Another course with same name or abbreviation already exists.');
  }

  // ---- Update course ----
  if ($update_image) {
    // Delete old image if it exists and is not the placeholder
    if (!empty($course['image_path']) && 
        $course['image_path'] !== 'assets/images/image-placeholder.svg' &&
        file_exists(__DIR__ . '/../' . $course['image_path'])) {
      unlink(__DIR__ . '/../' . $course['image_path']);
    }
    
    $stmt = $pdo->prepare("
      UPDATE courses 
      SET course_name = ?, abbreviation = ?, image_path = ?, status = ?
      WHERE id = ?
    ");
    $stmt->execute([$course_name, $abbreviation, $image_path, $status, $id]);
  } else {
    $stmt = $pdo->prepare("
      UPDATE courses 
      SET course_name = ?, abbreviation = ?, status = ?
      WHERE id = ?
    ");
    $stmt->execute([$course_name, $abbreviation, $status, $id]);
  }

  echo json_encode(['success'=>true, 'message'=>'Course updated successfully']);

} catch (PDOException $e) {
  echo json_encode(['success'=>false, 'message'=>'Database error', 'error'=>$e->getMessage()]);
} catch (Throwable $e) {
  echo json_encode(['success'=>false, 'message'=>'Server error', 'error'=>$e->getMessage()]);
}