<?php
// php/get-all-students.php
header('Content-Type: application/json');
ini_set('display_errors','1'); 
error_reporting(E_ALL);
session_start();

function jerr($http,$msg,$extra=[]){
  http_response_code($http);
  echo json_encode(['success'=>false,'message'=>$msg]+$extra);
  exit;
}

try{
  require __DIR__.'/database.php'; // provides $pdo
  if (!isset($_SESSION['id_number'])) jerr(401,'Not authenticated.');
  $role = $_SESSION['role'] ?? '';
  if (!in_array($role, ['admin','super-admin','special-admin','treasurer'], true)) {
    jerr(403,'Forbidden.');
  }

  if (isset($pdo)) {
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
  }

  // ---- Inputs ----
  $q        = trim((string)($_GET['q'] ?? $_POST['q'] ?? ''));                 // optional search text
  $statusIn = trim((string)($_GET['status'] ?? $_POST['status'] ?? 'Active')); // 'Active' by default; use 'all' to disable
  $dept     = trim((string)(
      $_GET['department']     ?? $_POST['department'] ??
      $_GET['course_abbr']    ?? $_POST['course_abbr'] ??
      ''
  )); // optional
  $sy       = (int)($_GET['start_year'] ?? $_POST['start_year'] ?? 0);
  $ey       = (int)($_GET['end_year']   ?? $_POST['end_year']   ?? 0);
  $schoolYr = trim((string)($_GET['school_year'] ?? $_POST['school_year'] ?? '')); // optional direct string ("2024-2025")

  // pagination (big default but clamped)
  $limitIn  = (int)($_GET['limit'] ?? $_POST['limit'] ?? 5000);
  $pageIn   = (int)($_GET['page']  ?? $_POST['page']  ?? 1);
  $limit    = max(1, min(10000, $limitIn));
  $page     = max(1, $pageIn);
  $offset   = ($page - 1) * $limit;

  // ---- WHERE builder ----
  $where = ["user_type = 'student'"];
  $params = [];

  if (strcasecmp($statusIn, 'all') !== 0 && $statusIn !== '') {
    $where[] = "status = :status";
    $params[':status'] = $statusIn;
  }

  // Department filter ONLY if explicitly provided
  if ($dept !== '' && strcasecmp($dept,'all') !== 0) {
    $where[] = "department = :dept";
    $params[':dept'] = $dept;
  }

  // Academic year filter (match users.school_year e.g. "2024-2025")
  if ($sy > 0 && $ey > 0) {
    $where[] = "school_year = :syey";
    $params[':syey'] = $sy . '-' . $ey;
  } elseif ($schoolYr !== '') {
    $where[] = "school_year = :schoolyear";
    $params[':schoolyear'] = $schoolYr;
  }

  // Optional search text
  if ($q !== '') {
    if (mb_strlen($q) < 2) {
      jerr(400,'Query too short (min 2 chars).', ['min_chars'=>2]);
    }
    $like = '%'.str_replace(['%','_','\\'], ['\\%','\\_','\\\\'], $q).'%';

    // 🔁 UPDATED: search across first_name, middle_name, last_name, suffix (no more full_name column)
    $where[] = "(
      id_number  LIKE :like ESCAPE '\\\\'
      OR first_name  LIKE :like ESCAPE '\\\\'
      OR middle_name LIKE :like ESCAPE '\\\\'
      OR last_name   LIKE :like ESCAPE '\\\\'
      OR suffix      LIKE :like ESCAPE '\\\\'
    )";
    $params[':like'] = $like;
  }

  $whereSQL = implode(' AND ', $where);

  // ---- Query ----
  // 🔁 UPDATED: select individual name parts instead of full_name
  $sql = "
    SELECT
      id_number,
      first_name,
      middle_name,
      last_name,
      suffix,
      department,      -- mapped to course_abbr in response
      `year` AS year_level,
      school_year
    FROM users
    WHERE {$whereSQL}
    ORDER BY last_name ASC, first_name ASC, id_number ASC
    LIMIT {$limit} OFFSET {$offset}
  ";

  $stmt = $pdo->prepare($sql);
  foreach ($params as $k=>$v) {
    $stmt->bindValue($k,$v);
  }
  $stmt->execute();
  $rows = $stmt->fetchAll();

  // ---- Normalize for frontend ----
  $students = [];
  foreach ($rows as $r) {
    $first  = trim((string)($r['first_name']  ?? ''));
    $middle = trim((string)($r['middle_name'] ?? ''));
    $last   = trim((string)($r['last_name']   ?? ''));
    $suffix = trim((string)($r['suffix']      ?? ''));

    // Build a nice full_name: "First M. Last Suffix"
    $nameParts = [];
    if ($first !== '')  $nameParts[] = $first;
    if ($middle !== '') $nameParts[] = $middle;
    if ($last !== '')   $nameParts[] = $last;

    $full = implode(' ', $nameParts);
    if ($suffix !== '') {
      $full .= ' ' . $suffix;
    }
    $full = trim(preg_replace('/\s+/', ' ', $full));

    $students[] = [
      'id_number'   => (string)$r['id_number'],
      // keep this key because frontend expects full_name (treasurer & payer typeahead)
      'full_name'   => $full,
      'first_name'  => $first,
      'middle_name' => $middle,
      'last_name'   => $last,
      'suffix'      => $suffix,
      'year_level'  => isset($r['year_level']) ? (string)$r['year_level'] : '',
      'course_abbr' => (string)($r['department'] ?? ''),  // UI expects this key
      'department'  => (string)($r['department'] ?? ''),
      'school_year' => (string)($r['school_year'] ?? ''),
    ];
  }

  echo json_encode([
    'success'  => true,
    'students' => $students,
    'meta'     => [
      'q'           => ($q !== '' ? $q : null),
      'status'      => $statusIn ?: null,
      'department'  => $dept ?: null,
      'school_year' => ($sy>0 && $ey>0) ? ($sy.'-'.$ey) : ($schoolYr ?: null),
      'limit'       => $limit,
      'page'        => $page,
      'count'       => count($students)
    ],
  ]);

}catch(Throwable $e){
  jerr(500, 'Server error: '.$e->getMessage(), [
    'trace' => $e->getFile().':'.$e->getLine()
  ]);
}
