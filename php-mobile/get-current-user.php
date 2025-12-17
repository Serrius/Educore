<?php
// php/get-current-user.php
header('Content-Type: application/json');
ini_set('display_errors', 1);
error_reporting(E_ALL);

session_start();
require_once 'database.php'; // uses your PDO connection

// ❌ Not logged in
if (!isset($_SESSION['id_number'])) {
    http_response_code(401);
    echo json_encode([
        'success' => false,
        'message' => 'User not logged in'
    ]);
    exit;
}

$idNumber = $_SESSION['id_number'];

try {
    $stmt = $pdo->prepare("
        SELECT 
            id_number,
            first_name,
            middle_name,
            last_name,
            suffix,
            role,
            user_type,
            department,
            status,
            email,
            profile_picture,
            school_year,
            year
        FROM users
        WHERE id_number = :id_number
        LIMIT 1
    ");
    $stmt->execute(['id_number' => $idNumber]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        http_response_code(404);
        echo json_encode([
            'success' => false,
            'message' => 'User not found'
        ]);
        exit;
    }

    echo json_encode($user);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Database error',
        'error' => $e->getMessage()
    ]);
}
