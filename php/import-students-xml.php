<?php
// php/import-students-xml.php
// POST multipart/form-data with file=XML

ini_set('display_errors', '1');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');

function jerr(int $code, string $msg, array $extra = []) {
  http_response_code($code);
  echo json_encode(['success' => false, 'message' => $msg] + $extra);
  exit;
}

try {
  require __DIR__ . '/database.php';

  if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jerr(405, 'Use POST');
  }

  if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    jerr(400, 'Missing or invalid upload. Use field name "file".');
  }

  $tmp    = $_FILES['file']['tmp_name'];
  $xmlStr = file_get_contents($tmp);
  if ($xmlStr === false) jerr(400, 'Unable to read uploaded file.');

  libxml_use_internal_errors(true);
  $xml = simplexml_load_string($xmlStr);
  if ($xml === false) {
    $errs = array_map(fn($e) => trim($e->message), libxml_get_errors());
    jerr(400, 'Invalid XML.', ['xml_errors' => $errs]);
  }

  // Allowed values (DB ENUM: Active, Inactive, Archived)
  // Still accept 'Unlisted' from old exports and map it to 'Inactive'
  $allowed_status = ['Active', 'Inactive', 'Archived', 'Unlisted'];
  $allowed_roles  = ['non-admin','admin','super-admin','special-admin','treasurer'];

  // Resolve Active AY string (e.g., "2025-2026")
  $activeAY = null;
  $st = $pdo->query("SELECT start_year, end_year FROM academic_years WHERE status='Active' ORDER BY id DESC LIMIT 1");
  if ($st && ($row = $st->fetch(PDO::FETCH_ASSOC))) {
    $activeAY = $row['start_year'] . '-' . $row['end_year'];
  }

  $inserted = 0;
  $updated  = 0;
  $skipped  = 0;
  $errors   = [];

  // Iterate <student> nodes
  foreach ($xml->xpath('/students/student') as $node) {
    $g = fn($name) => isset($node->{$name}) ? trim((string)$node->{$name}) : '';

    $id_number   = $g('id_number');
    $email       = $g('email');
    $role        = $g('role');
    $department  = $g('department');     // abbreviation or course name
    $year        = $g('year');           // "First Year" .. "Fifth Year"
    $status      = $g('status');
    $school_year = $g('school_year');

    // Names: REQUIRED: first_name + last_name
    $first_name  = $g('first_name');
    $middle_name = $g('middle_name');
    $last_name   = $g('last_name');
    $suffix      = $g('suffix');

    // Minimal validation
    if ($id_number === '' || $department === '' || $year === '' || $first_name === '' || $last_name === '') {
      $skipped++;
      $errors[] = "Missing required fields for id_number {$id_number} (need id_number, first_name, last_name, department, year).";
      continue;
    }

    if ($status !== '' && !in_array($status, $allowed_status, true)) {
      $skipped++;
      $errors[] = "Invalid status '{$status}' for id_number {$id_number}.";
      continue;
    }

    if ($role !== '' && !in_array($role, $allowed_roles, true)) {
      $skipped++;
      $errors[] = "Invalid role '{$role}' for id_number {$id_number}.";
      continue;
    }

    // Defaults
    if ($status === '') $status = 'Inactive';
    if ($role === '')   $role   = 'non-admin';

    // Normalize old 'Unlisted' -> 'Inactive' to fit DB ENUM
    if ($status === 'Unlisted') {
      $status = 'Inactive';
    }

    // Prevent creating super-admin via import
    if ($role === 'super-admin') {
      $skipped++;
      $errors[] = "Cannot import super-admin via XML (id_number {$id_number}).";
      continue;
    }

    // Resolve department to abbreviation (same logic as add-student)
    $stmt = $pdo->prepare("SELECT abbreviation FROM courses WHERE course_name = ? OR abbreviation = ? LIMIT 1");
    $stmt->execute([$department, $department]);
    $course = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$course) {
      $skipped++;
      $errors[] = "Invalid course/department '{$department}' for id_number {$id_number}.";
      continue;
    }
    $deptAbbr = $course['abbreviation'];

    // If Active -> force active AY (if available)
    if ($status === 'Active' && $activeAY) {
      $school_year = $activeAY;
    } else {
      $school_year = ($school_year !== '') ? $school_year : null;
    }

    // Treasurer uniqueness per department among non-Unlisted (Active/Inactive)
    if ($role === 'treasurer') {
      $q = $pdo->prepare("
        SELECT id FROM users
         WHERE role='treasurer'
           AND department = ?
           AND status IN ('Active','Inactive')
           AND id_number <> ?
         LIMIT 1
      ");
      $q->execute([$deptAbbr, $id_number]);
      if ($q->fetch(PDO::FETCH_ASSOC)) {
        $skipped++;
        $errors[] = "Treasurer already exists for department {$deptAbbr}. (id_number {$id_number})";
        continue;
      }
    }

    // Upsert by id_number
    $q = $pdo->prepare("SELECT id, role FROM users WHERE id_number = ? LIMIT 1");
    $q->execute([$id_number]);
    $existing = $q->fetch(PDO::FETCH_ASSOC);

    try {
      if ($existing) {
        // Update (skip root super-admin if ever)
        if ((int)$existing['id'] === 1 && $existing['role'] === 'super-admin') {
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
                 department  = :department,
                 year        = :year,
                 status      = :status,
                 role        = :role,
                 school_year = :school_year,
                 user_type   = 'student'
           WHERE id_number   = :id_number
        ");
        $stmt->execute([
          ':first_name'  => $first_name,
          ':middle_name' => $middle_name !== '' ? $middle_name : null,
          ':last_name'   => $last_name,
          ':suffix'      => $suffix !== '' ? $suffix : null,
          ':email'       => $email !== '' ? $email : null,
          ':department'  => $deptAbbr,
          ':year'        => $year,
          ':status'      => $status,
          ':role'        => $role,
          ':school_year' => $school_year,
          ':id_number'   => $id_number,
        ]);
        $updated += $stmt->rowCount();

      } else {
        // Insert (password = bcrypt(id_number))
        $password_hash = password_hash($id_number, PASSWORD_BCRYPT);

        $stmt = $pdo->prepare("
          INSERT INTO users
            (id_number, first_name, middle_name, last_name, suffix,
             password, user_type, role, department,
             status, email, school_year, year, created_at)
          VALUES
            (:id_number, :first_name, :middle_name, :last_name, :suffix,
             :password, 'student', :role, :department,
             :status, :email, :school_year, :year, NOW())
        ");
        $stmt->execute([
          ':id_number'   => $id_number,
          ':first_name'  => $first_name,
          ':middle_name' => $middle_name !== '' ? $middle_name : null,
          ':last_name'   => $last_name,
          ':suffix'      => $suffix !== '' ? $suffix : null,
          ':password'    => $password_hash,
          ':role'        => $role,
          ':department'  => $deptAbbr,
          ':status'      => $status,
          ':email'       => $email !== '' ? $email : null,
          ':school_year' => $school_year,
          ':year'        => $year,
        ]);
        $inserted++;
      }
    } catch (Throwable $ex) {
      $skipped++;
      $errors[] = "DB error for id_number {$id_number}: " . $ex->getMessage();
    }
  }

  echo json_encode([
    'success'  => true,
    'inserted' => $inserted,
    'updated'  => $updated,
    'skipped'  => $skipped,
    'errors'   => $errors,
    'message'  => "Import complete. inserted={$inserted}, updated={$updated}, skipped={$skipped}"
  ]);
} catch (Throwable $e) {
  jerr(500, 'Server error', ['detail' => $e->getMessage()]);
}
