<?php
// php/create-payment-due-notif.php
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
    
    if (!$input || !isset($input['unpaid_count']) || !isset($input['total_amount'])) {
        echo json_encode(['success' => false, 'message' => 'Invalid data']);
        exit;
    }
    
    $unpaidCount = intval($input['unpaid_count']);
    $totalAmount = floatval($input['total_amount']);
    $fees = $input['fees'] ?? [];
    
    // Create notification title and body
    $title = "Payment Due Reminder";
    $body = "You have {$unpaidCount} unpaid organization fee(s) totaling ₱" . number_format($totalAmount, 2) . ". Please settle your payments.";
    
    // Use first fee ID as payload_id if available
    $payloadId = count($fees) > 0 ? $fees[0]['id'] : 0;
    
    // FIX: Use NULL for actor_id_number instead of 'system'
    $query = $pdo->prepare("
        INSERT INTO notifications 
        (recipient_id_number, actor_id_number, title, message, notif_type, status, payload_id, created_at) 
        VALUES (:recipient, NULL, :title, :message, 'payment', 'unread', :payload_id, NOW())
    ");
    
    $query->execute([
        ':recipient' => $studentId,
        ':title' => $title,
        ':message' => $body,
        ':payload_id' => $payloadId
    ]);
    
    $notificationId = $pdo->lastInsertId();
    
    echo json_encode([
        'success' => true,
        'notification_id' => $notificationId,
        'message' => 'Payment due notification created'
    ]);
    
} catch (Exception $e) {
    error_log("create-payment-due-notif.php error: " . $e->getMessage());
    echo json_encode([
        'success' => false, 
        'message' => 'Failed to create notification',
        'debug' => $e->getMessage()
    ]);
}
?>