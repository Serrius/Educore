<?php
// php/update-announcement-status.php
header('Content-Type: application/json; charset=utf-8');
session_start();

try {
    require __DIR__ . '/database.php';
    
    // Authentication check
    if (empty($_SESSION['id_number'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);
        exit;
    }

    // Validate input
    $id = isset($_POST['id']) ? (int)$_POST['id'] : 0;
    $status = isset($_POST['status']) ? trim($_POST['status']) : '';
    $reason = isset($_POST['reason']) ? trim($_POST['reason']) : null;

    // Validate status - based on your JS code, these are the valid statuses
    $validStatuses = ['Active', 'Rejected', 'Archived', 'Pending'];
    if ($id <= 0 || !in_array($status, $validStatuses, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid input']);
        exit;
    }

    // Require reason for Rejected status
    if ($status === 'Rejected' && (empty($reason) || trim($reason) === '')) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Decline reason required']);
        exit;
    }

    // Get announcement details with audience information
    $stmt = $pdo->prepare("
        SELECT a.title, a.author_id, a.status, a.audience_scope, a.course_abbr 
        FROM announcements a 
        WHERE a.id = :id
    ");
    $stmt->execute([':id' => $id]);
    $announcement = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$announcement) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Announcement not found']);
        exit;
    }

    $oldStatus = $announcement['status'];
    $announcementTitle = $announcement['title'];
    $authorId = $announcement['author_id'];
    $audienceScope = $announcement['audience_scope'];
    $courseAbbr = $announcement['course_abbr'];
    $currentAdminId = $_SESSION['id_number'];

    // Update announcement status
    $upd = $pdo->prepare("UPDATE announcements 
                          SET status = :status, 
                              declined_reason = :reason, 
                              updated_at = NOW() 
                          WHERE id = :id");
    
    $upd->execute([
        ':status' => $status,
        ':reason' => $status === 'Rejected' ? $reason : null,
        ':id' => $id
    ]);

    // ===== SEND NOTIFICATION FUNCTION =====
    function sendAnnouncementNotification($pdo, $recipientId, $actorId, $title, $message, $notifType, $payloadId = null) {
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
            error_log("Failed to send announcement notification: " . $e->getMessage());
            return false;
        }
    }

    // ===== NOTIFY DEPARTMENT OR ALL USERS =====
    function notifyDepartmentOrAllUsers($pdo, $actorId, $announcementId, $announcementTitle, $audienceScope, $courseAbbr) {
        try {
            // Build query based on audience scope
            if ($audienceScope === 'course' && !empty($courseAbbr)) {
                // Notify specific department/course
                $usersStmt = $pdo->prepare("
                    SELECT id_number, first_name, last_name 
                    FROM users 
                    WHERE department = :department 
                    AND user_type = 'student' 
                    AND status = 'Active'
                ");
                $usersStmt->execute([':department' => $courseAbbr]);
                $notificationTitle = 'New Announcement for Your Department';
                $notificationMessage = "A new announcement '{$announcementTitle}' has been posted for {$courseAbbr} department.";
            } else {
                // Notify all users (general announcement)
                $usersStmt = $pdo->prepare("
                    SELECT id_number, first_name, last_name 
                    FROM users 
                    WHERE status = 'Active'
                ");
                $usersStmt->execute();
                $notificationTitle = 'New General Announcement';
                $notificationMessage = "A new general announcement '{$announcementTitle}' has been posted.";
            }
            
            $users = $usersStmt->fetchAll(PDO::FETCH_ASSOC);
            $notifiedCount = 0;
            
            foreach ($users as $user) {
                // Skip sending to the actor (admin who approved)
                if ($user['id_number'] === $actorId) {
                    continue;
                }
                
                sendAnnouncementNotification(
                    $pdo, 
                    $user['id_number'], 
                    $actorId, 
                    $notificationTitle, 
                    $notificationMessage, 
                    'announcement', 
                    $announcementId
                );
                $notifiedCount++;
            }
            
            return $notifiedCount;
        } catch (Exception $e) {
            error_log("Error notifying department/users: " . $e->getMessage());
            return 0;
        }
    }

    // Send notification when status changes from Pending to Active/Rejected
    if ($oldStatus === 'Pending' && in_array($status, ['Active', 'Rejected'], true)) {
        
        // Prepare notification message for author
        $authorNotificationTitle = 'Announcement Status Updated';
        if ($status === 'Active') {
            $authorNotificationMessage = "Your announcement '{$announcementTitle}' has been approved and is now active.";
        } else { // Rejected
            $authorNotificationMessage = "Your announcement '{$announcementTitle}' has been declined. Reason: " . 
                                   htmlspecialchars($reason ?? 'No reason provided');
        }

        // Insert notification for the announcement author
        try {
            $notifStmt = $pdo->prepare("
                INSERT INTO notifications 
                (recipient_id_number, actor_id_number, title, message, notif_type, status, payload_id, created_at) 
                VALUES (:recipient, :actor, :title, :message, 'announcement', 'unread', :payload_id, NOW())
            ");
            
            $notifStmt->execute([
                ':recipient' => $authorId,
                ':actor' => $currentAdminId,
                ':title' => $authorNotificationTitle,
                ':message' => $authorNotificationMessage,
                ':payload_id' => $id
            ]);
            
        } catch (PDOException $e) {
            // Log error but don't fail the whole operation
            error_log("Failed to send author notification: " . $e->getMessage());
        }

        // ===== ADDITIONAL: If announcement is approved (Active), notify the department or all users =====
        if ($status === 'Active') {
            $notifiedCount = notifyDepartmentOrAllUsers($pdo, $currentAdminId, $id, $announcementTitle, $audienceScope, $courseAbbr);
            
            // Log the notification count
            error_log("Approved announcement #{$id}: Notified {$notifiedCount} users (audience: {$audienceScope}, course: {$courseAbbr})");
        }
    }

    // Also send notification when archiving (optional)
    if ($status === 'Archived' && $oldStatus !== 'Archived') {
        $notificationTitle = 'Announcement Archived';
        $notificationMessage = "Your announcement '{$announcementTitle}' has been archived.";
        
        try {
            $notifStmt = $pdo->prepare("
                INSERT INTO notifications 
                (recipient_id_number, actor_id_number, title, message, notif_type, status, payload_id, created_at) 
                VALUES (:recipient, :actor, :title, :message, 'announcement', 'unread', :payload_id, NOW())
            ");
            
            $notifStmt->execute([
                ':recipient' => $authorId,
                ':actor' => $currentAdminId,
                ':title' => $notificationTitle,
                ':message' => $notificationMessage,
                ':payload_id' => $id
            ]);
        } catch (PDOException $e) {
            error_log("Failed to send archive notification: " . $e->getMessage());
        }
    }

    echo json_encode([
        'success' => true,
        'message' => 'Status updated successfully',
        'data' => [
            'id' => $id,
            'newStatus' => $status,
            'oldStatus' => $oldStatus,
            'audienceScope' => $audienceScope,
            'courseAbbr' => $courseAbbr,
            'notificationsSent' => ($status === 'Active' && $oldStatus === 'Pending') ? true : false
        ]
    ]);
    exit;
    
} catch (Throwable $e) {
    error_log("Error in update-announcement-status: " . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Server error occurred'
    ]);
}