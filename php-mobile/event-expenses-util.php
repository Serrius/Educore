<?php
// php/event-expenses-util.php
header('Content-Type: application/json');
ini_set('display_errors','1'); error_reporting(E_ALL);
if (session_status() === PHP_SESSION_NONE) session_start();

function jerr(int $http, string $msg, array $extra = []) {
  http_response_code($http);
  echo json_encode(['success'=>false,'message'=>$msg]+$extra);
  exit;
}
function jok(array $data = [], int $http = 200) {
  http_response_code($http);
  echo json_encode(['success'=>true]+$data);
  exit;
}
function require_auth(array $roles = ['admin','super-admin','treasurer', 'non-admin']) {
  $idnum = $_SESSION['id_number'] ?? null;
  $role  = $_SESSION['role'] ?? null;
  if (!$idnum) jerr(401,'Not authenticated.');
  if (!in_array($role, $roles, true)) jerr(403,'Forbidden.');
  return [$idnum, $role];
}
function db(): PDO {
  require __DIR__.'/database.php'; // must define $pdo
  if (!isset($pdo) || !$pdo instanceof PDO) jerr(500,'DB not available');
  $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
  return $pdo;
}
function get_active_year(PDO $pdo) {
  $row = $pdo->query("SELECT start_year,end_year,active_year
                      FROM academic_years
                      WHERE status='Active'
                      ORDER BY id DESC LIMIT 1")->fetch();
  if (!$row) jerr(409,'No active school year found.');
  return $row;
}
function read_json() {
  $ctype = $_SERVER['CONTENT_TYPE'] ?? '';
  if (stripos($ctype,'application/json') !== false) {
    $raw = file_get_contents('php://input');
    $j = json_decode($raw, true);
    if (!is_array($j)) jerr(400,'Invalid JSON.');
    return $j;
  }
  return $_POST;
}
