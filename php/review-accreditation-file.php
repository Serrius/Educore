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
           o.start_year AS org_start_year, o.end_year AS org_end_year,
           o.admin_id_number, o.name AS org_name, o.abbreviation AS org_abbr,
           o.authors_id_number
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
  $orgAdminId = $row['admin_id_number'];
  $orgName    = $row['org_name'];
  $orgAbbr    = $row['org_abbr'];
  $docType    = $row['doc_type'];
  $orgAuthorId = $row['authors_id_number'];

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
  $requirementsMet  = false; // NEW: Flag to indicate if all docs are approved

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

  // ====== SEND NOTIFICATIONS ======
  function sendNotification($pdo, $recipientId, $actorId, $title, $message, $notifType, $payloadId = null) {
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
      error_log("Failed to send notification: " . $e->getMessage());
      return false;
    }
  }

  // Send notification based on action
  if ($action === 'review') {
    // Special-admin reviewed/returned a file - notify the organization's admin
    if ($orgAdminId) {
      $notificationTitle = 'Document Returned for Revision';
      $notificationMessage = "Document '{$docType}' for organization {$orgName} ({$orgAbbr}) has been returned for revision. Please review and resubmit.";
      sendNotification($pdo, $orgAdminId, $reviewer, $notificationTitle, $notificationMessage, 'accreditation', $orgId);
    }
  } elseif ($action === 'approve') {
    // Super-admin approved a file - notify the organization's admin
    if ($orgAdminId) {
      $notificationTitle = 'Document Approved';
      $notificationMessage = "Document '{$docType}' for organization {$orgName} ({$orgAbbr}) has been approved.";
      sendNotification($pdo, $orgAdminId, $reviewer, $notificationTitle, $notificationMessage, 'accreditation', $orgId);
    }
  } elseif ($action === 'decline') {
    // Super-admin declined a file - notify the organization's admin
    if ($orgAdminId) {
      $notificationTitle = 'Document Declined';
      $notificationMessage = "Document '{$docType}' for organization {$orgName} ({$orgAbbr}) has been declined. Reason: " . htmlspecialchars($reason);
      sendNotification($pdo, $orgAdminId, $reviewer, $notificationTitle, $notificationMessage, 'accreditation', $orgId);
    }
  }

  // ====== HANDLE DIFFERENT ACTIONS ======
  
  if ($action === 'review') {
    // ====== REVIEW PATH ======
    // Just mark as reviewed, DON'T change org status
    // Organizations should only be marked as accredited/reaccredited when ALL docs are APPROVED
    
    // Check if there are any pending or submitted files
    $checkQuery = $pdo->prepare("
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status IN ('approved') THEN 1 ELSE 0 END) as approved_count,
             SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) as declined_count,
             SUM(CASE WHEN status IN ('submitted', 'pending', 'reviewed') THEN 1 ELSE 0 END) as pending_count
        FROM accreditation_files 
       WHERE org_id = :org 
         AND $periodWhere
         AND doc_group = :grp
    ");
    
    // Bind parameters for periodWhere
    if ($fileSY !== null && $fileEY !== null) {
      $checkQuery->bindParam(':sy', $fileSY, PDO::PARAM_INT);
      $checkQuery->bindParam(':ey', $fileEY, PDO::PARAM_INT);
      $checkQuery->bindParam(':ay', $fileAY, PDO::PARAM_INT);
    } else {
      $checkQuery->bindParam(':ay', $fileAY, PDO::PARAM_INT);
    }
    $checkQuery->bindParam(':org', $orgId, PDO::PARAM_INT);
    $checkQuery->bindParam(':grp', $docGroup, PDO::PARAM_STR);
    $checkQuery->execute();
    $checkResult = $checkQuery->fetch(PDO::FETCH_ASSOC);
    
  } elseif ($action === 'decline') {
    // ====== DECLINE PATH ======
    // Any decline sends org back to Pending
    $pdo->prepare("UPDATE organizations SET status = 'Pending' WHERE id = :id")
        ->execute([':id'=>$orgId]);
    $orgStatusUpdated = true;
    $orgNewStatus = 'Pending';

    // Send notification about organization status change
    if ($orgAdminId) {
      $notificationTitle = 'Organization Status Updated';
      $notificationMessage = "Organization {$orgName} ({$orgAbbr}) status has been changed to Pending due to declined document.";
      sendNotification($pdo, $orgAdminId, $reviewer, $notificationTitle, $notificationMessage, 'accreditation', $orgId);
    }

  } else {
    // ====== APPROVE PATH – check if ALL required docs for this group/period are approved ======

    // Build map: doc_type => approved count (lowercased) - ONLY COUNT APPROVED, NOT REVIEWED
    $q = $pdo->prepare("
      SELECT LOWER(doc_type) AS doc_type, COUNT(*) AS c
        FROM accreditation_files
       WHERE org_id = :org
         AND LOWER(doc_group) = :grp
         AND $periodWhere
         AND status = 'approved'  -- ONLY count APPROVED, not reviewed
       GROUP BY LOWER(doc_type)
    ");
    $q->execute($periodArgs);
    $approvedMap = [];
    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r) {
      $approvedMap[$r['doc_type']] = (int)$r['c'];
    }

    $has = function($types, $approvedMap){
      foreach ((array)$types as $t) {
        $key = strtolower($t);
        if (!empty($approvedMap[$key])) return true;
      }
      return false;
    };

    // === REQUIRED SETS (match JS + current DB) ===

    // NEW accreditation (doc_group = 'new')
    $NEW_REQUIRED_TYPES = [
      'concept_paper',
      'vmgo',
      'logo_explanation',
      'org_chart',
      'officers_list',
      'members_list',
      'adviser_moderator_acceptance',
      'proposed_program',
      'awfp',
      'cbl',
      'bank_passbook',
      'accomplishment_report',
      'financial_statement',
      'trainings_report',
      'presidents_report',
      'advisers_report',
      'evaluation',
      'contact_details',
    ];
    $NEW_REQUIRED_PDS = 'pds_officers'; // at least 1

    // REACCREDITATION (doc_group = 'reaccreditation')
    $REACCR_REQUIRED_TYPES = [
      'officers_list',
      'members_list',
      'adviser_moderator_acceptance',
      'awfp',
      'cbl',
      'bank_passbook',
      'accomplishment_report',
      'financial_statement',
      'trainings_report',
      'presidents_report',
      'advisers_report',
      'evaluation',
      'contact_details',
      'general_program'  // Added based on your database
    ];
    $REACCR_REQUIRED_PDS = 'pds_officers'; // at least 1

    if ($docGroup === 'new') {
      // Check if ALL required NEW docs are approved (not just reviewed)
      $allSinglesOk = true;
      foreach ($NEW_REQUIRED_TYPES as $t) {
        if (!$has($t, $approvedMap)) {
          $allSinglesOk = false;
          break;
        }
      }
      $hasPds = $has($NEW_REQUIRED_PDS, $approvedMap);

      if ($allSinglesOk && $hasPds) {
        // Check that there are no pending/submitted/reviewed documents
        $checkPending = $pdo->prepare("
          SELECT COUNT(*) as pending_count
            FROM accreditation_files
           WHERE org_id = :org
             AND LOWER(doc_group) = :grp
             AND $periodWhere
             AND status NOT IN ('approved', 'declined')
        ");
        
        // Bind parameters
        if ($fileSY !== null && $fileEY !== null) {
          $checkPending->bindParam(':sy', $fileSY, PDO::PARAM_INT);
          $checkPending->bindParam(':ey', $fileEY, PDO::PARAM_INT);
          $checkPending->bindParam(':ay', $fileAY, PDO::PARAM_INT);
        } else {
          $checkPending->bindParam(':ay', $fileAY, PDO::PARAM_INT);
        }
        $checkPending->bindParam(':org', $orgId, PDO::PARAM_INT);
        $checkPending->bindParam(':grp', $docGroup, PDO::PARAM_STR);
        $checkPending->execute();
        $pendingResult = $checkPending->fetch(PDO::FETCH_ASSOC);
        
        // Check if all requirements are met
        $requirementsMet = ($pendingResult['pending_count'] == 0);
        
        if ($requirementsMet) {
          // Update organization status to 'Accredited'
          $pdo->prepare("UPDATE organizations SET status = 'Accredited' WHERE id = :id")
              ->execute([':id'=>$orgId]);
          $orgStatusUpdated = true;
          $orgNewStatus = 'Accredited';
          
          // Send notification to org admin and author
          $notificationTitle = 'Organization Accredited';
          $notificationMessage = "Congratulations! Organization {$orgName} ({$orgAbbr}) has been successfully accredited for the academic year {$fileSY}-{$fileEY}.";
          
          if ($orgAdminId) {
            sendNotification($pdo, $orgAdminId, $reviewer, $notificationTitle, $notificationMessage, 'accreditation', $orgId);
          }
          if ($orgAuthorId) {
            sendNotification($pdo, $orgAuthorId, $reviewer, $notificationTitle, $notificationMessage, 'accreditation', $orgId);
          }
          
          // Also notify super-admin (0000)
          sendNotification($pdo, '0000', $reviewer, 'Organization Accredited', 
            "Organization {$orgName} ({$orgAbbr}) has been accredited for {$fileSY}-{$fileEY}.", 'accreditation', $orgId);
        } else {
          // If requirements are met but not all docs approved, send notification
          if ($orgAdminId) {
            $notificationTitle = 'All Requirements Met';
            $notificationMessage = "All required documents for {$orgName} ({$orgAbbr}) have been approved. The organization is ready for accreditation.";
            sendNotification($pdo, $orgAdminId, $reviewer, $notificationTitle, $notificationMessage, 'accreditation', $orgId);
          }
        }
      }

    } elseif ($docGroup === 'reaccreditation') {
      // Check if ALL required REACCR docs are approved (not just reviewed)
      $allSinglesOk = true;
      foreach ($REACCR_REQUIRED_TYPES as $t) {
        if (!$has($t, $approvedMap)) {
          $allSinglesOk = false;
          break;
        }
      }
      $hasPds = $has($REACCR_REQUIRED_PDS, $approvedMap);

      if ($allSinglesOk && $hasPds) {
        // Check that there are no pending/submitted/reviewed documents
        $checkPending = $pdo->prepare("
          SELECT COUNT(*) as pending_count
            FROM accreditation_files
           WHERE org_id = :org
             AND LOWER(doc_group) = :grp
             AND $periodWhere
             AND status NOT IN ('approved', 'declined')
        ");
        
        // Bind parameters
        if ($fileSY !== null && $fileEY !== null) {
          $checkPending->bindParam(':sy', $fileSY, PDO::PARAM_INT);
          $checkPending->bindParam(':ey', $fileEY, PDO::PARAM_INT);
          $checkPending->bindParam(':ay', $fileAY, PDO::PARAM_INT);
        } else {
          $checkPending->bindParam(':ay', $fileAY, PDO::PARAM_INT);
        }
        $checkPending->bindParam(':org', $orgId, PDO::PARAM_INT);
        $checkPending->bindParam(':grp', $docGroup, PDO::PARAM_STR);
        $checkPending->execute();
        $pendingResult = $checkPending->fetch(PDO::FETCH_ASSOC);
        
        // Check if all requirements are met
        $requirementsMet = ($pendingResult['pending_count'] == 0);
        
        if ($requirementsMet) {
          // Update organization status to 'Reaccredited'
          $pdo->prepare("UPDATE organizations SET status = 'Reaccredited' WHERE id = :id")
              ->execute([':id'=>$orgId]);
          $orgStatusUpdated = true;
          $orgNewStatus = 'Reaccredited';
          
          // Send notification to org admin and author
          $notificationTitle = 'Organization Reaccredited';
          $notificationMessage = "Congratulations! Organization {$orgName} ({$orgAbbr}) has been successfully reaccredited for the academic year {$fileSY}-{$fileEY}.";
          
          if ($orgAdminId) {
            sendNotification($pdo, $orgAdminId, $reviewer, $notificationTitle, $notificationMessage, 'accreditation', $orgId);
          }
          if ($orgAuthorId) {
            sendNotification($pdo, $orgAuthorId, $reviewer, $notificationTitle, $notificationMessage, 'accreditation', $orgId);
          }
          
          // Also notify super-admin (0000)
          sendNotification($pdo, '0000', $reviewer, 'Organization Reaccredited', 
            "Organization {$orgName} ({$orgAbbr}) has been reaccredited for {$fileSY}-{$fileEY}.", 'accreditation', $orgId);
        } else {
          // If requirements are met but not all docs approved, send notification
          if ($orgAdminId) {
            $notificationTitle = 'All Requirements Met';
            $notificationMessage = "All required documents for {$orgName} ({$orgAbbr}) have been approved. The organization is ready for reaccreditation.";
            sendNotification($pdo, $orgAdminId, $reviewer, $notificationTitle, $notificationMessage, 'accreditation', $orgId);
          }
        }
      }
    }
  }

  $pdo->commit();

  echo json_encode([
    'success'            => true,
    'file_id'            => $fileId,
    'file_status'        => $newStatus,
    'org_status_updated' => $orgStatusUpdated,
    'org_new_status'     => $orgNewStatus,
    'requirements_met'   => $requirementsMet, // NEW: Flag indicating if all docs are approved
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