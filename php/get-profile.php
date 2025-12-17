<?php
// php/get-profile.php
session_start();
require_once 'database.php';

header('Content-Type: application/json');

// Check if user is logged in
if (!isset($_SESSION['id_number'])) {
    echo json_encode(['success' => false, 'message' => 'Not authenticated']);
    exit;
}

try {
    $idNumber = $_SESSION['id_number'];
    
    $stmt = $pdo->prepare("
        SELECT 
            id_number,
            first_name,
            middle_name,
            last_name,
            suffix,
            email,
            user_type,
            role,
            department,
            school_year,
            status,
            profile_picture,
            created_at
        FROM users 
        WHERE id_number = ?
    ");
    $stmt->execute([$idNumber]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$user) {
        echo json_encode(['success' => false, 'message' => 'User not found']);
        exit;
    }
    
    // Ensure profile picture has a default
    if (empty($user['profile_picture'])) {
        $user['profile_picture'] = 'assets/images/profile.png';
    }
    
    // Calculate account age
    $createdAt = new DateTime($user['created_at']);
    $now = new DateTime();
    $interval = $createdAt->diff($now);
    
    $user['account_age'] = [
        'years' => $interval->y,
        'months' => $interval->m,
        'days' => $interval->d
    ];
    
    echo json_encode([
        'success' => true,
        'user' => $user
    ]);
    
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
}
?>