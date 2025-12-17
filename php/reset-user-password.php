<?php
// reset-user-password.php
require_once 'database.php';
session_start();

// Check if user is authorized
if (!isset($_SESSION['id']) || !isset($_SESSION['role'])) {
    die(json_encode(['success' => false, 'message' => 'Unauthorized access']));
}

// Only allow admin, super-admin, or special-admin
$allowed_roles = ['admin', 'super-admin', 'special-admin'];
if (!in_array($_SESSION['role'], $allowed_roles)) {
    die(json_encode(['success' => false, 'message' => 'Insufficient permissions']));
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    die(json_encode(['success' => false, 'message' => 'Invalid request method']));
}

// Get JSON input
$input = json_decode(file_get_contents('php://input'), true);
$userId = intval($input['id'] ?? 0);

if ($userId <= 0) {
    die(json_encode(['success' => false, 'message' => 'Invalid user ID']));
}

try {
    // Check if trying to reset own password (optional restriction)
    if ($userId == $_SESSION['id']) {
        // Optional: Allow self-reset or restrict
        // die(json_encode(['success' => false, 'message' => 'You cannot reset your own password']));
    }
    
    // Get user's ID number from the users table
    $stmt = $pdo->prepare("SELECT id_number FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        die(json_encode(['success' => false, 'message' => 'User not found']));
    }

    $idNumber = $user['id_number'];

    // Reset password to hash of ID number (default password)
    $hashedPassword = password_hash($idNumber, PASSWORD_DEFAULT);

    // Update the password
    $updateStmt = $pdo->prepare("UPDATE users SET password = ? WHERE id = ?");
    $updateStmt->execute([$hashedPassword, $userId]);

    if ($updateStmt->rowCount() > 0) {
        // Log the action (optional - if you have audit_logs table)
        /*
        try {
            $logStmt = $pdo->prepare("
                INSERT INTO audit_logs (user_id, action, details, created_at) 
                VALUES (?, 'password_reset', ?, NOW())
            ");
            $logStmt->execute([$_SESSION['id'], "Reset password for user ID: $userId"]);
        } catch (Exception $e) {
            // Log table might not exist, ignore
        }
        */
        
        echo json_encode([
            'success' => true, 
            'message' => 'Password reset successfully to default (ID number)',
            'default_password' => $idNumber // Optional: return the default password
        ]);
    } else {
        echo json_encode(['success' => false, 'message' => 'Failed to reset password or no changes made']);
    }
    
} catch (PDOException $e) {
    error_log("Password reset error: " . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'An error occurred while resetting password: ' . $e->getMessage()]);
} catch (Exception $e) {
    error_log("Password reset error: " . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'An error occurred while resetting password']);
}
?>