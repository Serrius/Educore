<?php
// php/mark-notification-read.php
header('Content-Type: application/json');
session_start();

try {
    require __DIR__ . '/database.php';
    
    if (empty($_SESSION['id_number'])) {
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);
        exit;
    }
    
    $studentId = $_SESSION['id_number'];
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || !isset($input['notification_id'])) {
        echo json_encode(['success' => false, 'message' => 'Invalid data']);
        exit;
    }
    
    $notificationId = intval($input['notification_id']);
    
    // Update notification status
    $query = $pdo->prepare("
        UPDATE notifications 
        SET status = 'read'
        WHERE id = :notification_id
        AND recipient_id_number = :student_id
    ");
    
    $query->execute([
        ':notification_id' => $notificationId,
        ':student_id' => $studentId
    ]);
    
    echo json_encode([
        'success' => true,
        'message' => 'Notification marked as read'
    ]);
    
} catch (Exception $e) {
    error_log("mark-notification-read.php error: " . $e->getMessage());
    echo json_encode([
        'success' => false, 
        'message' => 'Failed to update notification'
    ]);
}
?>