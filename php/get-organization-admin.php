<?php
// php/get-organization-admin.php  (LIST)
header('Content-Type: application/json');
ini_set('display_errors','1'); error_reporting(E_ALL);
session_start();

function jerr($http,$msg,$extra=[]){
  http_response_code($http);
  echo json_encode(['success'=>false,'message'=>$msg]+$extra);
  exit;
}

try {
  require __DIR__ . '/database.php';
  if (empty($_SESSION['id_number'])) jerr(401,'Not authenticated');

  $role       = $_SESSION['role'] ?? 'non-admin';
  $adminIdNum = $_SESSION['id_number'];

  // Current active academic year
  $ay = $pdo->query("
      SELECT active_year
        FROM academic_years
       WHERE status='Active'
       ORDER BY id DESC
       LIMIT 1
    ")->fetch(PDO::FETCH_ASSOC);

  if (!$ay) jerr(400,'No active academic year found.');
  $active_year = (int)$ay['active_year'];

  // ---------------------------
  // SUPER-ADMIN: See all orgs
  // ---------------------------
  if ($role === 'super-admin') {

    $stmt = $pdo->prepare("
      SELECT 
        o.id,
        o.name,
        o.abbreviation,
        o.logo_path,
        o.scope,
        o.course_abbr,
        o.status,
        o.active_year,
        o.start_year,
        o.end_year,
        o.created_at,
        o.admin_id_number,

        -- Build admin full name
        CONCAT(
          u.first_name, ' ',
          COALESCE(CONCAT(u.middle_name, ' '), ''),
          u.last_name,
          COALESCE(CONCAT(' ', u.suffix), '')
        ) AS admin_full_name,

        u.email AS admin_email,
        u.status AS admin_status

      FROM organizations o
      LEFT JOIN users u ON u.id_number = o.admin_id_number
      WHERE o.active_year = :yr
      ORDER BY o.created_at DESC, o.id DESC
    ");

    $stmt->execute([':yr'=>$active_year]);

  } else {

    // ---------------------------
    // NORMAL ADMIN: only their own orgs
    // ---------------------------
    $stmt = $pdo->prepare("
      SELECT 
        o.id,
        o.name,
        o.abbreviation,
        o.logo_path,
        o.scope,
        o.course_abbr,
        o.status,
        o.active_year,
        o.start_year,
        o.end_year,
        o.created_at,
        o.admin_id_number,

        -- Build admin full name
        CONCAT(
          u.first_name, ' ',
          COALESCE(CONCAT(u.middle_name, ' '), ''),
          u.last_name,
          COALESCE(CONCAT(' ', u.suffix), '')
        ) AS admin_full_name,

        u.email AS admin_email,
        u.status AS admin_status

      FROM organizations o
      LEFT JOIN users u ON u.id_number = o.admin_id_number
      WHERE o.active_year = :yr
        AND o.admin_id_number = :admin
      ORDER BY o.created_at DESC, o.id DESC
    ");

    $stmt->execute([
      ':yr'=>$active_year,
      ':admin'=>$adminIdNum
    ]);
  }

  echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC) ?: []);

} catch(Throwable $e){
  jerr(500,'Server error',['detail'=>$e->getMessage()]);
}
