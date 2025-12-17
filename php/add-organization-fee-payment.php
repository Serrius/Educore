<?php
// php/add-organization-fee-payment.php
header('Content-Type: application/json');
ini_set('display_errors','1'); error_reporting(E_ALL);
session_start();

function jerr($http,$msg,$extra=[]){ http_response_code($http); echo json_encode(['success'=>false,'message'=>$msg]+$extra); exit; }

try{
  require __DIR__.'/database.php';

  $actor = $_SESSION['id_number'] ?? null;
  if (!$actor) jerr(401,'Not authenticated.');

  // Accept form-data or JSON
  $data = $_POST;
  if (!$data) {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw,true) ?: [];
  }

  $fee_id   = (int)($data['org_fee_id'] ?? 0);
  $payer_id = trim((string)($data['payer_id_number'] ?? ''));
  $amount   = isset($data['paid_amount']) ? (float)$data['paid_amount'] : null;

  $methodIn = strtolower(trim((string)($data['payment_method'] ?? 'cash')));
  $method   = in_array($methodIn, ['cash','online','other'], true) ? $methodIn : 'cash';

  $statusIn = strtolower(trim((string)($data['status'] ?? 'confirmed')));
  $status   = in_array($statusIn, ['recorded','confirmed','void'], true) ? $statusIn : 'confirmed';

  $notes    = trim((string)($data['notes'] ?? ''));
  $paid_on  = trim((string)($data['paid_on'] ?? '')); // optional

  // AY/span: client may send them; we will validate against the fee row
  $ayIn     = isset($data['active_year']) ? (int)$data['active_year'] : 0;
  $syIn     = isset($data['start_year'])  ? (int)$data['start_year']  : 0;
  $eyIn     = isset($data['end_year'])    ? (int)$data['end_year']    : 0;

  if ($fee_id <= 0 || $payer_id === '' || !is_finite($amount) || $amount <= 0) {
    jerr(400,'Missing/invalid fields.');
  }

  // Validate receipt number (notes field)
  if (empty($notes)) {
    jerr(400,'Receipt number is required.');
  }
  
  // Validate receipt number format (numbers and dashes only)
  if (!preg_match('/^[0-9\-]+$/', $notes)) {
    jerr(400,'Receipt number can only contain numbers and dashes.');
  }
  
  // Check for duplicate receipt number
  $dupReceipt = $pdo->prepare("SELECT 1 FROM organization_fee_payments WHERE receipt_no=? LIMIT 1");
  $dupReceipt->execute([$notes]);
  if ($dupReceipt->fetchColumn()) {
    jerr(409,'This receipt number already exists. Please use a unique receipt number.');
  }

  // Load fee + org context (we also get the fee span here)
  $st = $pdo->prepare("
    SELECT f.id, f.org_id, f.fee_category, f.active_year, f.start_year, f.end_year,
           f.title as fee_title, f.amount as fee_amount,
           o.course_abbr, o.name as org_name, o.abbreviation as org_abbr,
           o.admin_id_number
      FROM organization_fees f
      JOIN organizations o ON o.id = f.org_id
     WHERE f.id = ?
     LIMIT 1
  ");
  $st->execute([$fee_id]);
  $fee = $st->fetch(PDO::FETCH_ASSOC);
  if (!$fee) jerr(404,'Fee not found.');

  // ===== NEW VALIDATION: Check if academic year values are properly set =====
  $fee_sy = (int)$fee['start_year'];
  $fee_ey = (int)$fee['end_year'];
  $fee_ay = (int)$fee['active_year'];
  
  // Validate that academic year values are properly set (not 0 or null)
  if ($fee_sy <= 0 || $fee_ey <= 0 || $fee_ay <= 0) {
    jerr(400,'Cannot add payment: Organization fee has not been properly configured with academic year values.');
  }
  
  // Validate that active_year is either start_year or end_year
  if ($fee_ay !== $fee_sy && $fee_ay !== $fee_ey) {
    jerr(400,'Cannot add payment: active_year must be equal to either start_year or end_year in the organization fee setup.');
  }
  
  // Validate that start_year is less than end_year
  if ($fee_sy >= $fee_ey) {
    jerr(400,'Cannot add payment: start_year must be less than end_year in the organization fee setup.');
  }
  
  // Validate that the academic year span is reasonable (e.g., not more than 10 years apart)
  if (($fee_ey - $fee_sy) > 10) {
    jerr(400,'Cannot add payment: Academic year span is invalid (exceeds maximum allowed duration).');
  }
  
  // ===== END OF NEW VALIDATION =====
  
  $org_id = (int)$fee['org_id']; // NEW: carry org_id to payments

  // If client didn't provide a span, use the fee's span
  $sy = $syIn > 0 ? $syIn : $fee_sy;
  $ey = $eyIn > 0 ? $eyIn : $fee_ey;

  // If client didn't provide AY, use fee AY
  $active_year = $ayIn > 0 ? $ayIn : $fee_ay;

  // Validate AY is in (sy,ey) and matches fee's span if client overrode
  if (!in_array($active_year, [$sy,$ey], true)) {
    jerr(400,'active_year must equal start_year or end_year.');
  }
  // Prevent mismatching the fee's actual span
  if ($sy !== $fee_sy || $ey !== $fee_ey) {
    jerr(400,'Provided start_year/end_year must match the fee\'s span.', [
      'fee_start_year'=>$fee_sy, 'fee_end_year'=>$fee_ey
    ]);
  }

  // Validate payer
  $u = $pdo->prepare("SELECT id_number, first_name, middle_name, last_name, suffix, department, status FROM users WHERE id_number=? LIMIT 1");
  $u->execute([$payer_id]);
  $user = $u->fetch(PDO::FETCH_ASSOC);
  if (!$user) jerr(404,'Payer not found.');
  
  // Get payer's full name for notification
  $payer_name = $user['first_name'];
  if (!empty($user['middle_name'])) $payer_name .= ' ' . $user['middle_name'];
  if (!empty($user['last_name'])) $payer_name .= ' ' . $user['last_name'];
  if (!empty($user['suffix'])) $payer_name .= ' ' . $user['suffix'];
  
  if (strtolower($fee['fee_category']) === 'department') {
    if (strtoupper((string)$user['department']) !== strtoupper((string)$fee['course_abbr'])) {
      jerr(409,'Payer must belong to the organization\'s department.');
    }
  }

  // Duplicate guard: one confirmed payment per payer/fee/AY/span
  if ($status === 'confirmed') {
    $dup = $pdo->prepare("
      SELECT id FROM organization_fee_payments
       WHERE org_fee_id = :fid
         AND payer_id_number = :pid
         AND active_year = :ay
         AND start_year = :sy
         AND end_year = :ey
         AND status = 'confirmed'
       LIMIT 1
    ");
    $dup->execute([':fid'=>$fee_id, ':pid'=>$payer_id, ':ay'=>$active_year, ':sy'=>$sy, ':ey'=>$ey]);
    if ($dup->fetchColumn()) jerr(409,'This payer already has a confirmed payment for this semester.');
  }

  // ===== SEND NOTIFICATION FUNCTION =====
  function sendPaymentNotification($pdo, $recipientId, $actorId, $title, $message, $notifType, $payloadId = null) {
    try {
      $notifStmt = $pdo->prepare("
        INSERT INTO notifications 
        (recipient_id_number, actor_id_number, title, message, notif_type, status, payload_id, created_at) 
        VALUES (:recipient, :actor, :title, :message, :notif_type, 'unread', :payload_id, NOW())
      ");
      
      $notifStmt->execute([
        ':recipient' => $recipientId,
        ':actor' => $actorId,
        ':title' => $title,
        ':message' => $message,
        ':notif_type' => $notifType,
        ':payload_id' => $payloadId
      ]);
      return true;
    } catch (PDOException $e) {
      error_log("Failed to send payment notification: " . $e->getMessage());
      return false;
    }
  }

  // Insert payment
  $paid_ts = $paid_on !== '' ? $paid_on : date('Y-m-d H:i:s');
  $ins = $pdo->prepare("
    INSERT INTO organization_fee_payments
      (org_fee_id, org_id, payer_id_number, receipt_no, paid_amount,
       active_year, start_year, end_year,
       paid_on, payment_method, notes, status,
       recorded_by, created_at, updated_at)
    VALUES
      (:fid, :org, :pid, :rno, :amt,
       :ay, :sy, :ey,
       :pon, :pm, :notes, :st,
       :rec, NOW(), NOW())
  ");
  $ins->execute([
    ':fid'=>$fee_id,
    ':org'=>$org_id,              // NEW
    ':pid'=>$payer_id,
    ':rno'=>$notes,               // Use notes as receipt number
    ':amt'=>$amount,
    ':ay'=>$active_year, ':sy'=>$sy, ':ey'=>$ey,
    ':pon'=>$paid_ts,
    ':pm'=>$method,
    ':notes'=>null,               // Set notes to NULL since we're using it for receipt
    ':st'=>$status,
    ':rec'=>$actor
  ]);

  $paymentId = (int)$pdo->lastInsertId();
  
  // ===== SEND NOTIFICATIONS =====
  
  // 1. Notification to the payer (student)
  $payerNotificationTitle = 'Payment Recorded';
  $payerNotificationMessage = "Your payment of ₱{$amount} for {$fee['fee_title']} has been recorded. Receipt #: {$notes}";
  sendPaymentNotification($pdo, $payer_id, $actor, $payerNotificationTitle, $payerNotificationMessage, 'payment', $paymentId);
  
  // 2. Notification to the organization admin (if exists)
  $orgAdminId = $fee['admin_id_number'];
  if ($orgAdminId) {
    $semester = ($active_year == $sy) ? '1st Semester' : '2nd Semester';
    $orgNotificationTitle = 'New Payment Received';
    $orgNotificationMessage = "{$payer_name} has paid ₱{$amount} for {$fee['fee_title']} ({$semester}). Receipt #: {$notes}";
    sendPaymentNotification($pdo, $orgAdminId, $actor, $orgNotificationTitle, $orgNotificationMessage, 'payment', $paymentId);
  }
  
  // 3. Notification to the treasurer (if different from actor and org admin)
  $treasurerStmt = $pdo->prepare("SELECT treasurer_id_number FROM organization_fees WHERE id = ? LIMIT 1");
  $treasurerStmt->execute([$fee_id]);
  $treasurerRow = $treasurerStmt->fetch(PDO::FETCH_ASSOC);
  $treasurerId = $treasurerRow['treasurer_id_number'] ?? null;
  
  if ($treasurerId && $treasurerId !== $actor && $treasurerId !== $orgAdminId) {
    $treasurerNotificationTitle = 'Payment Recorded';
    $treasurerNotificationMessage = "Payment of ₱{$amount} from {$payer_name} for {$fee['fee_title']} has been recorded. Receipt #: {$notes}";
    sendPaymentNotification($pdo, $treasurerId, $actor, $treasurerNotificationTitle, $treasurerNotificationMessage, 'payment', $paymentId);
  }

  $row = $pdo->prepare("
    SELECT p.*, u.first_name, u.middle_name, u.last_name, u.suffix
      FROM organization_fee_payments p
      LEFT JOIN users u ON u.id_number = p.payer_id_number
     WHERE p.id=? LIMIT 1
  ");
  $row->execute([$paymentId]);

  echo json_encode([
    'success'=>true, 
    'payment'=>$row->fetch(PDO::FETCH_ASSOC),
    'message' => 'Payment recorded successfully. Notifications have been sent.'
  ]);
}catch(Throwable $e){
  jerr(500,'Server error',['detail'=>$e->getMessage()]);
}