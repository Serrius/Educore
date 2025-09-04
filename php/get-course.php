<?php
require 'database.php';

header('Content-Type: application/json');

if (!isset($_GET['id'])) {
    echo json_encode(["success" => false, "message" => "Missing course ID"]);
    exit;
}

$courseId = intval($_GET['id']);

try {
    $stmt = $pdo->prepare("SELECT * FROM courses WHERE id = ? LIMIT 1");
    $stmt->execute([$courseId]);
    $course = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($course) {
        echo json_encode(["success" => true, "course" => $course]);
    } else {
        echo json_encode(["success" => false, "message" => "Course not found"]);
    }
} catch (Exception $e) {
    echo json_encode(["success" => false, "message" => $e->getMessage()]);
}
