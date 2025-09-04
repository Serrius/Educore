<?php
require 'database.php';

$course_id = $_POST['course_id'] ?? $_POST['id'] ?? null;

if (!$course_id) {
    echo json_encode(["success" => false, "message" => "No course ID provided"]);
    exit;
}

$stmt = $pdo->prepare("UPDATE courses SET status = 'Unlisted' WHERE id = ?");
$stmt->execute([$course_id]);

echo json_encode(["success" => true, "message" => "Course deleted (soft)"]);
