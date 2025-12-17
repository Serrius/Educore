<?php
// php/add-organization.php
header('Content-Type: application/json');
ini_set('display_errors','1');
error_reporting(E_ALL);
session_start();

function jerr($http,$msg,$extra=[]) {
  http_response_code($http);
  echo json_encode(['success'=>false,'message'=>$msg] + $extra);
  exit;
}

try {
  require __DIR__ . '/database.php';
  if (!isset($pdo)) {
    throw new RuntimeException('DB connection not available.');
  }

  // ---- Auth (trust the session, not POST) ----
  $author = $_SESSION['id_number'] ?? null;
  if (!$author) jerr(401, 'Not authenticated');

  $role = strtolower(trim($_SESSION['role'] ?? ''));
  $dept = strtoupper(trim($_SESSION['department'] ?? '')); // admin’s department (e.g. CCS/CET/etc)

  // ---- Active AY (span + legacy) ----
  $ay = $pdo->query("
    SELECT start_year, end_year, active_year
    FROM academic_years
    WHERE status='Active'
    ORDER BY id DESC
    LIMIT 1
  ")->fetch(PDO::FETCH_ASSOC);
  if (!$ay) jerr(400,'No active academic year found.');

  $active_start  = (int)$ay['start_year'];
  $active_end    = (int)$ay['end_year'];
  $active_single = isset($ay['active_year']) ? (int)$ay['active_year'] : $active_start;

  // ---- Inputs ----
  $name_in     = trim($_POST['org_name'] ?? '');
  $abbr_in     = trim($_POST['org_abbr'] ?? '');
  $scope       = (($_POST['scope'] ?? '') === 'exclusive') ? 'exclusive' : 'general';
  $course_abbr = trim($_POST['course_abbr'] ?? '');

  if ($name_in === '') jerr(400,'Organization name is required.');
  if ($abbr_in === '') jerr(400,'Organization abbreviation is required.');
  if ($scope === 'exclusive' && $course_abbr === '') {
    jerr(400,'Course abbreviation is required for exclusive org.');
  }

  // Normalize
  $name = preg_replace('/\s+/',' ', $name_in);
  $abbr = strtoupper($abbr_in);
  if ($course_abbr !== '') $course_abbr = strtoupper($course_abbr);

  // ---- Admin/Department guards ----
  if (in_array($role, ['admin'], true) && $scope === 'exclusive') {
    if ($dept === '' || $course_abbr === '' || $dept !== $course_abbr) {
      jerr(403, 'You can only add organizations for your own department.');
    }
  }

  // ---- Duplicate guard (same AY span, same name or abbr) ----
  $dupStmt = $pdo->prepare("
    SELECT id FROM organizations
     WHERE start_year = :sy AND end_year = :ey
       AND (abbreviation = :abbr OR LOWER(name) = LOWER(:name))
     LIMIT 1
  ");
  $dupStmt->execute([
    ':sy'=>$active_start, ':ey'=>$active_end,
    ':abbr'=>$abbr, ':name'=>$name
  ]);
  if ($dupStmt->fetchColumn()) {
    jerr(409, 'Organization already exists for the active academic year span.');
  }

  // ---- One-organization-per-department (per AY span) ----
  if ($course_abbr !== '') {
    $oneDeptStmt = $pdo->prepare("
      SELECT id FROM organizations
       WHERE start_year = :sy AND end_year = :ey
         AND course_abbr = :course
       LIMIT 1
    ");
    $oneDeptStmt->execute([
      ':sy' => $active_start,
      ':ey' => $active_end,
      ':course' => $course_abbr,
    ]);
    if ($oneDeptStmt->fetchColumn()) {
      jerr(409, 'This department already has an organization for the active academic year.');
    }
  }

  // ---- NEW RULE (precheck): Only ONE exclusive org per course (per AY span) ----
  if ($scope === 'exclusive') {
    $exStmt = $pdo->prepare("
      SELECT id FROM organizations
       WHERE start_year = :sy AND end_year = :ey
         AND scope = 'exclusive'
         AND course_abbr = :course
       LIMIT 1
    ");
    $exStmt->execute([
      ':sy'=>$active_start,
      ':ey'=>$active_end,
      ':course'=>$course_abbr
    ]);
    if ($exStmt->fetchColumn()) {
      jerr(409, 'This course already has an exclusive organization for the active academic year.');
    }
  }

  // ---- File validation BEFORE insert ----
  $ALLOWED_MIME = [
    'image/png'        => 'png',
    'image/jpeg'       => 'jpg',
    'image/jpg'        => 'jpg',
    'application/pdf'  => 'pdf'
  ];
  $MAX_BYTES = 2 * 1024 * 1024; // 2MB

  $requiredSingles = [
    'concept_paper','vmgo','logo_explanation','org_chart',
    'officers_list','members_list',
    'adviser_moderator_acceptance','proposed_program',
    'awfp','cbl','bank_passbook','accomplishment_report',
    'financial_statement','trainings_report','presidents_report',
    'advisers_report','evaluation','contact_details',
  ];

  foreach ($requiredSingles as $fld) {
    if (!isset($_FILES[$fld]) || $_FILES[$fld]['error'] === UPLOAD_ERR_NO_FILE) {
      jerr(400, "Missing required file: {$fld}");
    }
    if ($_FILES[$fld]['error'] !== UPLOAD_ERR_OK) {
      jerr(400, "Upload error on {$fld} (code ".$_FILES[$fld]['error'].")");
    }
    if ($_FILES[$fld]['size'] > $MAX_BYTES) {
      jerr(400, "{$fld} exceeds 2MB limit.");
    }
  }

  // pds_officers[] at least one
  if (!isset($_FILES['pds_officers']) || !is_array($_FILES['pds_officers']['name'])) {
    jerr(400, 'PDS of Officers is required.');
  } else {
    $hasAny = false;
    foreach ($_FILES['pds_officers']['error'] as $i => $err) {
      if ($err === UPLOAD_ERR_OK && ($_FILES['pds_officers']['size'][$i] <= $MAX_BYTES)) {
        $hasAny = true;
        break;
      }
    }
    if (!$hasAny) jerr(400, 'At least one PDS of Officers file is required (max 2MB each).');
  }

  // ---- Helpers ----
  function safe_ext_from_upload($tmp, $origName, $allowedMime, $fallbackExt = 'dat') {
    $finfo = @finfo_open(FILEINFO_MIME_TYPE);
    $mime  = $finfo ? @finfo_file($finfo, $tmp) : null;
    if ($finfo) @finfo_close($finfo);
    if ($mime && isset($allowedMime[$mime])) return $allowedMime[$mime];
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    if ($ext === 'jpeg') $ext = 'jpg';
    return $ext ?: $fallbackExt;
  }

  // ---- Begin transaction ----
  $pdo->beginTransaction();

  // Admin assignment comes from SESSION (authoritative)
  $admin_id_number = $_SESSION['id_number'] ?? null;

  // Create org (no logo yet), include span + legacy active_year
  $stmt = $pdo->prepare("
    INSERT INTO organizations
      (name, abbreviation, scope, course_abbr, authors_id_number, admin_id_number, status,
       active_year, start_year, end_year, created_at)
    VALUES
      (:name, :abbr, :scope, :course, :author, :admin, 'Pending',
       :ay_single, :ay_start, :ay_end, NOW())
  ");
  $stmt->execute([
    ':name'      => $name,
    ':abbr'      => $abbr,
    ':scope'     => $scope,
    ':course'    => ($course_abbr !== '' ? $course_abbr : null),
    ':author'    => $author,
    ':admin'     => $admin_id_number,
    ':ay_single' => $active_single,
    ':ay_start'  => $active_start,
    ':ay_end'    => $active_end
  ]);
  $org_id = (int)$pdo->lastInsertId();

  // Paths (use start_year folder)
  $uploadBase = __DIR__ . '/../uploads/accreditation';
  if (!is_dir($uploadBase)) @mkdir($uploadBase, 0775, true);
  $targetDir = $uploadBase . "/{$active_start}/{$org_id}";
  if (!is_dir($targetDir)) @mkdir($targetDir, 0775, true);

  // Simple saver – now takes the $file array explicitly (no direct $_FILES inside)
  $saveOne = function($field, $prefix, $file) use ($org_id, $active_start, $targetDir, $ALLOWED_MIME) {
    if (!$file || !is_array($file)) return null;
    if (!isset($file['error']) || $file['error'] !== UPLOAD_ERR_OK) return null;

    $ext = safe_ext_from_upload($file['tmp_name'], $file['name'], $ALLOWED_MIME, 'dat');
    $fname = "{$prefix}_org{$org_id}_" . time() . '.' . $ext;
    $dest = rtrim($targetDir,'/') . '/' . $fname;
    if (!@move_uploaded_file($file['tmp_name'], $dest)) {
      throw new RuntimeException("Failed to store file: {$field}");
    }
    return "uploads/accreditation/{$active_start}/{$org_id}/{$fname}";
  };

  // Insert a doc row
  $insertDoc = function($pdo,$org_id,$group,$doc_type,$rel,$ay_single,$ay_start,$ay_end,$author){
    $ins = $pdo->prepare("
      INSERT INTO accreditation_files
        (org_id, doc_group, doc_type, file_path,
         active_year, start_year, end_year, uploaded_by)
      VALUES (?,?,?,?,?,?,?,?)
    ");
    $ins->execute([$org_id,$group,$doc_type,$rel,$ay_single,$ay_start,$ay_end,$author]);
  };

  // Logo (optional)
  if (isset($_FILES['org_logo']) && $_FILES['org_logo']['error'] !== UPLOAD_ERR_NO_FILE) {
    if ($_FILES['org_logo']['error'] === UPLOAD_ERR_OK && $_FILES['org_logo']['size'] <= (2*1024*1024)) {
      $ext = safe_ext_from_upload($_FILES['org_logo']['tmp_name'], $_FILES['org_logo']['name'], $ALLOWED_MIME, 'dat');
      $fname = "org_logo_org{$org_id}_" . time() . '.' . $ext;
      $dest = rtrim($targetDir,'/') . '/' . $fname;
      if (!@move_uploaded_file($_FILES['org_logo']['tmp_name'], $dest)) {
        throw new RuntimeException('Failed to store organization logo.');
      }
      $logoRel = "uploads/accreditation/{$active_start}/{$org_id}/{$fname}";
      $pdo->prepare("UPDATE organizations SET logo_path = :p WHERE id = :id")
          ->execute([':p'=>$logoRel, ':id'=>$org_id]);
    }
  }

  // Singles (doc_group = 'new')
  $mapSingles = [
    'concept_paper'                => 'concept_paper',
    'vmgo'                         => 'vmgo',
    'logo_explanation'             => 'logo_explanation',
    'org_chart'                    => 'org_chart',
    'officers_list'                => 'officers_list',
    'members_list'                 => 'members_list',
    'adviser_moderator_acceptance' => 'adviser_moderator_acceptance',
    'proposed_program'             => 'proposed_program',
    'awfp'                         => 'awfp',
    'cbl'                          => 'cbl',
    'bank_passbook'                => 'bank_passbook',
    'accomplishment_report'        => 'accomplishment_report',
    'financial_statement'          => 'financial_statement',
    'trainings_report'            => 'trainings_report',
    'presidents_report'            => 'presidents_report',
    'advisers_report'             => 'advisers_report',
    'evaluation'                  => 'evaluation',
    'contact_details'             => 'contact_details',
  ];

  foreach ($mapSingles as $field => $docType) {
    $file = $_FILES[$field] ?? null;
    $rel  = $saveOne($field, $docType, $file);
    if (!$rel) {
      throw new RuntimeException("Missing required file after precheck: {$field}");
    }
    $insertDoc($pdo, $org_id, 'new', $docType, $rel,
      $active_single, $active_start, $active_end, $author
    );
  }

  // Optional certificate (either name)
  foreach (['certificate_accreditation','certificate'] as $optField) {
    if (!isset($_FILES[$optField])) continue;
    $file = $_FILES[$optField];
    if ($file['error'] === UPLOAD_ERR_OK && $file['size'] <= (2*1024*1024)) {
      $rel = $saveOne($optField, 'certificate', $file);
      if ($rel) {
        $insertDoc($pdo, $org_id, 'new', 'certificate', $rel,
          $active_single, $active_start, $active_end, $author
        );
      }
      break;
    }
  }

  // pds_officers[] (array)
  $names = $_FILES['pds_officers']['name'];
  $tmps  = $_FILES['pds_officers']['tmp_name'];
  $errs  = $_FILES['pds_officers']['error'];
  $sizes = $_FILES['pds_officers']['size'];
  $count = count($names);

  $savedAny = false;
  for ($i = 0; $i < $count; $i++) {
    if ($errs[$i] !== UPLOAD_ERR_OK) continue;
    if ($sizes[$i] > (2*1024*1024)) continue;

    $ext = safe_ext_from_upload($tmps[$i], $names[$i], $ALLOWED_MIME, 'dat');
    $fname = "pds_officers_org{$org_id}_" . time() . "_{$i}." . $ext;
    $dest = rtrim($targetDir,'/') . '/' . $fname;
    if (!@move_uploaded_file($tmps[$i], $dest)) continue;

    $rel = "uploads/accreditation/{$active_start}/{$org_id}/{$fname}";
    $insertDoc($pdo, $org_id, 'new', 'pds_officers', $rel,
      $active_single, $active_start, $active_end, $author
    );
    $savedAny = true;
  }
  if (!$savedAny) {
    throw new RuntimeException('At least one PDS of Officers file is required (max 2MB each).');
  }

  // ========== CREATE NOTIFICATIONS FOR SUPER-ADMIN + SPECIAL-ADMIN ==========
  // Get author name for notification message
  $authorStmt = $pdo->prepare("
    SELECT CONCAT(first_name, ' ', last_name) as author_name 
    FROM users 
    WHERE id_number = :author
  ");
  $authorStmt->execute([':author' => $author]);
  $authorData = $authorStmt->fetch(PDO::FETCH_ASSOC);
  $authorName = $authorData['author_name'] ?? 'Unknown User';

  // Fetch all super-admin and special-admin users
  $recStmt = $pdo->query("
    SELECT id_number
    FROM users
    WHERE LOWER(role) IN ('super-admin','special-admin')
  ");
  $recipients = $recStmt->fetchAll(PDO::FETCH_COLUMN);

  if ($recipients) {
    $notificationStmt = $pdo->prepare("
      INSERT INTO notifications 
      (recipient_id_number, actor_id_number, title, message, notif_type, payload_id, status, created_at)
      VALUES 
      (:recipient, :actor, :title, :message, 'accreditation', :payload_id, 'unread', NOW())
    ");

    foreach ($recipients as $recipientId) {
      $notificationStmt->execute([
        ':recipient'  => $recipientId,
        ':actor'      => $author,
        ':title'      => 'New Accreditation Submitted',
        ':message'    => "Organization '{$name}' ({$abbr}) has been submitted for accreditation by {$authorName}.",
        ':payload_id' => $org_id
      ]);
    }
  }

  // Commit all
  $pdo->commit();

  echo json_encode([
    'success'     => true,
    'org_id'      => $org_id,
    'start_year'  => $active_start,
    'end_year'    => $active_end,
    'message'     => 'Organization submitted'
  ]);
}
catch (PDOException $e) {
  if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();

  $sqlstate = $e->getCode();          // '23000' for integrity errors
  $driver   = $e->errorInfo[1] ?? 0;  // MySQL/MariaDB code (1062 dup, 1452 FK)

  if ($sqlstate === '23000') {
    if ($driver == 1062) jerr(409, 'Organization already exists for the active academic year span (or department constraint).');
    if ($driver == 1452) jerr(400, 'Related record not found (check admin user or foreign keys).');
  }

  jerr(500, 'Database error', ['detail'=>$e->getMessage()]);
}
catch (Throwable $e) {
  if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
  jerr(500,'Server error',['detail'=>$e->getMessage()]);
}
