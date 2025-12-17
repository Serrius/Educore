<?php
header('Content-Type: application/json');
require __DIR__ . '/database.php';

try {
  $stmt = $pdo->query("SELECT start_year, end_year, active_year FROM academic_years WHERE status = 'Active' ORDER BY id DESC LIMIT 1");
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  if ($row) {
    echo json_encode([
      'school_year' => $row['start_year'] . '-' . $row['end_year'],
      'active_year' => $row['active_year']
    ]);
  } else {
    echo json_encode(['school_year' => null, 'warning' => 'No active academic year']);
  }
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['error' => 'DB error', 'detail' => $e->getMessage()]);
}