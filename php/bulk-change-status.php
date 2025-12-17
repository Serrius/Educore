<?php
// php/bulk-change-status.php
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

  $in = json_decode(file_get_contents('php://input'), true);
  $ids = $in['ids'] ?? [];
  $st  = $in['status'] ?? null;

  // basic validation
  if (!is_array($ids) || empty($ids)) {
    jerr(400, 'Invalid payload: ids required');
  }
  // normalize ids to ints
  $ids = array_values(array_filter(array_map('intval', $ids), fn($v) => $v > 0));
  if (empty($ids)) {
    jerr(400, 'Invalid payload: ids must be positive integers');
  }

  if (!in_array($st, ['Active','Inactive','Archived'], true)) {
    jerr(400, 'Invalid status value', ['status' => $st]);
  }

  // Build placeholders
  $ph = implode(',', array_fill(0, count($ids), '?'));

  // If setting to Active, also update school_year for STUDENTS using active academic year
  if ($st === 'Active') {
    // Find the current active academic year
    $ayStmt = $pdo->prepare("
      SELECT start_year, end_year
        FROM academic_years
       WHERE status = 'Active'
       ORDER BY id DESC
       LIMIT 1
    ");
    $ayStmt->execute();
    $activeAY = $ayStmt->fetch(PDO::FETCH_ASSOC);

    if ($activeAY) {
      $schoolYear = "{$activeAY['start_year']}-{$activeAY['end_year']}";

      // Update: status for ALL (except super-admin) + school_year for STUDENTS only
      // 1) Set status for all target users except super-admin
      $sqlStatus = "UPDATE `users`
                       SET `status` = ?
                     WHERE `id` IN ($ph)
                       AND `id` <> 1
                       AND `role` <> 'super-admin'";
      $stmt1 = $pdo->prepare($sqlStatus);
      $stmt1->execute(array_merge([$st], $ids));
      $updatedStatus = $stmt1->rowCount();

      // 2) Set school_year for students only (same id set)
      $sqlSY = "UPDATE `users`
                   SET `school_year` = ?
                 WHERE `id` IN ($ph)
                   AND `id` <> 1
                   AND `role` <> 'super-admin'
                   AND `user_type` = 'student'";
      $stmt2 = $pdo->prepare($sqlSY);
      $stmt2->execute(array_merge([$schoolYear], $ids));
      $updatedSY = $stmt2->rowCount();

      echo json_encode([
        'updated' => $updatedStatus,
        'school_year_set' => $updatedSY,
        'school_year' => $schoolYear
      ]);
      exit;

    } else {
      // No active academic year found — still flip status, but don't touch school_year
      $sql = "UPDATE `users`
                 SET `status` = ?
               WHERE `id` IN ($ph)
                 AND `id` <> 1
                 AND `role` <> 'super-admin'";
      $stmt = $pdo->prepare($sql);
      $stmt->execute(array_merge([$st], $ids));
      echo json_encode([
        'updated' => $stmt->rowCount(),
        'warning' => 'No active academic year found; school_year unchanged.'
      ]);
      exit;
    }
  }

  // For Inactive / Unlisted — only change status
  $sql = "UPDATE `users`
             SET `status` = ?
           WHERE `id` IN ($ph)
             AND `id` <> 1
             AND `role` <> 'super-admin'";
  $stmt = $pdo->prepare($sql);
  $stmt->execute(array_merge([$st], $ids));

  echo json_encode(['updated' => $stmt->rowCount()]);
} catch (PDOException $e) {
  jerr(500, 'DB error', ['detail' => $e->getMessage()]);
} catch (Throwable $e) {
  jerr(500, 'Server exception', ['detail' => $e->getMessage()]);
}
