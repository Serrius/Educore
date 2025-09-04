<?php
require 'database.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $id           = $_POST['course_id'];
    $course_name  = $_POST['course_name'];
    $abbreviation = $_POST['abbreviation'];

    $image_sql = "";
    $params    = [$course_name, $abbreviation, $id];

    // If a new image is uploaded
    if (!empty($_FILES['image_path']['name'])) {
        $targetDir = "../uploads/courses/";
        if (!is_dir($targetDir)) mkdir($targetDir, 0777, true);

        $fileName   = time() . "_" . basename($_FILES["image_path"]["name"]);
        $targetFile = $targetDir . $fileName;

        if (move_uploaded_file($_FILES["image_path"]["tmp_name"], $targetFile)) {
            $image_path = "uploads/courses/" . $fileName;
            $image_sql  = ", image_path=?";
            $params     = [$course_name, $abbreviation, $image_path, $id];
        }
    }

    $stmt = $pdo->prepare("UPDATE courses SET course_name=?, abbreviation=? $image_sql WHERE id=?");
    $stmt->execute($params);

    echo json_encode(["success" => true, "message" => "Course updated successfully"]);
}
