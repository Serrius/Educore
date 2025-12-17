<?php
// php/get-notification-count.php
header('Content-Type: application/json');
session_start();

try {
    require __DIR__ . '/database.php';
    
    if (empty($_SESSION['id_number'])) {
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);
        exit;
    }
    
    $studentId = $_SESSION['id_number'];
    
    // Count unread notifications
    $query = $pdo->prepare("
        SELECT COUNT(*) as count 
        FROM notifications 
        WHERE recipient_id_number = :student_id
        AND status = 'unread'
    ");
    
    $query->execute([':student_id' => $studentId]);
    $result = $query->fetch(PDO::FETCH_ASSOC);
    
    echo json_encode([
        'success' => true,
        'count' => (int)$result['count']
    ]);
    
} catch (Exception $e) {
    error_log("get-notification-count.php error: " . $e->getMessage());
    echo json_encode(['success' => false, 'count' => 0]);
}
?>