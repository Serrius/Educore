<?php
// php/review-accreditation-file.php
header('Content-Type: application/json');
ini_set('display_errors','1'); 
error_reporting(E_ALL);
session_start();

function jerr($http,$msg,$extra=[]) {
  http_response_code($http);
  echo json_encode(['success'=>false,'message'=>$msg] + $extra);
  exit;
}

try {
  require __DIR__ . '/database.php';

  // ---- Auth (trust session cookie) ----
  $reviewer = $_SESSION['id_number'] ?? null;
  if (!$reviewer) jerr(401, 'Not authenticated');

  // ---- Parse input (JSON or form) ----
  $raw = file_get_contents('php://input');
  $payload = json_decode($raw, true);
  if (!is_array($payload) || !$payload) $payload = $_POST;

  $fileId = (int)($payload['file_id'] ?? 0);
  $action = strtolower(trim($payload['action'] ?? ''));
  $reason = trim($payload['reason'] ?? '');

  if ($fileId <= 0) jerr(400, 'Missing or invalid file_id.');
  // UPDATED: Added 'review' action
  if (!in_array($action, ['review', 'approve', 'decline'], true)) {
    jerr(400, 'Invalid action. Use review|approve|decline.');
  }
  if ($action === 'decline' && $reason === '') jerr(400, 'Reason is required when declining a document.');

  // ---- Active AY (span + legacy single) ----
  $ay = $pdo->query("
    SELECT start_year, end_year, active_year
      FROM academic_years
     WHERE status='Active'
     ORDER BY id DESC
     LIMIT 1
  ")->fetch(PDO::FETCH_ASSOC);
  if (!$ay) jerr(400,'No active academic year found.');

  $active_start  = (int)$ay['start_year'];
  $active_end    = (int)$ay['end_year'];
  $active_single = isset($ay['active_year']) ? (int)$ay['active_year'] : $active_start; // legacy support

  // ---- Get the file + org (include span fields if present) ----
  $stmt = $pdo->prepare("
    SELECT af.id, af.org_id, af.doc_group, af.doc_type, af.active_year,
           af.start_year, af.end_year, af.status,
           o.status AS org_status, o.active_year AS org_year,
           o.start_year AS org_start_year, o.end_year AS org_end_year
      FROM accreditation_files af
      JOIN organizations o ON o.id = af.org_id
     WHERE af.id = :id
     LIMIT 1
  ");
  $stmt->execute([':id' => $fileId]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  if (!$row) jerr(404, 'File not found.');

  $orgId      = (int)$row['org_id'];
  $docGroup   = strtolower((string)$row['doc_group']);   // 'new' or 'reaccreditation'
  $fileAY     = (int)$row['active_year'];
  $fileSY     = isset($row['start_year']) ? (int)$row['start_year'] : null;
  $fileEY     = isset($row['end_year'])   ? (int)$row['end_year']   : null;

  // UPDATED: Handle 'review' action
  if ($action === 'review') {
    $newStatus = 'reviewed';
    $newReason = null;
  } elseif ($action === 'approve') {
    $newStatus = 'approved';
    $newReason = null;
  } else { // decline
    $newStatus = 'declined';
    $newReason = $reason;
  }

  $pdo->beginTransaction();

  // (1) Update the individual file status
  $u = $pdo->prepare("UPDATE accreditation_files SET status = :s, reason = :r WHERE id = :id");
  $u->execute([':s'=>$newStatus, ':r'=>$newReason, ':id'=>$fileId]);

  $orgStatusUpdated = false;
  $orgNewStatus     = null;

  // Helper: same period as this file (supports span + legacy active_year)
  $periodWhere = '';
  $periodArgs  = [':org'=>$orgId, ':grp'=>$docGroup];
  if ($fileSY !== null && $fileEY !== null) {
    $periodWhere = " ( (start_year = :sy AND end_year = :ey) OR (start_year IS NULL AND end_year IS NULL AND active_year = :ay) ) ";
    $periodArgs[':sy'] = $fileSY;
    $periodArgs[':ey'] = $fileEY;
    $periodArgs[':ay'] = $fileAY;
  } else {
    $periodWhere = " ( active_year = :ay ) ";
    $periodArgs[':ay'] = $fileAY;
  }

  // ====== HANDLE DIFFERENT ACTIONS ======
  
  if ($action === 'review') {
    // ====== REVIEW PATH ======
    // Just mark as reviewed, DON'T change org status
    // Organizations should only be marked as accredited/reaccredited when admin explicitly clicks the button
    // NO automatic status update
    
  } elseif ($action === 'decline') {
    // ====== DECLINE PATH ======
    // Even when declining, don't auto-update org status
    // Let the admin handle organization status manually
    // This is more flexible for the workflow
    
  } else {
    // ====== APPROVE PATH ======
    // Just approve the document, DON'T check for all docs
    // Organizations should only be marked as accredited/reaccredited when admin explicitly clicks the button
    
    // REMOVED ALL automatic organization status checking logic
    // The organization status should only be updated via finalize-accreditation-status.php
    
  }

  $pdo->commit();

  echo json_encode([
    'success'            => true,
    'file_id'            => $fileId,
    'file_status'        => $newStatus,
    'org_status_updated' => false, // Always false now - no auto updates
    'org_new_status'     => null,  // Always null - no auto updates
    'active_year'        => $active_single,
    'active_year_start'  => $active_start,
    'active_year_end'    => $active_end,
    'org_start_year'     => isset($row['org_start_year']) ? (int)$row['org_start_year'] : null,
    'org_end_year'       => isset($row['org_end_year'])   ? (int)$row['org_end_year']   : null,
    'org_active_year'    => isset($row['org_year'])       ? (int)$row['org_year']       : null,
    'message'            => $action === 'review' ? 'Document marked as reviewed' : 
                           ($action === 'approve' ? 'Document approved' : 'Document returned')
  ]);
}
catch (Throwable $e) {
  if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
  jerr(500, 'Server error', ['detail' => $e->getMessage()]);
}