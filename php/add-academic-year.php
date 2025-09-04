<?php
require 'database.php';

header('Content-Type: application/json');

$start_year = intval($_POST['start_year'] ?? 0);
$end_year   = intval($_POST['end_year'] ?? 0);

// ===== Validation =====
if ($start_year <= 0 || $end_year <= 0) {
    echo json_encode(["success" => false, "message" => "Invalid year values"]);
    exit;
}

if ($end_year !== $start_year + 1) {
    echo json_encode(["success" => false, "message" => "Academic year must be consecutive (e.g., 2025-2026)"]);
    exit;
}

$currentYear = intval(date("Y"));
if ($start_year < $currentYear) {
    echo json_encode(["success" => false, "message" => "Cannot add past academic years"]);
    exit;
}

// ===== Check duplicate =====
try {
    $stmt = $pdo->prepare("SELECT id FROM academic_years WHERE start_year = ? AND end_year = ?");
    $stmt->execute([$start_year, $end_year]);

    if ($stmt->fetch()) {
        echo json_encode(["success" => false, "message" => "Academic year already exists"]);
        exit;
    }

    // ===== Insert new year (Inactive by default) =====
    $stmt = $pdo->prepare("
        INSERT INTO academic_years (start_year, end_year, active_year, status, created_at) 
        VALUES (?, ?, ?, 'Closed', NOW())
    ");
    $success = $stmt->execute([$start_year, $end_year, $start_year]);

    echo json_encode([
        "success" => $success,
        "message" => $success ? "Academic year added successfully." : "Database error"
    ]);
} catch (PDOException $e) {
    echo json_encode(["success" => false, "message" => "Error: " . $e->getMessage()]);
}
