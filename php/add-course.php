<?php
require 'database.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $course_name  = $_POST['course_name'] ?? '';
    $abbreviation = $_POST['abbreviation'] ?? '';
    $status       = 'Active';
    $author_id    = 1; // TODO: replace with session user ID

    // Handle image upload
    $image_path = null;
    if (!empty($_FILES['image_path']['name'])) {
        $targetDir = "../uploads/courses/";
        if (!is_dir($targetDir)) mkdir($targetDir, 0777, true);

        $fileName   = time() . "_" . basename($_FILES["image_path"]["name"]);
        $targetFile = $targetDir . $fileName;

        if (move_uploaded_file($_FILES["image_path"]["tmp_name"], $targetFile)) {
            $image_path = "uploads/courses/" . $fileName;
        }
    }

    $stmt = $pdo->prepare("INSERT INTO courses (course_name, abbreviation, image_path, status, author_id) 
                           VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([$course_name, $abbreviation, $image_path, $status, $author_id]);

    echo json_encode(["success" => true, "message" => "Course added successfully"]);
}
