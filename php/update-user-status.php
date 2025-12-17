<?php
// php/update-user-status.php
header('Content-Type: application/json; charset=utf-8');
session_start();

require 'database.php';

function json_fail($msg, $code = 400) {
  http_response_code($code);
  echo json_encode(['success' => false, 'message' => $msg]);
  exit;
}

try {
  // Check authentication
  $currentUserId = $_SESSION['id_number'] ?? null;
  if (!$currentUserId) {
    json_fail('Not authenticated', 401);
  }

  // Check if current user has permission (super-admin or admin)
  $userStmt = $pdo->prepare("SELECT role FROM users WHERE id_number = :id");
  $userStmt->execute([':id' => $currentUserId]);
  $currentUser = $userStmt->fetch(PDO::FETCH_ASSOC);
  
  if (!$currentUser || !in_array($currentUser['role'], ['super-admin', 'admin'])) {
    json_fail('Permission denied', 403);
  }

  // Get parameters
  $userId = $_POST['id'] ?? 0;
  $status = $_POST['status'] ?? '';
  $idNumber = $_POST['id_number'] ?? '';

  $userId = (int)$userId;
  if ($userId <= 0) {
    json_fail('Invalid user ID', 400);
  }

  $allowedStatus = ['Active', 'Inactive', 'Archived'];
  if (!in_array($status, $allowedStatus, true)) {
    json_fail('Invalid status', 400);
  }

  // Prevent self-modification (optional)
  if ($idNumber === $currentUserId) {
    json_fail('You cannot modify your own status', 400);
  }

  // Update user status
  $stmt = $pdo->prepare("
    UPDATE users 
    SET status = :status 
    WHERE id = :id
  ");
  
  $success = $stmt->execute([
    ':status' => $status,
    ':id' => $userId
  ]);

  if ($success && $stmt->rowCount() > 0) {
    // Create notification for the user (optional)
    $notificationStmt = $pdo->prepare("
      INSERT INTO notifications 
      (recipient_id_number, actor_id_number, title, message, notif_type, status) 
      VALUES (:recipient, :actor, :title, :message, 'general', 'unread')
    ");
    
    $action = $status === 'Active' ? 'activated' : 'deactivated';
    $notificationStmt->execute([
      ':recipient' => $idNumber,
      ':actor' => $currentUserId,
      ':title' => 'Account Status Updated',
      ':message' => "Your account has been {$action} by an administrator."
    ]);
    
    echo json_encode(['success' => true]);
  } else {
    json_fail('Failed to update user status', 500);
  }

} catch (PDOException $e) {
  json_fail('Database error: ' . $e->getMessage(), 500);
} catch (Exception $e) {
  json_fail('Server error: ' . $e->getMessage(), 500);
}