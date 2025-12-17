<?php
// php/mark-notification-read.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors', '1');
error_reporting(E_ALL);

session_start();
require __DIR__ . '/database.php'; // must create $pdo (PDO)

// ---- Helper ----
function fail($msg, $code = 400) {
  http_response_code($code);
  echo json_encode(['success' => false, 'message' => $msg]);
  exit;
}

try {
    // Safely read integer ID from POST
    $rawId = $_POST['id'] ?? null;

    // allow numeric strings only (e.g., "5")
    if ($rawId !== null && ctype_digit((string)$rawId)) {
        $notifId = (int)$rawId;
    } else {
        $notifId = 0;
    }

    $recipient = $_SESSION['id_number'] ?? null;

    if (!$recipient) {
        fail('Not authenticated (no id_number in session)', 401);
    }
    if ($notifId <= 0) {
        fail('Missing or invalid notification id');
    }

    // Only update if this notif belongs to the logged-in user
    $stmt = $pdo->prepare("
        UPDATE notifications
           SET status = 'read'
         WHERE id = :id
           AND recipient_id_number = :recipient
    ");
    $ok = $stmt->execute([
        ':id'        => $notifId,
        ':recipient' => $recipient
    ]);

    if ($ok && $stmt->rowCount() > 0) {
        echo json_encode(['success' => true]);
    } else {
        fail('Notification not found or already read', 404);
    }

} catch (PDOException $e) {
    fail('Database error: ' . $e->getMessage(), 500);
} catch (Exception $e) {
    fail('Server error: ' . $e->getMessage(), 500);
}
