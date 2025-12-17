<?php
// php/get-accreditation-organizations.php
header('Content-Type: application/json');
ini_set('display_errors','1'); error_reporting(E_ALL);
session_start();

function jerr($http,$msg,$extra=[]) {
  http_response_code($http);
  echo json_encode(['success'=>false,'message'=>$msg]+$extra); exit;
}

try {
  require __DIR__ . '/database.php';

  // ---- Auth ----
  $me   = $_SESSION['id_number'] ?? null;
  $role = strtolower((string)($_SESSION['role'] ?? ''));
  if (!$me) jerr(401,'Not authenticated.');

  // ---- Inputs ----
  // scope: general | exclusive
  // Back-compat: if caller sends "inclusive", treat it as "general".
  $scopeIn = strtolower(trim((string)($_GET['scope'] ?? '')));
  if ($scopeIn === 'inclusive') $scopeIn = 'general';
  $scope = in_array($scopeIn, ['general','exclusive'], true) ? $scopeIn : '';

  // optional explicit span
  $qs_sy = isset($_GET['start_year']) ? (int)$_GET['start_year'] : null;
  $qs_ey = isset($_GET['end_year'])   ? (int)$_GET['end_year']   : null;

  // Map scope -> fee_category for treasurer check
  $feeCat = null;
  if ($scope === 'exclusive') $feeCat = 'department';
  if ($scope === 'general')   $feeCat = 'general';

  // ---- Active AY (span + legacy) ----
  $stmtAy = $pdo->query("
    SELECT start_year, end_year, active_year
    FROM academic_years
    WHERE status='Active'
    ORDER BY id DESC
    LIMIT 1
  ");
  $ay = $stmtAy->fetch(PDO::FETCH_ASSOC);
  if (!$ay) jerr(400,'No active academic year found.');

  $active_start  = (int)$ay['start_year'];
  $active_end    = (int)$ay['end_year'];
  $active_single = isset($ay['active_year']) ? (int)$ay['active_year'] : $active_start;

  // Use explicit span if valid, else active span
  $filter_start = ($qs_sy && $qs_ey) ? $qs_sy : $active_start;
  $filter_end   = ($qs_sy && $qs_ey) ? $qs_ey : $active_end;

  // ---- Query orgs for span (with legacy fallback), respecting scope + access control ----
  $qOrgs = function($sy,$ey,$ay_single,$scope,$feeCat,$me,$role) use ($pdo) {
    // super-admin can see all
    $isSuper = ($role === 'super-admin');
    $isSpecial = ($role === 'special-admin');

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
        o.start_year,
        o.end_year,
        o.start_year AS active_year,   -- UI back-compat
        o.created_at
      FROM organizations o
      WHERE (
              (o.start_year = :sy AND o.end_year = :ey)
           OR (o.active_year = :ay)      -- legacy fallback
      )
    ";
    $params = [':sy'=>$sy, ':ey'=>$ey, ':ay'=>$ay_single];

    if ($scope !== '') {
      $sql .= " AND o.scope = :scope";
      $params[':scope'] = $scope;
    }

    if (!$isSuper && !$isSpecial) {
      // Access: org admin OR treasurer for fee in this span (and matching fee_category if known)
      $sql .= "
        AND (
              o.admin_id_number = :me
           OR EXISTS (
               SELECT 1
                 FROM organization_fees f
                WHERE f.org_id = o.id
                  AND f.treasurer_id_number = :me
                  AND f.start_year = :sy
                  AND f.end_year   = :ey
                  " . ($feeCat ? "AND f.fee_category = :fcat" : "") . "
             )
        )
      ";
      $params[':me'] = $me;
      if ($feeCat) $params[':fcat'] = $feeCat;
    }

    $sql .= " ORDER BY o.created_at DESC, o.id DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
  };

  $orgs = $qOrgs($filter_start, $filter_end, $active_single, $scope, $feeCat, $me, $role);

  // Fallback: if none for chosen span, use the most recent previous span that has orgs (respecting scope + access)
  if (!$orgs) {
    $sqlPrev = "
      SELECT o.start_year, o.end_year
      FROM organizations o
      WHERE o.start_year < :sy
    ";
    $paramsPrev = [':sy'=>$filter_start];

    if ($scope !== '') {
      $sqlPrev .= " AND o.scope = :scope";
      $paramsPrev[':scope'] = $scope;
    }

    // Apply the same access gating in the fallback search
    $isSuper = ($role === 'super-admin');
    $isSpecial = ($role === 'special-admin');
    if (!$isSuper && !$isSpecial) {
      $sqlPrev .= "
        AND (
              o.admin_id_number = :me
           OR EXISTS (
               SELECT 1
                 FROM organization_fees f
                WHERE f.org_id = o.id
                  AND f.treasurer_id_number = :me
                  AND f.start_year = o.start_year
                  AND f.end_year   = o.end_year
                  " . ($feeCat ? "AND f.fee_category = :fcat" : "") . "
             )
        )
      ";
      $paramsPrev[':me'] = $me;
      if ($feeCat) $paramsPrev[':fcat'] = $feeCat;
    }

    $sqlPrev .= " ORDER BY o.start_year DESC LIMIT 1";

    $prev = $pdo->prepare($sqlPrev);
    $prev->execute($paramsPrev);
    $span = $prev->fetch(PDO::FETCH_ASSOC);

    if ($span) {
      $filter_start = (int)$span['start_year'];
      $filter_end   = (int)$span['end_year'];
      // legacy fallback uses start_year as the single-year value
      $orgs = $qOrgs($filter_start, $filter_end, $filter_start, $scope, $feeCat, $me, $role);
    }
  }

  if (!$orgs) { echo json_encode([]); exit; }

  // ---- Summarize accreditation_files for the SAME span (with legacy fallback) ----
  $ids = array_column($orgs, 'id');
  $placeholders = implode(',', array_fill(0, count($ids), '?'));

  $sqlFs = "
    SELECT
      org_id,
      doc_group,
      doc_type,
      SUM(status='submitted') AS submitted_cnt,
      SUM(status='approved')  AS approved_cnt,
      SUM(status='declined')  AS declined_cnt
    FROM accreditation_files
    WHERE org_id IN ($placeholders)
      AND (
            (start_year = ? AND end_year = ?)
         OR (active_year = ?)                 -- legacy fallback
      )
    GROUP BY org_id, doc_group, doc_type
  ";
  $fs = $pdo->prepare($sqlFs);
  $params = $ids;
  $params[] = $filter_start;
  $params[] = $filter_end;
  $params[] = $filter_start; // legacy fallback
  $fs->execute($params);
  $rows = $fs->fetchAll(PDO::FETCH_ASSOC);

  // group and attach
  $summary = [];
  foreach ($rows as $r) {
    $oid = (int)$r['org_id'];
    if (!isset($summary[$oid])) $summary[$oid] = [];
    $summary[$oid][] = $r;
  }
  foreach ($orgs as &$o) {
    $oid = (int)$o['id'];
    $o['files'] = isset($summary[$oid]) ? $summary[$oid] : [];
  }
  unset($o);

  echo json_encode($orgs);

} catch(Throwable $e) {
  jerr(500, 'Server error', ['detail'=>$e->getMessage()]);
}
