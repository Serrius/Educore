<?php
// php/get-organization.php
header('Content-Type: application/json');
ini_set('display_errors','1'); error_reporting(E_ALL);

function jerr($http,$msg,$extra=[]) {
  http_response_code($http);
  echo json_encode(['success'=>false,'message'=>$msg]+$extra); exit;
}

try {
  require __DIR__ . '/database.php';
  $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
  if ($id<=0) jerr(400,'Invalid org id');

  $ay = $pdo->query("SELECT active_year FROM academic_years WHERE status='Active' ORDER BY id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
  if (!$ay) jerr(400,'No active academic year found.');
  $active_year = (int)$ay['active_year'];

  $o = $pdo->prepare("SELECT * FROM organizations WHERE id=? LIMIT 1");
  $o->execute([$id]);
  $org = $o->fetch(PDO::FETCH_ASSOC);
  if (!$org) jerr(404,'Organization not found');

  $f = $pdo->prepare("
    SELECT id, doc_group, doc_type, file_path, status, reason, uploaded_by, created_at
    FROM accreditation_files
    WHERE org_id=? AND active_year=?
    ORDER BY created_at DESC, id DESC
  ");
  $f->execute([$id,$active_year]);
  $files = $f->fetchAll(PDO::FETCH_ASSOC);

  echo json_encode(['success'=>true,'org'=>$org,'files'=>$files, 'active_year'=>$active_year]);
} catch(Throwable $e) {
  jerr(500,'Server error',['detail'=>$e->getMessage()]);
}
