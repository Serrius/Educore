<?php
// php/mark-all-notifications-read.php
header('Content-Type: application/json');
session_start();

try {
    require __DIR__ . '/database.php';
    
    if (empty($_SESSION['id_number'])) {
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);
        exit;
    }
    
    $studentId = $_SESSION['id_number'];
    
    // Mark all notifications as read
    $query = $pdo->prepare("
        UPDATE notifications 
        SET status = 'read'
        WHERE recipient_id_number = :student_id
        AND status = 'unread'
    ");
    
    $query->execute([':student_id' => $studentId]);
    
    echo json_encode([
        'success' => true,
        'message' => 'All notifications marked as read'
    ]);
    
} catch (Exception $e) {
    error_log("mark-all-notifications-read.php error: " . $e->getMessage());
    echo json_encode([
        'success' => false, 
        'message' => 'Failed to update notifications'
    ]);
}
?>