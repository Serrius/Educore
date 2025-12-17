<?php
// php/search-students.php
header('Content-Type: application/json');
ini_set('display_errors','1'); error_reporting(E_ALL);
session_start();

function jerr($http,$msg,$extra=[]){
  http_response_code($http);
  echo json_encode(['success'=>false,'message'=>$msg]+$extra);
  exit;
}

try{
  require __DIR__.'/database.php'; // must provide $pdo

  // Ensure exception mode (in case database.php didn’t set it)
  if (isset($pdo)) {
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
  }

  // ---- AuthZ ----
  $actor = $_SESSION['id_number'] ?? null;
  $role  = $_SESSION['role'] ?? '';
  if (!$actor) jerr(401,'Not authenticated.');
  // Allow admins and treasurers to search
  if (!in_array($role, ['admin','super-admin','special-admin','treasurer'], true)) {
    jerr(403,'Forbidden.');
  }

  // ---- Allow JSON bodies too ----
  $ctype = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
  if (stripos($ctype, 'application/json') !== false) {
    $raw = file_get_contents('php://input');
    if ($raw !== false && $raw !== '') {
      $json = json_decode($raw, true);
      if (is_array($json)) {
        // merge, but do not overwrite existing keys if already provided via GET
        $_GET = $json + $_GET;
        $_POST = $json + $_POST;
      }
    }
  }

  // ---- Inputs ----
  $q         = trim((string)($_GET['q'] ?? $_POST['q'] ?? ''));
  $limit_in  = (int)($_GET['limit'] ?? $_POST['limit'] ?? 8);
  $limit     = max(1, min(30, $limit_in)); // clamp 1..30

  // Optional filters (all optional & best-effort)
  $user_type = strtolower(trim((string)($_GET['user_type'] ?? $_POST['user_type'] ?? 'student'))); // usually 'student'
  $status    = trim((string)($_GET['status'] ?? $_POST['status'] ?? '')); // e.g., 'Active' (only applied if such column exists)
  $dept      = trim((string)($_GET['course_abbr'] ?? $_POST['course_abbr'] ?? $_GET['department'] ?? $_POST['department'] ?? ''));
  $active_y  = (int)($_GET['active_year'] ?? $_POST['active_year'] ?? 0); // echoed back in meta; not used for filtering here

  if (mb_strlen($q) < 2) jerr(400,'Query too short (min 2 chars).', ['min_chars'=>2]);

  // Check if "status" column exists to safely apply filter if requested.
  $hasStatus = false;
  try{
    $chk = $pdo->query("
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'users'
        AND COLUMN_NAME = 'status'
      LIMIT 1
    ")->fetchColumn();
    $hasStatus = (bool)$chk;
  } catch(Throwable $ie) {
    // if information_schema is restricted, just skip status filtering
    $hasStatus = false;
  }

  // Build WHERE
  $where = [];
  $params = [];

  // user_type filter (default student)
  if ($user_type !== '') {
    $where[] = "user_type = :utype";
    $params[':utype'] = $user_type;
  }

  // text search
  // Escape % and _ for LIKE; use backslash ESCAPE
  $likeAny   = '%'.str_replace(['%','_','\\'], ['\\%','\\_','\\\\'], $q).'%';
  $likeStart = str_replace(['%','_','\\'], ['\\%','\\_','\\\\'], $q).'%';
  $where[] = "(id_number LIKE :likeAny ESCAPE '\\\\' OR full_name LIKE :likeAny ESCAPE '\\\\')";
  $params[':likeAny'] = $likeAny;
  $params[':pfx']     = $likeStart;

  // department/course filter (optional)
  if ($dept !== '') {
    // In your schema, department is stored on users.department (used elsewhere)
    $where[] = "department = :dept";
    $params[':dept'] = $dept;
  }

  // status filter only if column exists and value provided
  if ($hasStatus && $status !== '') {
    $where[] = "status = :status";
    $params[':status'] = $status;
  }

  if (!$where) $where[] = '1=1';

  // Build SQL
  $whereSQL = implode(' AND ', $where);

  // Note: some MySQL versions don’t allow bound params in LIMIT; interpolate safe int instead.
  $limitSQL = (int)$limit;

  $sql = "
    SELECT
      id_number,
      full_name,
      department
    FROM users
    WHERE {$whereSQL}
    ORDER BY
      CASE
        WHEN id_number LIKE :pfx THEN 0
        WHEN full_name LIKE :pfx THEN 1
        ELSE 2
      END,
      full_name ASC,
      id_number ASC
    LIMIT {$limitSQL}
  ";

  $stmt = $pdo->prepare($sql);
  foreach ($params as $k=>$v) {
    $stmt->bindValue($k, $v);
  }
  $stmt->execute();
  $rows = $stmt->fetchAll();

  // Normalize output shape expected by the frontend
  $students = [];
  foreach ($rows as $r) {
    $students[] = [
      'id_number'   => (string)$r['id_number'],
      'full_name'   => (string)$r['full_name'],
      // Frontend expects these keys; year_level may not exist on users → return null
      'year_level'  => null,
      'course_abbr' => (string)($r['department'] ?? ''), // map department -> course_abbr-ish
    ];
  }

  echo json_encode([
    'success'  => true,
    'students' => $students,
    'meta'     => [
      'q'           => $q,
      'limit'       => $limit,
      'count'       => count($students),
      'active_year' => $active_y,
      'filtered_by' => [
        'user_type'  => $user_type ?: null,
        'status'     => ($hasStatus ? ($status ?: null) : null),
        'department' => $dept ?: null,
      ],
    ],
  ]);

} catch(Throwable $e){
  jerr(500, 'Server error: '.$e->getMessage(), [
    'trace' => $e->getFile().':'.$e->getLine()
  ]);
}
