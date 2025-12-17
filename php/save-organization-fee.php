<?php
// php/save-organization-fee.php
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

  // PDO sane defaults
  if (isset($pdo)) {
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
  }

  // ---- AuthZ ----
  $actor      = $_SESSION['id_number'] ?? null;
  $role       = strtolower((string)($_SESSION['role'] ?? ''));
  $myDept     = strtoupper(trim((string)($_SESSION['department'] ?? ''))); // e.g. BSIT
  if (!$actor) jerr(401,'Not authenticated.');
  if (!in_array($role, ['admin','super-admin','special-admin'], true)) jerr(403,'Forbidden.');

  // ---- Allow JSON bodies too ----
  $ctype = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
  if (stripos($ctype, 'application/json') !== false) {
    $raw = file_get_contents('php://input');
    if ($raw !== false && $raw !== '') {
      $json = json_decode($raw, true);
      if (is_array($json)) $_POST = $json + $_POST; // merge
    }
  }

  // ---- Inputs ----
  $fee_id       = isset($_POST['id']) ? (int)$_POST['id'] : 0; // 0 => create
  $org_id       = (int)($_POST['org_id'] ?? 0);

  // Accept both "category" and "fee_category"
  $catIn        = $_POST['fee_category'] ?? $_POST['category'] ?? 'department';
  $fee_category = strtolower(trim((string)$catIn)) === 'general' ? 'general' : 'department';

  $title    = trim((string)($_POST['title'] ?? ''));
  $desc     = trim((string)($_POST['description'] ?? ''));
  $currency = strtoupper(trim((string)($_POST['currency'] ?? 'PHP')));

  $amountIn = $_POST['amount'] ?? $_POST['paid_amount'] ?? null;
  if ($amountIn === null || $amountIn === '' || !is_numeric($amountIn)) {
    jerr(400,'Invalid amount.', ['received_amount'=>$amountIn]);
  }
  $amount = round((float)$amountIn, 2);

  // Semester-aware (REQUIRED)
  $start_year  = (int)($_POST['start_year']  ?? 0);
  $end_year    = (int)($_POST['end_year']    ?? 0);
  $active_year = (int)($_POST['active_year'] ?? 0);

  // Optional treasurer; validated below if present
  $treasurer_in = trim((string)($_POST['treasurer_id_number'] ?? ''));

  // ---- Validations ----
  if ($org_id<=0) jerr(400,'Missing/invalid org_id.');
  if (!$start_year || !$end_year) jerr(400,'Missing start_year/end_year.');
  if (!$active_year) jerr(400,'Missing active_year.');
  if (!in_array($active_year, [$start_year, $end_year], true)) {
    jerr(400,'active_year must equal start_year or end_year.');
  }
  if (!in_array($fee_category, ['department','general'], true)) jerr(400,'Invalid fee_category (use department/general).');
  if ($title==='') jerr(400,'Fee title is required.');
  if ($amount <= 0) jerr(400,'Amount must be > 0.');
  if ($currency==='' || strlen($currency)>3) jerr(400,'Invalid currency (max 3 chars).');

  // Validate organization
  $o = $pdo->prepare("SELECT id, name, scope, course_abbr, status FROM organizations WHERE id=? LIMIT 1");
  $o->execute([$org_id]);
  $org = $o->fetch();
  if (!$org) jerr(404,'Organization not found.');

  // Must be accredited or reaccredited
  $orgStatus = strtolower((string)($org['status'] ?? ''));
  if (!in_array($orgStatus, ['accredited','reaccredited'], true)) {
    jerr(409,'Organization must be Accredited or Reaccredited to manage fees.', ['org_status'=>$org['status']]);
  }

  // If department fee: org must be exclusive; and non-super-admins must match department
  if ($fee_category==='department') {
    if (strtolower((string)$org['scope'])!=='exclusive') {
      jerr(409,'This organization is not a department org (exclusive).');
    }
    $orgDept = strtoupper((string)$org['course_abbr']);
    if ($role !== 'super-admin') {
      if ($orgDept === '' || $myDept === '' || $orgDept !== $myDept) {
        jerr(403, 'Admins can only manage department fees for their own department.', [
          'your_department' => $myDept,
          'org_department'  => $orgDept
        ]);
      }
    }
  }

  // If treasurer provided, validate user and enforce uniqueness
  $promoteInfo = ['changed'=>false,'before'=>null,'after'=>null,'note'=>null];
  $demoteInfo  = ['changed'=>false,'id_number'=>null,'before'=>null,'after'=>null,'note'=>null];

  if ($treasurer_in !== '') {
    // Locate the treasurer by id_number in users
    $tu = $pdo->prepare("SELECT id_number, first_name, middle_name, last_name, suffix, user_type, department, role FROM users WHERE id_number=? LIMIT 1");
    $tu->execute([$treasurer_in]);
    $treasUser = $tu->fetch();
    if (!$treasUser) jerr(404,'Treasurer not found.', ['treasurer_id_number'=>$treasurer_in]);

    // Require student (if that’s your rule)
    if (strtolower((string)$treasUser['user_type']) !== 'student') {
      jerr(409,'Treasurer must be a student.');
    }

    if ($fee_category==='department') {
      // Must match department
      $orgDept = strtoupper((string)$org['course_abbr']);
      if (strtoupper((string)$treasUser['department']) !== $orgDept) {
        jerr(409,'Treasurer must belong to the organization’s department.', [
          'treasurer_department' => $treasUser['department'],
          'org_course_abbr'      => $org['course_abbr']
        ]);
      }

      // ✅ Uniqueness: block only if SAME dept + SAME span + SAME active_year (same semester)
      $dup = $pdo->prepare("
        SELECT f.id
          FROM organization_fees f
          JOIN organizations o ON o.id = f.org_id
         WHERE f.treasurer_id_number = :treas
           AND f.fee_category = 'department'
           AND UPPER(o.course_abbr) = UPPER(:dept)
           AND f.start_year = :sy
           AND f.end_year   = :ey
           AND f.active_year= :ay
           AND (:self_id IS NULL OR f.id <> :self_id)
         LIMIT 1
      ");
      $dup->execute([
        ':treas'   => $treasurer_in,
        ':dept'    => $org['course_abbr'],
        ':sy'      => $start_year,
        ':ey'      => $end_year,
        ':ay'      => $active_year,
        ':self_id' => $fee_id ?: null,
      ]);
      if ($dup->fetchColumn()) {
        jerr(
          409,
          'This user is already a treasurer for this department in the same academic year and semester.',
          [
            'treasurer_id_number' => $treasurer_in,
            'department'          => $org['course_abbr'],
            'start_year'          => $start_year,
            'end_year'            => $end_year,
            'active_year'         => $active_year
          ]
        );
      }
    }
  }

  // ---- Create/Update (transactional) ----
  $pdo->beginTransaction();

  // If no explicit id on update, allow upsert by unique tuple
  if ($fee_id <= 0) {
    $existing = $pdo->prepare("
      SELECT id, treasurer_id_number
        FROM organization_fees
       WHERE org_id = :org
         AND fee_category = :cat
         AND title = :title
         AND start_year = :sy
         AND end_year   = :ey
         AND active_year= :ay
       LIMIT 1
    ");
    $existing->execute([
      ':org'=>$org_id, ':cat'=>$fee_category, ':title'=>$title,
      ':sy'=>$start_year, ':ey'=>$end_year, ':ay'=>$active_year
    ]);
    if ($row = $existing->fetch()) {
      $fee_id = (int)$row['id'];
    }
  }

  if ($fee_id > 0) {
    // UPDATE
    $cur = $pdo->prepare("SELECT treasurer_id_number FROM organization_fees WHERE id=? AND org_id=? LIMIT 1");
    $cur->execute([$fee_id, $org_id]);
    $curRow = $cur->fetch();
    if (!$curRow) {
      jerr(404, 'Fee not found for update.');
    }
    $currentTreasurer = (string)($curRow['treasurer_id_number'] ?? '');

    $newTreas = ($treasurer_in !== '') ? $treasurer_in : $currentTreasurer;

    $upd = $pdo->prepare("
      UPDATE organization_fees
         SET fee_category = :cat,
             title        = :t,
             description  = :d,
             amount       = :a,
             currency     = :c,
             start_year   = :sy,
             end_year     = :ey,
             active_year  = :ay,
             treasurer_id_number = :treas,
             updated_at   = NOW()
       WHERE id = :id AND org_id = :org
      LIMIT 1
    ");
    $upd->execute([
      ':cat'=>$fee_category, ':t'=>$title, ':d'=>$desc, ':a'=>$amount, ':c'=>$currency,
      ':sy'=>$start_year, ':ey'=>$end_year, ':ay'=>$active_year,
      ':treas'=>$newTreas, ':id'=>$fee_id, ':org'=>$org_id
    ]);

    // Demote old treasurer if changed and not protected
    if ($treasurer_in !== '' && $currentTreasurer !== '' && $treasurer_in !== $currentTreasurer) {
      $prev = $pdo->prepare("SELECT id_number, role FROM users WHERE id_number=? LIMIT 1");
      $prev->execute([$currentTreasurer]);
      if ($pr = $prev->fetch()) {
        $demoteInfo['id_number'] = $pr['id_number'];
        $demoteInfo['before']    = $pr['role'];
        $demoteInfo['after']     = $pr['role'];
        $protected = ['admin','super-admin','special-admin'];
        $isProtected = in_array(strtolower((string)$pr['role']), $protected, true);
        if (!$isProtected && strtolower((string)$pr['role']) === 'treasurer') {
          $d = $pdo->prepare("UPDATE users SET role='non-admin' WHERE id_number=?");
          $d->execute([$pr['id_number']]);
          $demoteInfo['changed'] = true;
          $demoteInfo['after']   = 'non-admin';
        } else {
          $demoteInfo['note'] = $isProtected
            ? 'Previous treasurer has an admin-level role; role left unchanged.'
            : 'Previous treasurer did not have role=treasurer; left unchanged.';
        }
      }
    }

  } else {
    // INSERT
    $treasurerSave = ($treasurer_in !== '') ? $treasurer_in : '';
    $ins = $pdo->prepare("
      INSERT INTO organization_fees
        (org_id, fee_category, title, description, amount, currency,
         start_year, end_year, treasurer_id_number, active_year,
         created_by, created_at, updated_at)
      VALUES
        (:org, :cat, :t, :d, :a, :c,
         :sy, :ey, :treas, :ay,
         :by, NOW(), NOW())
    ");
    $ins->execute([
      ':org'=>$org_id, ':cat'=>$fee_category, ':t'=>$title, ':d'=>$desc, ':a'=>$amount, ':c'=>$currency,
      ':sy'=>$start_year, ':ey'=>$end_year, ':treas'=>$treasurerSave, ':ay'=>$active_year,
      ':by'=>$actor
    ]);
    $fee_id = (int)$pdo->lastInsertId();
  }

  // Promote NEW treasurer role if set and not admin-level
  if ($treasurer_in !== '') {
    $getTre = $pdo->prepare("SELECT id_number, role FROM users WHERE id_number=? LIMIT 1");
    $getTre->execute([$treasurer_in]);
    if ($tre = $getTre->fetch()) {
      $currentRole = strtolower((string)$tre['role']);
      $protected   = ['admin','super-admin','special-admin'];
      $promoteInfo['before'] = $tre['role'];
      $promoteInfo['after']  = $tre['role'];
      if (!in_array($currentRole, $protected, true) && $currentRole !== 'treasurer') {
        $uupd = $pdo->prepare("UPDATE users SET role='treasurer' WHERE id_number=?");
        $uupd->execute([$treasurer_in]);
        $promoteInfo['changed'] = true;
        $promoteInfo['after']   = 'treasurer';
      } elseif (in_array($currentRole, $protected, true)) {
        $promoteInfo['note'] = 'User has an admin-level role; left unchanged.';
      }
    }
  }

  $pdo->commit();

  // ---- Return saved fee row ----
  $stmt = $pdo->prepare("SELECT * FROM organization_fees WHERE id=? LIMIT 1");
  $stmt->execute([$fee_id]);
  $fee = $stmt->fetch() ?: [];

  // normalize numeric
  foreach (['id','org_id','amount','active_year','start_year','end_year'] as $k) {
    if (isset($fee[$k]) && is_numeric($fee[$k])) $fee[$k] = 0 + $fee[$k];
  }

  echo json_encode([
    'success'=>true,
    'fee'=>$fee,
    'role_change'=>[
      'promoted'=>$promoteInfo,
      'demoted'=>$demoteInfo
    ]
  ]);

}catch(PDOException $e){
  if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
  if ($e->getCode()==='23000') {
    jerr(409,'Duplicate fee for this org/semester (check unique keys & title).', ['detail'=>$e->getMessage()]);
  }
  jerr(500, 'Database error', ['detail'=>$e->getMessage()]);
}catch(Throwable $e){
  if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
  jerr(500, 'Server error', [
    'detail' => $e->getMessage(),
    'file'   => $e->getFile(),
    'line'   => $e->getLine(),
  ]);
}
//full_name