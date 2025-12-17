<?php
// php/get-organization-fee.php
header('Content-Type: application/json');
ini_set('display_errors','1'); error_reporting(E_ALL);
session_start();

function jerr($http,$msg,$extra=[]){
  http_response_code($http);
  echo json_encode(['success'=>false,'message'=>$msg]+$extra);
  exit;
}

try{
  require __DIR__.'/database.php';
  if (!isset($_SESSION['id_number'])) jerr(401,'Not authenticated.');

  // Accept JSON too
  $ctype = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
  if ($ctype && stripos($ctype,'application/json')!==false) {
    $raw = file_get_contents('php://input');
    if ($raw!=='' && $raw!==false) {
      $json = json_decode($raw,true);
      if (is_array($json)) $_GET = $json + $_GET;
    }
  }

  // Inputs
  $org_id = (int)($_GET['org_id'] ?? 0);
  $catIn  = $_GET['fee_category'] ?? $_GET['category'] ?? 'department';
  $cat    = strtolower(trim((string)$catIn));
  $sy     = isset($_GET['start_year'])  && $_GET['start_year']  !== '' ? (int)$_GET['start_year']  : null;
  $ey     = isset($_GET['end_year'])    && $_GET['end_year']    !== '' ? (int)$_GET['end_year']    : null;
  $ay     = isset($_GET['active_year']) && $_GET['active_year'] !== '' ? (int)$_GET['active_year'] : null;

  if ($org_id<=0) jerr(400,'Missing org_id.');
  if (!in_array($cat, ['department','general'], true)) jerr(400,'Invalid fee_category (use department/general).');

  // If a span is provided, make sure AY (when provided) belongs to the span
  if ($sy!==null && $ey!==null && $ay!==null && !in_array($ay, [$sy,$ey], true)) {
    jerr(400,'active_year must equal start_year or end_year for the given span.');
  }

  $fee = null;

  // 1) Exact match when we have full tuple (org, cat, span, active_year)
  if ($sy!==null && $ey!==null && $ay!==null) {
    $st = $pdo->prepare("
      SELECT * FROM organization_fees
       WHERE org_id=? AND fee_category=? AND start_year=? AND end_year=? AND active_year=?
       LIMIT 1
    ");
    $st->execute([$org_id,$cat,$sy,$ey,$ay]);
    $fee = $st->fetch(PDO::FETCH_ASSOC);
  }

  // 2) Span-only (pick latest inside span) if AY omitted
  if (!$fee && $sy!==null && $ey!==null) {
    $st = $pdo->prepare("
      SELECT * FROM organization_fees
       WHERE org_id=? AND fee_category=? AND start_year=? AND end_year=?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1
    ");
    $st->execute([$org_id,$cat,$sy,$ey]);
    $fee = $st->fetch(PDO::FETCH_ASSOC);
  }

  // 3) Active-year only (no span) — choose most recent row for that AY
  if (!$fee && $ay!==null) {
    $st = $pdo->prepare("
      SELECT * FROM organization_fees
       WHERE org_id=? AND fee_category=? AND active_year=?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1
    ");
    $st->execute([$org_id,$cat,$ay]);
    $fee = $st->fetch(PDO::FETCH_ASSOC);
  }

  // 4) Last resort: latest for org/category
  if (!$fee) {
    $st = $pdo->prepare("
      SELECT * FROM organization_fees
       WHERE org_id=? AND fee_category=?
       ORDER BY updated_at DESC, id DESC
       LIMIT 1
    ");
    $st->execute([$org_id,$cat]);
    $fee = $st->fetch(PDO::FETCH_ASSOC);
  }

  if (!$fee) { echo json_encode(['success'=>true,'fee'=>null]); exit; }

  foreach (['id','org_id','amount','start_year','end_year','active_year'] as $k) {
    if (isset($fee[$k]) && is_numeric($fee[$k])) $fee[$k] = 0 + $fee[$k];
  }

  echo json_encode(['success'=>true,'fee'=>$fee]);

}catch(Throwable $e){
  jerr(500,'Server error',['detail'=>$e->getMessage()]);
}
