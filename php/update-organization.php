<?php
// php/update-organization.php
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

  // ---- Auth (trust the session) ----
  if (!isset($_SESSION['id_number']) || !$_SESSION['id_number']) {
    jerr(401, 'Not authenticated.');
  }

  // ---- Inputs ----
  $org_id = (int)($_POST['org_id'] ?? 0);
  $name_in = trim($_POST['org_name'] ?? '');
  $abbr_in = trim($_POST['org_abbr'] ?? '');
  $scope   = (($_POST['scope'] ?? '') === 'exclusive') ? 'exclusive' : 'general';
  $course_abbr_in = trim($_POST['course_abbr'] ?? '');
  // admin is optional; empty string clears it
  $admin_id_number = isset($_POST['admin_id_number'])
    ? (trim($_POST['admin_id_number']) ?: null)
    : null;

  if ($org_id <= 0) jerr(400,'Missing organization id.');
  if ($name_in === '') jerr(400,'Organization name is required.');
  if ($abbr_in === '') jerr(400,'Organization abbreviation is required.');
  if ($scope === 'exclusive' && $course_abbr_in === '') {
    jerr(400,'Course/Department is required for exclusive org.');
  }

  // Normalize
  $name = preg_replace('/\s+/', ' ', $name_in);
  $abbr = strtoupper($abbr_in);
  $course_abbr = ($course_abbr_in !== '') ? strtoupper($course_abbr_in) : null;

  // ---- Fetch current org (for AY span + current logo path) ----
  $org = $pdo->prepare("SELECT id, start_year, end_year, scope, course_abbr, logo_path FROM organizations WHERE id = ?");
  $org->execute([$org_id]);
  $row = $org->fetch(PDO::FETCH_ASSOC);
  if (!$row) jerr(404, 'Organization not found.');

  $ay_start = (int)$row['start_year'];
  $ay_end   = (int)$row['end_year'];
  $existing_logo = $row['logo_path'];

  // ---- Duplicate guard within same AY span (excluding self) ----
  $dup = $pdo->prepare("
    SELECT id FROM organizations
    WHERE id <> :id AND start_year = :sy AND end_year = :ey
      AND (abbreviation = :abbr OR LOWER(name) = LOWER(:name))
    LIMIT 1
  ");
  $dup->execute([':id'=>$org_id, ':sy'=>$ay_start, ':ey'=>$ay_end, ':abbr'=>$abbr, ':name'=>$name]);
  if ($dup->fetchColumn()) {
    jerr(409, 'Another organization with that name or abbreviation already exists in this academic year span.');
  }

  // ---- Exclusive-per-course guard (excluding self) ----
  if ($scope === 'exclusive' && $course_abbr) {
    $ex = $pdo->prepare("
      SELECT id FROM organizations
      WHERE id <> :id AND start_year = :sy AND end_year = :ey
        AND scope = 'exclusive' AND course_abbr = :course
      LIMIT 1
    ");
    $ex->execute([':id'=>$org_id, ':sy'=>$ay_start, ':ey'=>$ay_end, ':course'=>$course_abbr]);
    if ($ex->fetchColumn()) {
      jerr(409, 'This course already has an exclusive organization for the active academic year.');
    }
  }

  // ---- Optional logo upload ----
  $ALLOWED_MIME = [
    'image/png'  => 'png',
    'image/jpeg' => 'jpg',
    'image/jpg'  => 'jpg'
  ];
  $MAX_BYTES = 2 * 1024 * 1024; // 2MB

  $newLogoRel = null;
  if (isset($_FILES['org_logo']) && $_FILES['org_logo']['error'] !== UPLOAD_ERR_NO_FILE) {
    if ($_FILES['org_logo']['error'] !== UPLOAD_ERR_OK) {
      jerr(400, 'Logo upload error (code '.$_FILES['org_logo']['error'].').');
    }
    if ($_FILES['org_logo']['size'] > $MAX_BYTES) {
      jerr(400, 'Logo exceeds 2MB limit.');
    }

    // Detect extension via finfo, fallback to original
    $finfo = @finfo_open(FILEINFO_MIME_TYPE);
    $mime  = $finfo ? @finfo_file($finfo, $_FILES['org_logo']['tmp_name']) : null;
    if ($finfo) @finfo_close($finfo);
    $ext = null;
    if ($mime && isset($ALLOWED_MIME[$mime])) {
      $ext = $ALLOWED_MIME[$mime];
    } else {
      $ext = strtolower(pathinfo($_FILES['org_logo']['name'], PATHINFO_EXTENSION)) ?: 'dat';
      if ($ext === 'jpeg') $ext = 'jpg';
      if (!in_array($ext, ['png','jpg'], true)) {
        jerr(400, 'Unsupported logo type. Use PNG or JPG.');
      }
    }

    // Keep legacy path layout: uploads/accreditation/{start_year}/{org_id}/
    $uploadBase = __DIR__ . '/../uploads/accreditation';
    if (!is_dir($uploadBase)) @mkdir($uploadBase, 0775, true);
    $targetDir = $uploadBase . "/{$ay_start}/{$org_id}";
    if (!is_dir($targetDir)) @mkdir($targetDir, 0775, true);

    $fname = "org_logo_org{$org_id}_" . time() . '.' . $ext;
    $dest = rtrim($targetDir,'/') . '/' . $fname;
    if (!@move_uploaded_file($_FILES['org_logo']['tmp_name'], $dest)) {
      jerr(500, 'Failed to store uploaded logo.');
    }
    $newLogoRel = "uploads/accreditation/{$ay_start}/{$org_id}/{$fname}";
  }

  // ---- Build UPDATE ----
  $pdo->beginTransaction();

  $sets = [
    'name = :name',
    'abbreviation = :abbr',
    'scope = :scope',
    'course_abbr = :course',
    'admin_id_number = :admin'
  ];
  $params = [
    ':name'  => $name,
    ':abbr'  => $abbr,
    ':scope' => $scope,
    ':course'=> ($scope === 'exclusive' ? $course_abbr : null),
    ':admin' => $admin_id_number, // can be NULL (to clear)
    ':id'    => $org_id
  ];

  if ($newLogoRel !== null) {
    $sets[] = 'logo_path = :logo';
    $params[':logo'] = $newLogoRel;
  }

  $sql = "UPDATE organizations SET ".implode(', ', $sets)." WHERE id = :id";
  $upd = $pdo->prepare($sql);
  $upd->execute($params);

  $pdo->commit();

  echo json_encode([
    'success' => true,
    'message' => 'Organization updated',
    'org_id'  => $org_id,
    'logo'    => ($newLogoRel ?? $existing_logo),
  ]);

} catch (PDOException $e) {
  if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
  if ($e->getCode() === '23000') {
    jerr(409, 'Duplicate value detected for this academic year span.');
  }
  jerr(500, 'Database error', ['detail'=>$e->getMessage()]);
} catch (Throwable $e) {
  if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
  jerr(500, 'Server error', ['detail'=>$e->getMessage()]);
}
