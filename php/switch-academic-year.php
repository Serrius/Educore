<?php
require 'database.php';
header('Content-Type: application/json');

$id = intval($_POST['id'] ?? 0);

try {
    $pdo->beginTransaction();

    // Lock the AY row so toggle + updates are atomic
    $stmt = $pdo->prepare("
        SELECT id, start_year, end_year, active_year, status
        FROM academic_years
        WHERE id = ? AND status = 'Active'
        FOR UPDATE
    ");
    $stmt->execute([$id]);
    $year = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$year) {
        $pdo->rollBack();
        echo json_encode(["success" => false, "message" => "Year not active or not found."]);
        exit;
    }

    $startYear  = (int)$year['start_year'];
    $endYear    = (int)$year['end_year'];
    $oldActive  = (int)$year['active_year'];
    $newActive  = ($oldActive === $startYear) ? $endYear : $startYear;

    // Toggle the active_year pointer inside this span
    $upd = $pdo->prepare("UPDATE academic_years SET active_year = ? WHERE id = ?");
    $upd->execute([$newActive, $id]);

    $pdo->commit();

    echo json_encode([
        "success"  => true,
        "message"  => "Academic year switched successfully.",
        "toggled_from" => $oldActive,
        "toggled_to"   => $newActive
    ]);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    echo json_encode(["success" => false, "message" => "Error: " . $e->getMessage()]);
}