<?php
require 'database.php';

header('Content-Type: application/json');

try {
    $stmt = $pdo->prepare("SELECT * FROM courses WHERE status ORDER BY created_at DESC");
    $stmt->execute();
    $courses = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode($courses);
} catch (Exception $e) {
    echo json_encode(["error" => $e->getMessage()]);
}
