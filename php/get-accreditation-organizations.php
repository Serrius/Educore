<?php
// php/get-accreditation-organizations.php
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

  $role = strtolower(trim((string)($_SESSION['role'] ?? '')));
  $isSuper = ($role === 'super-admin');
  $isSpecial = ($role === 'special-admin');
  $isTreasurer = ($role === 'treasurer');
  
  // Debug logging (remove in production)
  error_log("User: $sessionId, Role: $role, IsSuper: " . ($isSuper?'Y':'N') . ", IsTreasurer: " . ($isTreasurer?'Y':'N'));

  // ---- Optional filters ----
  $scope = trim((string)($_GET['scope'] ?? ''));
  if ($scope === 'inclusive') $scope = 'general';
  
  // Debug
  error_log("Scope requested: $scope");

  // Choose span if provided
  $qs_sy = isset($_GET['start_year']) ? (int)$_GET['start_year'] : null;
  $qs_ey = isset($_GET['end_year'])   ? (int)$_GET['end_year']   : null;

  // Free-text query
  $q = trim((string)($_GET['q'] ?? ''));
  $like = $q !== '' ? '%'.$q.'%' : null;

  // ---- Build query ----
  $sql = "
    SELECT
      o.id,
      o.name,
      o.abbreviation,
      o.logo_path,
      o.scope,
      o.course_abbr,
      o.authors_id_number,
      o.admin_id_number,
      o.status,
      o.active_year,
      o.start_year,
      o.end_year,
      o.created_at
    FROM organizations o
    WHERE 1
  ";
  $params = [];

  // Access control
  if (!$isSuper && !$isSpecial) {
    if ($isTreasurer) {
      // Treasurers can see orgs where they are treasurer for CURRENT or SPECIFIED year
      $sql .= " AND EXISTS (
        SELECT 1 FROM organization_fees f
        WHERE f.org_id = o.id
        AND f.treasurer_id_number = :treasurer_id
      )";
      $params[':treasurer_id'] = $sessionId;
    } else {
      // Regular admin: only see orgs where they are admin
      $sql .= " AND o.admin_id_number = :admin_id";
      $params[':admin_id'] = $sessionId;
    }
  }

  // Scope filter
  if ($scope !== '' && in_array($scope, ['general', 'exclusive'])) {
    $sql .= " AND o.scope = :scope";
    $params[':scope'] = $scope;
  }

  // Year filter
  if ($qs_sy && $qs_ey) {
    $sql .= " AND ( 
      (o.start_year = :sy AND o.end_year = :ey) 
      OR (o.active_year = :ays) 
    )";
    $params[':sy'] = $qs_sy;
    $params[':ey'] = $qs_ey;
    $params[':ays'] = $qs_sy;
  }

  // Search filter
  if ($like !== null) {
    $sql .= "
      AND (
           CAST(o.id AS CHAR) LIKE :like
        OR o.name            LIKE :like
        OR o.abbreviation    LIKE :like
        OR o.course_abbr     LIKE :like
        OR o.status          LIKE :like
        OR o.scope           LIKE :like
        OR o.admin_id_number LIKE :like
        OR o.authors_id_number LIKE :like
      )
    ";
    $params[':like'] = $like;
  }

  $sql .= " ORDER BY o.created_at DESC, o.id DESC";
  
  // Debug: log the SQL and params
  error_log("SQL: $sql");
  error_log("Params: " . json_encode($params));

  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $orgs = $stmt->fetchAll(PDO::FETCH_ASSOC);
  
  // Debug: log results
  error_log("Found " . count($orgs) . " organizations");

  echo json_encode($orgs ?: []);
} catch (Throwable $e) {
  error_log("Error in get-accreditation-organizations: " . $e->getMessage());
  jerr(500, 'Server error', ['detail'=>$e->getMessage()]);
}