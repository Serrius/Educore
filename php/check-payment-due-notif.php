<?php
// php/check-payment-due-notif.php
header('Content-Type: application/json');
session_start();

try {
    require __DIR__ . '/database.php';
    
    if (empty($_SESSION['id_number'])) {
        echo json_encode(['exists' => false, 'error' => 'Not authenticated']);
        exit;
    }
    
    $studentId = $_SESSION['id_number'];
    $today = date('Y-m-d');
    
    // Check if a payment due notification was created today
    $query = $pdo->prepare("
        SELECT COUNT(*) as count 
        FROM notifications 
        WHERE recipient_id_number = :student_id
        AND notif_type = 'payment'
        AND DATE(created_at) = :today
        AND (title LIKE '%payment%due%' OR title LIKE '%unpaid%fee%')
    ");
    
    $query->execute([
        ':student_id' => $studentId,
        ':today' => $today
    ]);
    
    $result = $query->fetch(PDO::FETCH_ASSOC);
    $exists = ($result['count'] > 0);
    
    echo json_encode([
        'exists' => $exists,
        'today' => $today
    ]);
    
} catch (Exception $e) {
    echo json_encode(['exists' => false, 'error' => $e->getMessage()]);
}
?>