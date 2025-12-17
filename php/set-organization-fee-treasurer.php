<?php
// php/set-organization-fee-treasurer.php
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

  // Make sure PDO throws exceptions
  if (isset($pdo)) {
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
  }

  // ---- AuthZ ----
  $actor = $_SESSION['id_number'] ?? null;
  $role  = $_SESSION['role'] ?? '';
  if (!$actor) jerr(401,'Not authenticated.');
  if (!in_array($role, ['admin','super-admin'], true)) jerr(403,'Forbidden.');

  // ---- Accept JSON as well ----
  $ctype = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
  if (stripos($ctype, 'application/json') !== false) {
    $raw = file_get_contents('php://input');
    if ($raw !== false && $raw !== '') {
      $json = json_decode($raw, true);
      if (is_array($json)) $_POST = $json + $_POST;
    }
  }

  // ---- Inputs ----
  $fee_id = (int)($_POST['org_fee_id'] ?? 0);
  // accept either treasurer_id_number or treasurer_id
  $treasIn = trim((string)($_POST['treasurer_id_number'] ?? $_POST['treasurer_id'] ?? ''));

  if ($fee_id<=0 || $treasIn==='') jerr(400,'Missing org_fee_id or treasurer_id_number.');

  // ---- Load fee + org ----
  $f = $pdo->prepare("
    SELECT f.id, f.org_id, f.fee_category, f.active_year, f.treasurer_id_number,
           o.course_abbr, o.scope, o.name
      FROM organization_fees f
      JOIN organizations o ON o.id = f.org_id
     WHERE f.id = ?
     LIMIT 1
  ");
  $f->execute([$fee_id]);
  $fee = $f->fetch();
  if (!$fee) jerr(404,'Fee not found.');

  $feeCat     = strtolower((string)$fee['fee_category']);
  $orgScope   = strtolower((string)$fee['scope']);
  $deptAbbr   = (string)$fee['course_abbr'];
  $activeYear = (int)$fee['active_year'];

  if ($feeCat==='department' && $orgScope!=='exclusive') {
    jerr(409,'This fee is for department orgs only.');
  }

  // ---- Validate candidate treasurer user ----
  $u = $pdo->prepare("SELECT id_number, full_name, user_type, department, status, role FROM users WHERE id_number=? LIMIT 1");
  $u->execute([$treasIn]);
  $user = $u->fetch();
  if (!$user) jerr(404,'Treasurer user not found.');
  if (strtolower($user['user_type'])!=='student') jerr(409,'Treasurer must be a student.');

  if ($feeCat==='department') {
    // Must be same department
    if (strtoupper((string)$user['department']) !== strtoupper($deptAbbr)) {
      jerr(409,'Treasurer must belong to the same department as the organization.', [
        'treasurer_department' => $user['department'],
        'org_course_abbr'      => $deptAbbr
      ]);
    }
    // Block duplicate treasurer for same dept & same academic year (different years allowed)
    $dup = $pdo->prepare("
      SELECT f.id
        FROM organization_fees f
        JOIN organizations o ON o.id = f.org_id
       WHERE f.treasurer_id_number = :treas
         AND f.fee_category = 'department'
         AND f.active_year = :ay
         AND UPPER(o.course_abbr) = UPPER(:dept)
         AND f.id <> :curr
       LIMIT 1
    ");
    $dup->execute([
      ':treas'=>$treasIn,
      ':ay'=>$activeYear,
      ':dept'=>$deptAbbr,
      ':curr'=>$fee_id
    ]);
    if ($dup->fetchColumn()) {
      jerr(409, 'This user is already a treasurer for this department in the same academic year.', [
        'treasurer_id_number' => $treasIn,
        'department'          => $deptAbbr,
        'active_year'         => $activeYear
      ]);
    }
  }
  // (No same-year restriction for "general" orgs)

  // ---- Transaction: save treasurer & set role using the STORED treasurer_id_number ----
  $pdo->beginTransaction();

  // 1) Update fee with new treasurer_id_number
  $updFee = $pdo->prepare("UPDATE organization_fees SET treasurer_id_number = :t, updated_at = NOW() WHERE id = :id");
  $updFee->execute([':t'=>$treasIn, ':id'=>$fee_id]);

  // 2) Re-read the stored treasurer_id_number from the fee row (use this value to locate user)
  $reread = $pdo->prepare("SELECT treasurer_id_number FROM organization_fees WHERE id = ? LIMIT 1");
  $reread->execute([$fee_id]);
  $treasurerIdNumber = (string)$reread->fetchColumn();

  if ($treasurerIdNumber === '') {
    // Should not happen, but guard anyway
    throw new RuntimeException('Treasurer was not saved correctly on the fee.');
  }

  // 3) Load that user by the (stored) treasurer_id_number
  $u2 = $pdo->prepare("SELECT id_number, role FROM users WHERE id_number = ? LIMIT 1");
  $u2->execute([$treasurerIdNumber]);
  $treasurerUser = $u2->fetch();
  if (!$treasurerUser) {
    throw new RuntimeException('Stored treasurer_id_number does not match any user.');
  }

  // 4) Promote role (unless admin-level)
  $currentRole = strtolower((string)$treasurerUser['role']);
  $protected   = ['admin','super-admin','special-admin'];
  $roleChanged = false;
  $roleBefore  = $treasurerUser['role'];
  $roleAfter   = $treasurerUser['role'];

  if (!in_array($currentRole, $protected, true)) {
    $updUser = $pdo->prepare("UPDATE users SET role = 'treasurer' WHERE id_number = ?");
    $updUser->execute([$treasurerIdNumber]);
    $roleChanged = true;
    $roleAfter   = 'treasurer';
  }

  $pdo->commit();

  echo json_encode([
    'success'=>true,
    'org_fee_id'=>$fee_id,
    'treasurer'=>[
      'id_number'=>$treasurerIdNumber,
      'full_name'=>$user['full_name'] ?? null,
      'department'=>$user['department'] ?? null
    ],
    'role_change'=>[
      'changed'=>$roleChanged,
      'before'=>$roleBefore,
      'after'=>$roleAfter,
      'note'=> $roleChanged ? null : 'User has an admin-level role; left unchanged.'
    ]
  ]);

}catch(Throwable $e){
  if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
  jerr(500,'Server error',['detail'=>$e->getMessage()]);
}
