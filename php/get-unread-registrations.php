<?php
// php/get-unread-registrations.php
header('Content-Type: application/json');
ini_set('display_errors', '1');
error_reporting(E_ALL);

session_start();

function jerr(int $http, string $msg, array $extra = []) {
  http_response_code($http);
  echo json_encode(['success' => false, 'message' => $msg] + $extra);
  exit;
}

try {
  require __DIR__ . '/database.php';

  // Logged-in admin/staff id_number who receives notifications
  $me = $_SESSION['id_number'] ?? null;
  if (!$me) jerr(401, 'Not authenticated (no id_number in session)');

  // Get unread registration notifications where *this* user is the recipient.
  // We return the notification id (needed to mark as read) and the actor (student) id_number.
  $stmt = $pdo->prepare("
    SELECT n.id AS notif_id, n.actor_id_number
      FROM notifications n
     WHERE n.recipient_id_number = :me
       AND n.status = 'unread'
       AND n.notif_type = 'registration'
     ORDER BY n.created_at DESC, n.id DESC
  ");
  $stmt->execute([':me' => $me]);
  $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

  echo json_encode(['success' => true, 'items' => $rows]);
} catch (Throwable $e) {
  jerr(500, 'Server error', ['detail' => $e->getMessage()]);
}
