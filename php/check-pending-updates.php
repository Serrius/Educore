<?php
// check-pending-updates.php
header('Content-Type: application/json');
session_start();

require_once 'database.php'; // Include your existing database connection

try {
    $type = $_GET['type'] ?? 'announcements';
    $status = $_GET['status'] ?? null;
    
    if ($type === 'announcements') {
        $query = "SELECT MAX(updated_at) as last_updated FROM announcements";
        
        if ($status && $status !== 'all') {
            $query .= " WHERE status = :status";
            $stmt = $pdo->prepare($query);
            $stmt->execute([':status' => $status]);
        } else {
            $stmt = $pdo->query($query);
        }
        
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        
        if ($result && $result['last_updated']) {
            echo json_encode([
                'success' => true,
                'last_updated' => $result['last_updated']
            ]);
        } else {
            echo json_encode([
                'success' => true,
                'last_updated' => date('Y-m-d H:i:s')
            ]);
        }
    }
    
} catch (Exception $e) {
    echo json_encode([
        'success' => false,
        'message' => 'Error checking updates'
    ]);
}
?>