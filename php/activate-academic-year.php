<?php
require 'database.php';

$id = intval($_POST['id'] ?? 0);

if (!$id) {
    echo json_encode(["success" => false, "message" => "Invalid academic year ID."]);
    exit;
}

// Reset all to inactive
$pdo->exec("UPDATE academic_years SET status='Closed'");

// Activate selected
$stmt = $pdo->prepare("UPDATE academic_years SET status='Active', active_year=start_year WHERE id=?");
$success = $stmt->execute([$id]);

echo json_encode([
    "success" => $success,
    "message" => $success ? "Academic year activated successfully." : "Failed to activate academic year."
]);
