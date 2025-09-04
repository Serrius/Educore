<?php
require_once 'database.php'; // assumes PDO connection in $pdo

// Read JSON input
$data = json_decode(file_get_contents('php://input'), true);
$username = $data['username'] ?? '';
$password = $data['password'] ?? '';

// Basic validation
if (empty($username) || empty($password)) {
    echo json_encode(['success' => false, 'message' => 'Missing username or password.']);
    exit;
}

try {
    $stmt = $pdo->prepare("SELECT * FROM users WHERE id_number = ?");
    $stmt->execute([$username]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($user && $user['password'] === md5($password)) {
        echo json_encode([
            'success' => true,
            'id' => $user['id'], // internal DB ID
            'id_number' => $user['id_number'], // student/staff ID
            'full_name' => $user['full_name'],
            'role' => $user['role'],
            'user_type' => $user['user_type'],
            'email' => $user['email'],
            'department' => $user['department'],
            'school_year' => $user['school_year'],
            'status' => $user['status'],
            'profile_picture' => $user['profile_picture'] // Optional
        ]);
    } else {
        echo json_encode(['success' => false, 'message' => 'Invalid credentials.']);
    }
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'message' => 'Database error.']);
}
?>
