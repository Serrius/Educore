<?php
require __DIR__ . '/database.php'; // load your PDO connection

header('Content-Type: application/json');

try {
    $stmt = $pdo->query("SELECT * FROM academic_years ORDER BY start_year DESC");
    $years = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        "success" => true,
        "years" => $years
    ]);
} catch (PDOException $e) {
    echo json_encode([
        "success" => false,
        "message" => "Error fetching academic years: " . $e->getMessage()
    ]);
}
