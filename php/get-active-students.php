<?php
// thesis/php/get-pending-students.php
header('Content-Type: application/json');

// TEMP while debugging
ini_set('display_errors', '1');
error_reporting(E_ALL);

function jerr(int $http, string $msg, array $extra = []): void {
  http_response_code($http);
  echo json_encode(['error' => $msg] + $extra);
  exit;
}

try {
  // Require central DB
  $dbPath = __DIR__ . '/database.php';
  if (!file_exists($dbPath)) {
    jerr(500, 'database.php not found', ['dbPath' => $dbPath, 'dir' => __DIR__]);
  }
  require_once $dbPath;

  if (!isset($pdo) || !($pdo instanceof PDO)) {
    jerr(500, 'PDO not initialized from database.php');
  }

  $pdo->query("SELECT 1");

  // UPDATED: using new name fields
  $sql = "
    SELECT
      `id`,
      `first_name`,
      `middle_name`,
      `last_name`,
      `suffix`,
      `department`, 
      `school_year`,
      `status`,
      `created_at`
    FROM `users`
    WHERE `user_type` = 'student'
      AND `status` = 'Active'
      AND `id` <> 1
      AND `role` <> 'super-admin'
    ORDER BY `created_at` DESC, `id` DESC
  ";

  $rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);

  // Build full_name dynamically for UI compatibility
  foreach ($rows as &$u) {
    $parts = [];

    if (!empty($u['first_name']))  $parts[] = $u['first_name'];
    if (!empty($u['middle_name'])) $parts[] = $u['middle_name'];
    if (!empty($u['last_name']))   $parts[] = $u['last_name'];

    $full = trim(implode(' ', $parts));

    if (!empty($u['suffix'])) {
      $full = trim($full . ' ' . $u['suffix']);
    }

    $u['full_name'] = $full;
  }

  echo json_encode($rows);

} catch (PDOException $e) {
  jerr(500, 'DB error', ['detail' => $e->getMessage()]);
} catch (Throwable $e) {
  jerr(500, 'Server exception', ['detail' => $e->getMessage()]);
}
