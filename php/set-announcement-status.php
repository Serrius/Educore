<?php
// php/set-announcement-status.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors', 1);
error_reporting(E_ALL);
session_start();

try {
    require __DIR__ . '/database.php';
    if (!isset($pdo)) {
        throw new Exception('DB not available');
    }

    // Authentication check
    if (empty($_SESSION['id_number'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);
        exit;
    }

    $role = strtolower((string)($_SESSION['role'] ?? ''));

    // Only admin roles can change status
    if (!in_array($role, ['admin', 'super-admin', 'special-admin'], true)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);
        exit;
    }

    // Validate input
    $id = isset($_POST['id']) ? (int)$_POST['id'] : 0;
    $status = isset($_POST['status']) ? trim($_POST['status']) : '';
    $reason = isset($_POST['reason']) ? trim($_POST['reason']) : null;

    // Validate status
    $validStatuses = ['Active', 'Rejected', 'Archived']; // Added Archived based on your table structure
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

    // Get announcement details
    $stmt = $pdo->prepare("SELECT title, author_id, status FROM announcements WHERE id = :id");
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

    // Send notification when status changes from Pending to Active/Rejected
    if ($oldStatus === 'Pending' && in_array($status, ['Active', 'Rejected'], true)) {
        
        // Prepare notification message
        $notificationTitle = 'Announcement Status Updated';
        if ($status === 'Active') {
            $notificationMessage = "Your announcement '{$announcementTitle}' has been approved and is now active.";
        } else { // Rejected
            $notificationMessage = "Your announcement '{$announcementTitle}' has been declined. Reason: " . 
                                   (htmlspecialchars($reason) ?? 'No reason provided');
        }

        // Insert notification
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
            
            // Optional: Log successful notification
            error_log("Notification sent to {$authorId} for announcement #{$id} (Status: {$status})");
            
        } catch (PDOException $e) {
            // Log error but don't fail the whole operation
            error_log("Failed to send notification: " . $e->getMessage());
            // Continue with the status update even if notification fails
        }
    }

    // Also send notification when archiving (if needed)
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
            'oldStatus' => $oldStatus
        ]
    ]);
    exit;
    
} catch (Throwable $e) {
    error_log("Error in set-announcement-status: " . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Server error occurred',
        'debug' => $e->getMessage() // Remove in production
    ]);
}