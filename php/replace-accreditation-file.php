<?php
header('Content-Type: application/json');
ini_set('display_errors','1'); error_reporting(E_ALL);
session_start();

function jerr($http,$msg,$extra=[]){ http_response_code($http); echo json_encode(['success'=>false,'message'=>$msg]+$extra); exit; }

try{
  require __DIR__ . '/database.php';
  if (empty($_SESSION['id_number'])) jerr(401,'Not authenticated');

  $role = $_SESSION['role'] ?? 'non-admin';
  $dept = $_SESSION['department'] ?? null;
  if ($role !== 'admin' && $role !== 'super-admin') jerr(403,'Forbidden');

  $adminId = $_SESSION['id_number'];
  $fileId  = isset($_POST['file_id']) ? (int)$_POST['file_id'] : 0;
  if ($fileId<=0) jerr(400,'Invalid file_id');

  // find file + org + verify DECLINED
  $q = $pdo->prepare("
    SELECT af.*, o.scope AS org_scope, o.course_abbr AS org_course_abbr
    FROM accreditation_files af
    JOIN organizations o ON o.id = af.org_id
    WHERE af.id = ?
    LIMIT 1
  ");
  $q->execute([$fileId]);
  $f = $q->fetch(PDO::FETCH_ASSOC);
  if (!$f) jerr(404,'File not found');
  if (strtolower($f['status']) !== 'declined') jerr(409,'Only declined files can be replaced.');

  // Scope enforcement for admin (super-admin bypasses)
  if ($role !== 'super-admin') {
    $ok = ($f['org_scope']==='general') ||
          ($f['org_scope']==='exclusive' && $dept && strcasecmp($f['org_course_abbr'],$dept)===0);
    if (!$ok) jerr(403,'Forbidden for your department scope.');
  }

  if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    jerr(400,'Missing file upload.');
  }

  $allowed = ['application/pdf'=>'pdf','image/png'=>'png','image/jpeg'=>'jpg','image/jpg'=>'jpg'];
  $max = 2*1024*1024;
  if ($_FILES['file']['size'] > $max) jerr(400,'File exceeds 2MB limit.');

  // pick extension
  $finfo = @finfo_open(FILEINFO_MIME_TYPE);
  $mime  = $finfo ? @finfo_file($finfo, $_FILES['file']['tmp_name']) : null;
  if ($finfo) @finfo_close($finfo);
  $ext = $allowed[$mime] ?? strtolower(pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION) ?: 'dat');

  // store under uploads/accreditation/{active_year}/{org_id}/
  $base = __DIR__ . '/../uploads/accreditation';
  if (!is_dir($base)) @mkdir($base, 0775, true);
  $targetDir = $base . "/{$f['active_year']}/{$f['org_id']}";
  if (!is_dir($targetDir)) @mkdir($targetDir, 0775, true);

  $safeType = preg_replace('/[^a-z0-9_]+/i', '_', strtolower($f['doc_type']));
  $fname = "{$safeType}_org{$f['org_id']}_" . time() . "." . $ext;
  $dest  = $targetDir . '/' . $fname;
  if (!move_uploaded_file($_FILES['file']['tmp_name'], $dest)) jerr(500,'Failed to save file.');

  $rel = "uploads/accreditation/{$f['active_year']}/{$f['org_id']}/{$fname}";

  // Update: path + reset status to 'submitted' + clear reason
  $u = $pdo->prepare("
    UPDATE accreditation_files
       SET file_path = :p, status = 'submitted', reason = NULL, uploaded_by = :u
     WHERE id = :id
  ");
  $u->execute([':p'=>$rel, ':u'=>$adminId, ':id'=>$fileId]);

  echo json_encode(['success'=>true,'file_id'=>$fileId,'new_status'=>'submitted','file_path'=>$rel]);
}catch(Throwable $e){
  jerr(500,'Server error',['detail'=>$e->getMessage()]);
}
