<?php
// php/add-reaccreditation.php
header('Content-Type: application/json');
ini_set('display_errors','1'); error_reporting(E_ALL);
session_start();

function jerr($http,$msg,$extra=[]) {
  http_response_code($http);
  echo json_encode(['success'=>false,'message'=>$msg] + $extra);
  exit;
}

try {
  require __DIR__ . '/database.php';

  // ---- Auth ----
  $author = $_SESSION['id_number'] ?? null;
  if (!$author) jerr(401,'Not authenticated');

  // ---- Inputs ----
  $org_id = isset($_POST['org_id']) ? (int)$_POST['org_id'] : 0;
  if ($org_id<=0) jerr(400,'Invalid org_id');

  // ---- Active AY (span + semester/single) ----
  $ay = $pdo->query("
    SELECT start_year, end_year, active_year
    FROM academic_years
    WHERE status='Active'
    ORDER BY id DESC
    LIMIT 1
  ")->fetch(PDO::FETCH_ASSOC);
  if (!$ay) jerr(400,'No active academic year found.');

  $active_start  = (int)$ay['start_year'];   // e.g., 2025
  $active_end    = (int)$ay['end_year'];     // e.g., 2026
  $active_sem    = isset($ay['active_year']) ? (int)$ay['active_year'] : $active_start; // semester/single within span

  // ---- Load org ----
  $o = $pdo->prepare("SELECT id, name, abbreviation, start_year, end_year, active_year, status FROM organizations WHERE id=? LIMIT 1");
  $o->execute([$org_id]);
  $org = $o->fetch(PDO::FETCH_ASSOC);
  if (!$org) jerr(404,'Organization not found');

  $org_sy  = (int)($org['start_year'] ?? 0);
  $org_ey  = (int)($org['end_year'] ?? 0);
  $org_sem = (int)($org['active_year'] ?? 0);

  // ---- REMOVED: Allow reaccreditation at any time ----
  // No longer checking if semester or span has changed
  // Organizations can submit reaccreditation in the same academic year/span

  // ---- Optional: prevent abbr conflicts in target sem/span
  if (!empty($org['abbreviation'])) {
    $dup = $pdo->prepare("
      SELECT id FROM organizations
      WHERE abbreviation = :abbr
        AND start_year   = :sy
        AND end_year     = :ey
        AND active_year  = :ay
        AND id <> :id
      LIMIT 1
    ");
    $dup->execute([
      ':abbr'=>$org['abbreviation'],
      ':sy'=>$active_start,
      ':ey'=>$active_end,
      ':ay'=>$active_sem,
      ':id'=>$org_id
    ]);
    if ($dup->fetchColumn()) {
      jerr(409, 'Another organization with the same abbreviation already exists for this semester.');
    }
  }

  // ---- Upload constraints ----
  $ALLOWED_MIME = [
    'image/png' => 'png', 'image/jpeg' => 'jpg', 'image/jpg' => 'jpg',
    'application/pdf' => 'pdf'
  ];
  $MAX_BYTES = 2 * 1024 * 1024; // 2MB

  function safe_ext_from_upload($tmp, $origName, $allowedMime, $fallbackExt = 'dat') {
    $finfo = @finfo_open(FILEINFO_MIME_TYPE);
    $mime  = $finfo ? @finfo_file($finfo, $tmp) : null;
    if ($finfo) @finfo_close($finfo);
    if ($mime && isset($allowedMime[$mime])) return $allowedMime[$mime];
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    if ($ext === 'jpeg') $ext = 'jpg';
    return $ext ?: $fallbackExt;
  }

  // ---- Required singles for Reaccreditation / Old (new checklist)
  $requiredSingles = [
    'officers_list',
    'members_list',
    'adviser_moderator_acceptance',
    'awfp',
    'cbl',
    'bank_passbook',
    'accomplishment_report',
    'financial_statement',
    'trainings_report',
    'presidents_report',
    'advisers_report',
    'evaluation',
    'contact_details'
  ];

  // Pre-check required singles
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

  // 7) PDS of Officers (multiple) — at least one valid file ≤2MB
  if (!isset($_FILES['pds_officers']) || !is_array($_FILES['pds_officers']['name'])) {
    jerr(400, 'Personal Data Sheet(s) for officers are required (pds_officers[]).');
  } else {
    $ok = false;
    foreach ($_FILES['pds_officers']['error'] as $i => $err) {
      if ($err === UPLOAD_ERR_OK && ($_FILES['pds_officers']['size'][$i] <= $MAX_BYTES)) {
        $ok = true; break;
      }
    }
    if (!$ok) jerr(400, 'At least one PDS file (≤2MB) is required.');
  }

  // ---- Begin transaction ----
  $pdo->beginTransaction();

  // files base path (SEMESTER-based folder, consistent with your old script)
  $uploadBase = __DIR__ . '/../uploads/accreditation';
  if (!is_dir($uploadBase)) @mkdir($uploadBase, 0775, true);
  $targetDir = $uploadBase . "/{$active_sem}/{$org_id}";
  if (!is_dir($targetDir)) @mkdir($targetDir, 0775, true);

  // Save one file
  $saveOne = function($field, $prefix) use ($org_id, $active_sem, $targetDir, $ALLOWED_MIME) {
    if (!isset($_FILES[$field]) || $_FILES[$field]['error'] !== UPLOAD_ERR_OK) return null;
    $ext = safe_ext_from_upload($_FILES[$field]['tmp_name'], $_FILES[$field]['name'], $ALLOWED_MIME, 'dat');
    $fname = "{$prefix}_org{$org_id}_" . time() . '.' . $ext;
    $dest = rtrim($targetDir,'/') . '/' . $fname;
    if (!@move_uploaded_file($_FILES[$field]['tmp_name'], $dest)) {
      throw new RuntimeException("Failed to store file: {$field}");
    }
    return "uploads/accreditation/{$active_sem}/{$org_id}/{$fname}";
  };

  // Insert accreditation_files row (semester + span for context)
  $insertDoc = function($pdo,$org_id,$group,$doc_type,$rel,$ay_sem,$ay_start,$ay_end,$author){
    $ins = $pdo->prepare("
      INSERT INTO accreditation_files
        (org_id, doc_group, doc_type, file_path,
         active_year, start_year, end_year, uploaded_by)
      VALUES (?,?,?,?,?,?,?,?)
    ");
    $ins->execute([$org_id,$group,$doc_type,$rel,$ay_sem,$ay_start,$ay_end,$author]);
  };

  // Save singles (doc_group = 'reaccreditation') per new keys
  $mapSingles = [
    'officers_list'                => 'officers_list',
    'members_list'                 => 'members_list',
    'adviser_moderator_acceptance' => 'adviser_moderator_acceptance',
    'awfp'                         => 'awfp',
    'cbl'                          => 'cbl',
    'bank_passbook'                => 'bank_passbook',
    'accomplishment_report'        => 'accomplishment_report',
    'financial_statement'          => 'financial_statement',
    'trainings_report'             => 'trainings_report',
    'presidents_report'            => 'presidents_report',
    'advisers_report'              => 'advisers_report',
    'evaluation'                   => 'evaluation',
    'contact_details'              => 'contact_details'
  ];
  foreach ($mapSingles as $field => $docType) {
    $rel = $saveOne($field, $docType);
    if (!$rel) throw new RuntimeException("Missing required file after precheck: {$field}");
    $insertDoc($pdo, $org_id, 'reaccreditation', $docType, $rel, $active_sem, $active_start, $active_end, $author);
  }

  // Optional: 18) General Program of Activities (Old)
  if (isset($_FILES['general_program']) &&
      $_FILES['general_program']['error'] === UPLOAD_ERR_OK &&
      $_FILES['general_program']['size'] <= $MAX_BYTES) {
    $rel = $saveOne('general_program','general_program');
    if ($rel) $insertDoc($pdo,$org_id,'reaccreditation','general_program',$rel,$active_sem,$active_start,$active_end,$author);
  }

  // 7) PDS of Officers (multiple)
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
    $rel = "uploads/accreditation/{$active_sem}/{$org_id}/{$fname}";
    $insertDoc($pdo, $org_id, 'reaccreditation', 'pds_officers', $rel, $active_sem, $active_start, $active_end, $author);
    $savedAny = true;
  }
  if (!$savedAny) throw new RuntimeException('At least one PDS file is required (max 2MB each).');

  // Update org to target semester/span and set back to Pending
  $upd = $pdo->prepare("
    UPDATE organizations
       SET status='Pending',
           active_year = :ay_sem,
           start_year  = :ay_start,
           end_year    = :ay_end
     WHERE id = :id
  ");
  $upd->execute([
    ':ay_sem'  => $active_sem,
    ':ay_start'=> $active_start,
    ':ay_end'  => $active_end,
    ':id'      => $org_id
  ]);

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
        ':title'      => 'New Reaccreditation Submitted',
        ':message'    => "Organization '{$org['name']}' ({$org['abbreviation']}) has been submitted for reaccreditation by {$authorName}.",
        ':payload_id' => $org_id
      ]);
    }
  }

  $pdo->commit();

  echo json_encode([
    'success'      => true,
    'org_id'       => $org_id,
    'semester'     => $active_sem,
    'start_year'   => $active_start,
    'end_year'     => $active_end,
    'message'      => 'Reaccreditation submitted (semester-based, new checklist)'
  ]);
}
catch (PDOException $e) {
  if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();

  if ($e->getCode() === '23000') {
    jerr(409, 'A conflicting organization already exists for this semester.');
  }
  jerr(500,'Database error',['detail'=>$e->getMessage()]);
}
catch (Throwable $e) {
  if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
  jerr(500,'Server error',['detail'=>$e->getMessage()]);
}