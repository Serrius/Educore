<?php
// php/get-general-notification.php
header('Content-Type: application/json');
session_start();

try {
    require __DIR__ . '/database.php';
    
    if (empty($_SESSION['id_number'])) {
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);
        exit;
    }
    
    $notificationId = isset($_GET['id']) ? (int)$_GET['id'] : 0;
    $studentId = $_SESSION['id_number'];
    
    if ($notificationId <= 0) {
        echo json_encode(['success' => false, 'message' => 'Invalid notification ID']);
        exit;
    }
    
    // Get notification details
    $notificationQuery = $pdo->prepare("
        SELECT n.*, 
               u.first_name as actor_first, u.last_name as actor_last,
               u.id_number as actor_id
        FROM notifications n
        LEFT JOIN users u ON u.id_number = n.actor_id_number
        WHERE n.id = :notification_id 
        AND n.recipient_id_number = :student_id
        LIMIT 1
    ");
    
    $notificationQuery->execute([
        ':notification_id' => $notificationId,
        ':student_id' => $studentId
    ]);
    
    $notification = $notificationQuery->fetch(PDO::FETCH_ASSOC);
    
    if (!$notification) {
        echo json_encode(['success' => false, 'message' => 'Notification not found']);
        exit;
    }
    
    // Format actor name
    $actorName = '';
    if ($notification['actor_first']) {
        $actorName = $notification['actor_first'];
        if ($notification['actor_last']) {
            $actorName .= ' ' . $notification['actor_last'];
        }
        if ($notification['actor_id']) {
            $actorName .= ' (' . $notification['actor_id'] . ')';
        }
    } else if ($notification['actor_id']) {
        $actorName = $notification['actor_id'];
    } else {
        $actorName = 'System';
    }
    
    echo json_encode([
        'success' => true,
        'notification' => [
            'id' => $notification['id'],
            'title' => $notification['title'],
            'message' => $notification['message'],
            'type' => $notification['notif_type'],
            'created_at' => $notification['created_at'],
            'actor' => $actorName,
            'status' => $notification['status']
        ]
    ]);
    
} catch (Exception $e) {
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}