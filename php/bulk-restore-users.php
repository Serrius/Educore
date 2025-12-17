<?php
header('Content-Type: application/json');
ini_set('display_errors', '1');
error_reporting(E_ALL);

function jerr(int $http, string $msg, array $extra = []): void {
  http_response_code($http);
  echo json_encode(['error' => $msg] + $extra);
  exit;
}

try {
  require_once __DIR__ . '/database.php';

  $in  = json_decode(file_get_contents('php://input'), true);
  $ids = $in['ids'] ?? [];

  if (!$ids || !is_array($ids)) {
    jerr(400, 'Invalid payload', ['ids' => $ids]);
  }

  $ph  = implode(',', array_fill(0, count($ids), '?'));
  $sql = "UPDATE `users` 
          SET `status` = 'Inactive' 
          WHERE `id` IN ($ph) 
            AND `id` <> 1 
            AND `role` <> 'super-admin'";

  $stmt = $pdo->prepare($sql);
  $stmt->execute($ids);

  echo json_encode(['updated' => $stmt->rowCount()]);
} catch (PDOException $e) {
  jerr(500, 'DB error', ['detail' => $e->getMessage()]);
} catch (Throwable $e) {
  jerr(500, 'Server exception', ['detail' => $e->getMessage()]);
}
