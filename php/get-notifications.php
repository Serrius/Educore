<?php
// php/get-notifications.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors', '1');
error_reporting(E_ALL);

session_start();

require 'database.php'; // must create $pdo (PDO)

// ---------- helpers ----------
function json_fail($msg, $code = 400) {
  http_response_code($code);
  echo json_encode(['success' => false, 'message' => $msg]);
  exit;
}

/**
 * Very small "time ago" helper (returns e.g. "Just now", "5m", "2h", "3d")
 */
function time_ago($datetime, $now = null) {
  if (!$datetime) return '';
  $nowTs = $now ? strtotime($now) : time();
  $ts    = strtotime($datetime);
  if ($ts === false) return '';

  $diff = max(0, $nowTs - $ts);
  if ($diff < 60)      return 'Just now';
  if ($diff < 3600)    return floor($diff / 60) . 'm';
  if ($diff < 86400)   return floor($diff / 3600) . 'h';
  if ($diff < 604800)  return floor($diff / 86400) . 'd';
  return date('Y-m-d', $ts); // fallback to date if older than a week
}

try {
  // --- auth / recipient from session ---
  $recipient = $_SESSION['id_number'] ?? null;
  if (!$recipient) {
    json_fail('Not authenticated or missing id_number in session', 401);
  }

  // --- filters ---
  $statusParam = isset($_GET['status']) ? strtolower(trim($_GET['status'])) : 'all';
  $allowedStatus = ['unread', 'read', 'all'];
  if (!in_array($statusParam, $allowedStatus, true)) $statusParam = 'all';

  $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 20;
  if ($limit < 1)   $limit = 20;
  if ($limit > 100) $limit = 100;

  $afterId = isset($_GET['after_id']) ? (int)$_GET['after_id'] : 0;

  // --- build WHERE ---
  $where  = ["n.recipient_id_number = :recipient"];
  $params = [':recipient' => $recipient];

  if ($statusParam !== 'all') {
    $where[] = "n.status = :status";
    $params[':status'] = $statusParam;
  }
  if ($afterId > 0) {
    $where[] = "n.id > :after_id";
    $params[':after_id'] = $afterId;
  }
  $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

  // --- main query (join actor user) ---
  $sql = "
    SELECT
      n.id,
      n.recipient_id_number,
      n.actor_id_number,
      n.title,
      n.message,
      n.notif_type,
      n.status,            -- 'unread' | 'read'
      n.created_at,
      n.payload_id,        -- IMPORTANT: Include payload_id for announcements

      a.id                AS actor_user_id,
      a.first_name        AS actor_first_name,
      a.middle_name       AS actor_middle_name,
      a.last_name         AS actor_last_name,
      a.suffix            AS actor_suffix,
      a.profile_picture   AS actor_profile_picture
    FROM notifications n
    LEFT JOIN users a
      ON a.id_number = n.actor_id_number
    $whereSql
    ORDER BY n.id DESC
    LIMIT :lim
  ";
  $stmt = $pdo->prepare($sql);

  // bind dynamic params
  foreach ($params as $k => $v) {
    if ($k === ':after_id') continue; // bind separately as int below
    $stmt->bindValue($k, $v);
  }
  if ($afterId > 0) {
    $stmt->bindValue(':after_id', $afterId, PDO::PARAM_INT);
  }
  $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);

  $stmt->execute();
  $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

  // --- unread count (for the red dot) ---
  $cntStmt = $pdo->prepare("
    SELECT COUNT(*) 
    FROM notifications
    WHERE recipient_id_number = :recipient AND status = 'unread'
  ");
  $cntStmt->execute([':recipient' => $recipient]);
  $unreadCount = (int)$cntStmt->fetchColumn();

  // latest id (handy for polling with after_id)
  $latestId = 0;
  if (!empty($rows)) {
    $latestId = (int)$rows[0]['id'];
  }

  // --- normalize/alias fields for frontend ---
  $out = array_map(function($r) {
    $isRead  = ($r['status'] === 'read') ? 1 : 0;
    $readAt  = $isRead ? $r['created_at'] : null;

    // Build actor full name from split fields
    $actorFirst  = $r['actor_first_name']  ?? '';
    $actorMiddle = $r['actor_middle_name'] ?? '';
    $actorLast   = $r['actor_last_name']   ?? '';
    $actorSuffix = $r['actor_suffix']      ?? '';

    $nameParts = array_filter([$actorFirst, $actorMiddle, $actorLast]);
    $actorName = trim(implode(' ', $nameParts));
    if ($actorSuffix !== '') {
      $actorName = trim($actorName . ' ' . $actorSuffix);
    }

    // Provide multiple aliases so JS can always resolve a user:
    $userId   = isset($r['actor_user_id']) ? (int)$r['actor_user_id'] : null;
    $idNumber = $r['actor_id_number'] ?? null;

    return [
      'id'                    => (int)$r['id'],
      'payload_id'            => (int)$r['payload_id'], // CRITICAL FIX: Include payload_id
      'title'                 => $r['title'],
      'body'                  => $r['message'],
      'message'               => $r['message'],
      'notif_type'            => $r['notif_type'],
      'status'                => $r['status'],
      'is_read'               => $isRead,
      'read_at'               => $readAt,
      'created_at'            => $r['created_at'],
      'time_ago'              => time_ago($r['created_at']),
      // actor info
      'actor_id_number'       => $r['actor_id_number'],
      'actor_name'            => $actorName,
      'actor_profile_picture' => $r['actor_profile_picture'],
      // user locators (aliases)
      'user_id'               => $userId,
      'id_number'             => $idNumber,
      'user_id_number'        => $idNumber,
      'target_id_number'      => $idNumber,
    ];
  }, $rows);

  echo json_encode([
    'success'       => true,
    'recipient'     => $recipient,
    'unread_count'  => $unreadCount,
    'latest_id'     => $latestId,
    'notifications' => $out
  ]);

} catch (PDOException $e) {
  json_fail('Database error: ' . $e->getMessage(), 500);
} catch (Exception $e) {
  json_fail('Server error: ' . $e->getMessage(), 500);
}