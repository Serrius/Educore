<?php
// php/get-accreditation-organizations-admin.php
header('Content-Type: application/json');
ini_set('display_errors','1'); error_reporting(E_ALL);
session_start();

function jerr($http,$msg,$extra=[]) {
  http_response_code($http);
  echo json_encode(['success'=>false,'message'=>$msg]+$extra);
  exit;
}

try {
  require __DIR__ . '/database.php';

  // ---- Auth ----
  $sessionId = $_SESSION['id_number'] ?? null;
  if (!$sessionId) jerr(401, 'Not authenticated');

  $roleRaw = strtolower(trim((string)($_SESSION['role'] ?? '')));
  $isSuper = in_array($roleRaw, ['super-admin','superadmin','super admin','sa'], true);

  // ---- Optional filters ----
  // scope: general | exclusive (back-compat: inclusive -> general)
  $scopeIn = strtolower(trim((string)($_GET['scope'] ?? '')));
  if ($scopeIn === 'inclusive') $scopeIn = 'general';
  $scope = in_array($scopeIn, ['general','exclusive'], true) ? $scopeIn : '';

  // Choose span if provided; otherwise return ALL spans
  $qs_sy = isset($_GET['start_year']) ? (int)$_GET['start_year'] : null;
  $qs_ey = isset($_GET['end_year'])   ? (int)$_GET['end_year']   : null;

  // Free-text query across common columns
  $q = trim((string)($_GET['q'] ?? ''));
  $like = $q !== '' ? '%'.$q.'%' : null;

  // ---- Build query (filtered by admin unless super-admin) ----
  $sql = "
    SELECT
      id,
      name,
      abbreviation,
      logo_path,
      scope,
      course_abbr,
      authors_id_number,
      admin_id_number,
      status,
      active_year,
      start_year,
      end_year,
      created_at
    FROM organizations
    WHERE 1
  ";
  $params = [];

  // Admin visibility constraint
  if (!$isSuper) {
    $sql .= " AND admin_id_number = :admin_id";
    $params[':admin_id'] = trim((string)$sessionId);
  }

  if ($scope !== '') {
    $sql .= " AND scope = :scope";
    $params[':scope'] = $scope;
  }

  if ($qs_sy && $qs_ey) {
    // If a span is explicitly requested, honor both modern and legacy columns
    $sql .= " AND ( (start_year = :sy AND end_year = :ey) OR (active_year = :ays) )";
    $params[':sy']  = $qs_sy;
    $params[':ey']  = $qs_ey;
    $params[':ays'] = $qs_sy; // legacy single-year fallback
  }

  if ($like !== null) {
    $sql .= "
      AND (
           CAST(id AS CHAR) LIKE :like
        OR name            LIKE :like
        OR abbreviation    LIKE :like
        OR course_abbr     LIKE :like
        OR status          LIKE :like
        OR scope           LIKE :like
        OR admin_id_number LIKE :like
        OR authors_id_number LIKE :like
      )
    ";
    $params[':like'] = $like;
  }

  $sql .= " ORDER BY created_at DESC, id DESC";

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $orgs = $stmt->fetchAll(PDO::FETCH_ASSOC);

  echo json_encode($orgs ?: []);
} catch (Throwable $e) {
  jerr(500, 'Server error', ['detail'=>$e->getMessage()]);
}
