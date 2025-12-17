<?php
// php/import-admins-xml.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors', '1');
error_reporting(E_ALL);

function jerr(int $code, string $msg, array $extra=[]) {
  http_response_code($code);
  echo json_encode(['success'=>false,'message'=>$msg]+$extra);
  exit;
}

try {
  require __DIR__ . '/database.php';

  if ($_SERVER['REQUEST_METHOD'] !== 'POST') jerr(405,'Use POST');
  if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    jerr(400,'Missing or invalid upload (file).');
  }

  $xmlStr = file_get_contents($_FILES['file']['tmp_name']);
  if ($xmlStr === false) jerr(400,'Unable to read file.');

  libxml_use_internal_errors(true);
  $xml = simplexml_load_string($xmlStr);
  if ($xml === false) {
    $errs = array_map(fn($e) => trim($e->message), libxml_get_errors());
    jerr(400,'Invalid XML.', ['xml_errors'=>$errs]);
  }

  // Match DB ENUM: Active, Inactive, Archived
  // Still accept 'Unlisted' from old files and map it to 'Inactive'
  $allowed_status = ['Active','Inactive','Archived','Unlisted'];

  $inserted=0; $updated=0; $skipped=0; $errors=[];

  foreach ($xml->xpath('/admins/admin') as $node) {
    $g = fn($k)=> isset($node->{$k}) ? trim((string)$node->{$k}) : '';

    $id_number   = $g('id_number');
    $email       = $g('email');
    $status      = $g('status') ?: 'Inactive';
    $department  = $g('department'); // course abbreviation (for chips)

    // Names (REQUIRED: first_name + last_name)
    $first_name  = $g('first_name');
    $middle_name = $g('middle_name');
    $last_name   = $g('last_name');
    $suffix      = $g('suffix');

    // Basic validation
    if ($id_number === '' || $first_name === '' || $last_name === '') {
      $skipped++;
      $errors[]="First name, last name, and ID number are required (id_number {$id_number}).";
      continue;
    }

    if (!in_array($status, $allowed_status, true)) {
      $skipped++;
      $errors[]="Invalid status '{$status}' for id_number {$id_number}.";
      continue;
    }

    // Normalize old 'Unlisted' -> 'Inactive' to fit ENUM
    if ($status === 'Unlisted') {
      $status = 'Inactive';
    }

    if ($department === '') {
      $skipped++;
      $errors[]="Course/department is required for id_number {$id_number}.";
      continue;
    }

    // Validate course abbreviation exists and is Active
    $stmt = $pdo->prepare("SELECT id FROM courses WHERE abbreviation = ? AND status = 'Active' LIMIT 1");
    $stmt->execute([$department]);
    if (!$stmt->fetch(PDO::FETCH_ASSOC)) {
      $skipped++;
      $errors[] = "Selected course '{$department}' is invalid or not active (id_number {$id_number}).";
      continue;
    }

    // Upsert by id_number, fixed user_type=staff, role=admin
    $q = $pdo->prepare("SELECT id, role FROM users WHERE id_number = ? LIMIT 1");
    $q->execute([$id_number]);
    $existing = $q->fetch(PDO::FETCH_ASSOC);

    try {
      if ($existing) {
        // don't downgrade super-admin
        if ($existing['role'] === 'super-admin') {
          $skipped++;
          $errors[] = "Skipping super-admin for id_number {$id_number}.";
          continue;
        }

        $stmt = $pdo->prepare("
          UPDATE users
             SET first_name  = :first_name,
                 middle_name = :middle_name,
                 last_name   = :last_name,
                 suffix      = :suffix,
                 email       = :email,
                 status      = :status,
                 department  = :department,
                 role        = 'admin',
                 user_type   = 'staff'
           WHERE id_number  = :id_number
        ");
        $stmt->execute([
          ':first_name'  => $first_name,
          ':middle_name' => $middle_name !== '' ? $middle_name : null,
          ':last_name'   => $last_name,
          ':suffix'      => $suffix !== '' ? $suffix : null,
          ':email'       => $email !== '' ? $email : null,
          ':status'      => $status,
          ':department'  => $department,
          ':id_number'   => $id_number,
        ]);
        $updated += $stmt->rowCount();

      } else {
        $password_hash = password_hash($id_number, PASSWORD_BCRYPT);

        $stmt = $pdo->prepare("
          INSERT INTO users
            (id_number, first_name, middle_name, last_name, suffix,
             password, user_type, role, department, status, email, created_at)
          VALUES
            (:id_number, :first_name, :middle_name, :last_name, :suffix,
             :password, 'staff', 'admin', :department, :status, :email, NOW())
        ");
        $stmt->execute([
          ':id_number'  => $id_number,
          ':first_name' => $first_name,
          ':middle_name'=> $middle_name !== '' ? $middle_name : null,
          ':last_name'  => $last_name,
          ':suffix'     => $suffix !== '' ? $suffix : null,
          ':password'   => $password_hash,
          ':department' => $department,
          ':status'     => $status,
          ':email'      => $email !== '' ? $email : null,
        ]);
        $inserted++;
      }
    } catch (Throwable $ex) {
      $skipped++;
      $errors[] = "DB error for id_number {$id_number}: ".$ex->getMessage();
    }
  }

  echo json_encode([
    'success'=>true,
    'inserted'=>$inserted,
    'updated'=>$updated,
    'skipped'=>$skipped,
    'errors'=>$errors,
    'message'=>"Import complete. inserted={$inserted}, updated={$updated}, skipped={$skipped}"
  ]);
} catch (Throwable $e) {
  jerr(500,'Server error',['detail'=>$e->getMessage()]);
}
