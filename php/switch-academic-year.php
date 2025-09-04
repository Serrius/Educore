<?php
require 'database.php';

header('Content-Type: application/json');

$id = intval($_POST['id'] ?? 0);

try {
    // Check if academic year is active
    $stmt = $pdo->prepare("SELECT * FROM academic_years WHERE id = ? AND status = 'Active'");
    $stmt->execute([$id]);
    $year = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$year) {
        echo json_encode(["success" => false, "message" => "Year not active or not found."]);
        exit;
    }

    // Toggle active year between start_year and end_year
    $newActive = ($year['active_year'] == $year['start_year']) ? $year['end_year'] : $year['start_year'];

    $stmt = $pdo->prepare("UPDATE academic_years SET active_year = ? WHERE id = ?");
    $success = $stmt->execute([$newActive, $id]);

    echo json_encode([
        "success" => $success,
        "message" => $success ? "Academic year switched successfully." : "Database error"
    ]);
} catch (PDOException $e) {
    echo json_encode(["success" => false, "message" => "Error: " . $e->getMessage()]);
}
