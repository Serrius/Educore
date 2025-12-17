<?php
header('Content-Type: application/json');
require __DIR__ . '/database.php';

try {
  $stmt = $pdo->query("SELECT id, course_name, abbreviation FROM courses WHERE status = 'Active' ORDER BY course_name ASC");
  echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC) ?: []);
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['error' => 'DB error', 'detail' => $e->getMessage()]);
}
