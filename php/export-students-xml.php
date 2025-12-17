<?php
// php/export-students-xml.php
// POST JSON: { "ids": [1,2,3] } -> returns XML file

ini_set('display_errors', '1');
error_reporting(E_ALL);

function jerr(int $code, string $msg) {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['success' => false, 'message' => $msg]);
  exit;
}

try {
  require __DIR__ . '/database.php';

  if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jerr(405, 'Use POST');
  }

  $raw = file_get_contents('php://input');
  $in  = json_decode($raw, true);
  if (!is_array($in) || !isset($in['ids']) || !is_array($in['ids'])) {
    jerr(400, 'Missing ids array.');
  }

  // sanitize ids -> integers, unique, non-empty
  $ids = array_values(array_unique(array_filter(array_map('intval', $in['ids']), fn($x) => $x > 0)));
  if (!$ids) {
    jerr(400, 'No valid ids provided.');
  }

  // build query using split name fields
  $ph = implode(',', array_fill(0, count($ids), '?'));
  $sql = "
    SELECT 
      id,
      id_number,
      first_name,
      middle_name,
      last_name,
      suffix,
      user_type,
      role,
      department,
      status,
      profile_picture,
      email,
      school_year,
      year,
      created_at
    FROM users
    WHERE id IN ($ph)
      AND id <> 1
      AND user_type = 'student'
  ";

  $stmt = $pdo->prepare($sql);
  $stmt->execute($ids);
  $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

  // Build XML
  $dom = new DOMDocument('1.0', 'UTF-8');
  $dom->formatOutput = true;

  $root = $dom->createElement('students');
  $root->setAttribute('generated_at', date('c'));
  $dom->appendChild($root);

  foreach ($rows as $r) {
    $stu = $dom->createElement('student');

    // Build full name from split fields for compatibility
    $parts = [];
    if (!empty($r['first_name']))  $parts[] = $r['first_name'];
    if (!empty($r['middle_name'])) $parts[] = $r['middle_name'];
    if (!empty($r['last_name']))   $parts[] = $r['last_name'];
    if (!empty($r['suffix']))      $parts[] = $r['suffix'];
    $fullName = trim(preg_replace('/\s+/', ' ', implode(' ', $parts)));

    // Helper to append a text node
    $append = function(string $name, $value) use ($dom, $stu) {
      $el = $dom->createElement($name);
      $el->appendChild($dom->createTextNode($value !== null ? (string)$value : ''));
      $stu->appendChild($el);
    };

    $append('id',             $r['id']);
    $append('id_number',      $r['id_number']);

    // New: export split name fields
    $append('first_name',     $r['first_name']  ?? '');
    $append('middle_name',    $r['middle_name'] ?? '');
    $append('last_name',      $r['last_name']   ?? '');
    $append('suffix',         $r['suffix']      ?? '');

    $append('email',          $r['email']);
    $append('user_type',      $r['user_type']);      // should be 'student'
    $append('role',           $r['role']);           // may be 'treasurer'
    $append('department',     $r['department']);     // abbreviation per latest change
    $append('school_year',    $r['school_year']);
    $append('year',           $r['year']);
    $append('status',         $r['status']);
    $append('profile_picture',$r['profile_picture']);
    $append('created_at',     $r['created_at']);

    $root->appendChild($stu);
  }

  $xml = $dom->saveXML();

  header('Content-Type: application/xml; charset=UTF-8');
  header('Content-Disposition: attachment; filename="students_export_' . time() . '.xml"');
  header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
  echo $xml;

} catch (Throwable $e) {
  jerr(500, 'Server error: ' . $e->getMessage());
}
