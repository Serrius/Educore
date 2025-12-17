<?php
// php/add-announcement.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors',1); 
error_reporting(E_ALL);
session_start();

try {
    require __DIR__.'/database.php';
    if (!isset($pdo)) throw new Exception('Database not available');

    if (empty($_SESSION['id_number'])) {
        http_response_code(401);
        echo json_encode(['success'=>false,'message'=>'Not authenticated']);
        exit;
    }

    // SESSION DATA
    $actor      = $_SESSION['id_number'];                 // user posting the announcement
    $role       = strtolower(trim($_SESSION['role'] ?? ''));
    $department = strtoupper(trim($_SESSION['department'] ?? ''));

    // Allowed creators
    if (!in_array($role, ['admin','super-admin','special-admin','staff'], true)) {
        http_response_code(403);
        echo json_encode(['success'=>false,'message'=>'Forbidden']);
        exit;
    }

    // Accept form-data
    $id          = isset($_POST['id']) ? (int)$_POST['id'] : 0;
    $title       = trim($_POST['title'] ?? '');
    $description = trim($_POST['description'] ?? '');
    $category    = trim($_POST['category'] ?? '');
    $start_year  = isset($_POST['start_year']) ? (int)$_POST['start_year'] : 0;
    $end_year    = isset($_POST['end_year'])   ? (int)$_POST['end_year']   : 0;
    $active_year = isset($_POST['active_year'])? (int)$_POST['active_year'] : 0;

    // Audience scope
    $audience_scope = ($_POST['audience_scope'] ?? 'general');
    $audience_scope = ($audience_scope === 'course') ? 'course' : 'general';

    // Selected course abbreviation
    $course_abbr = trim($_POST['course_abbr'] ?? '');

    // Basic validation
    if ($title === '' || $description === '' || $category === '' 
        || !$start_year || !$end_year
        || !in_array($active_year, [$start_year,$end_year], true)) {

        http_response_code(400);
        echo json_encode(['success'=>false,'message'=>'Missing or invalid fields']);
        exit;
    }

    // AUDIENCE RULES
    if ($audience_scope === 'course') {
        if ($role === 'super-admin') {
            if ($course_abbr === '') {
                http_response_code(400);
                echo json_encode(['success'=>false,'message'=>'Course audience selected but no course provided']);
                exit;
            }
        } else {
            if ($department === '') {
                http_response_code(400);
                echo json_encode(['success'=>false,'message'=>'Admin department missing in session']);
                exit;
            }
            $course_abbr = $department; // override for regular admins
        }
    } else {
        $course_abbr = null;
    }

    // IMAGE UPLOAD
    $imagePath = null;

    if (!empty($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
        $allowed = ['image/jpeg','image/png','image/webp'];

        if (!in_array($_FILES['image']['type'], $allowed, true)) {
            http_response_code(400);
            echo json_encode(['success'=>false,'message'=>'Invalid image type']);
            exit;
        }

        $ext = pathinfo($_FILES['image']['name'], PATHINFO_EXTENSION);
        $targetDir = __DIR__ . '/../uploads/announcements';

        if (!is_dir($targetDir)) mkdir($targetDir, 0755, true);

        $filename = uniqid('ann_', true) . '.' . $ext;
        $dest = $targetDir . '/' . $filename;

        if (!move_uploaded_file($_FILES['image']['tmp_name'], $dest)) {
            http_response_code(500);
            echo json_encode(['success'=>false,'message'=>'Failed to move uploaded file']);
            exit;
        }

        $imagePath = 'uploads/announcements/' . $filename;
    }

    // ============================================================
    // INSERT NEW ANNOUNCEMENT
    // ============================================================
    if ($id === 0) {

        // Insert announcement
        $ins = $pdo->prepare("
            INSERT INTO announcements
              (title, description, category, audience_scope, course_abbr, image_path, status,
               start_year, end_year, active_year, author_id, created_at, updated_at)
            VALUES
              (:title, :desc, :cat, :aud, :course, :img, 'Pending',
               :sy, :ey, :ay, :author, NOW(), NOW())
        ");

        $ins->execute([
            ':title'  => $title,
            ':desc'   => $description,
            ':cat'    => $category,
            ':aud'    => $audience_scope,
            ':course' => $course_abbr,
            ':img'    => $imagePath,
            ':sy'     => $start_year,
            ':ey'     => $end_year,
            ':ay'     => $active_year,
            ':author' => $actor
        ]);

        $newId = (int)$pdo->lastInsertId();

        /* ============================================================
           NOTIFICATIONS
           ------------------------------------------------------------
           RULE:
           - If SUPER-ADMIN or SPECIAL-ADMIN posts => DO NOT notify
           - If any other user posts => Notify ALL super-admins AND special-admins
           ============================================================ */

        if ($role !== 'super-admin' && $role !== 'special-admin') {

            // Fetch all super-admins and special-admins
            $getAdmins = $pdo->query("
                SELECT id_number 
                FROM users 
                WHERE LOWER(role) IN ('super-admin','special-admin')
            ");
            $reviewers = $getAdmins->fetchAll(PDO::FETCH_COLUMN);

            if ($reviewers) {
                $notif = $pdo->prepare("
                    INSERT INTO notifications
                        (recipient_id_number, actor_id_number, title, message, notif_type, status, created_at, payload_id)
                    VALUES
                        (:recipient, :actor, :title, :msg, 'announcement', 'unread', NOW(), :payload)
                ");

                foreach ($reviewers as $recId) {
                    $notif->execute([
                        ':recipient' => $recId,
                        ':actor'     => $actor,
                        ':title'     => 'New Announcement Created',
                        ':msg'       => $title,
                        ':payload'   => $newId   // so JS can know which post was clicked
                    ]);
                }
            }
        }

        echo json_encode(['success'=>true,'message'=>'Created','id'=>$newId]);
        exit;
    }

    // ============================================================
    // UPDATE EXISTING ANNOUNCEMENT
    // ============================================================
    $st = $pdo->prepare("SELECT * FROM announcements WHERE id = ? LIMIT 1");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        http_response_code(404);
        echo json_encode(['success'=>false,'message'=>'Announcement not found']);
        exit;
    }

    // Only author or admin-type roles can edit
    if ($actor !== $row['author_id'] && !in_array($role, ['admin','super-admin','special-admin'], true)) {
        http_response_code(403);
        echo json_encode(['success'=>false,'message'=>'Forbidden']);
        exit;
    }

    // Replace image if new one uploaded
    if ($imagePath && !empty($row['image_path'])) {
        @unlink(__DIR__.'/../'.$row['image_path']);
    }
    $finalImage = $imagePath ?? $row['image_path'];

    $upd = $pdo->prepare("
        UPDATE announcements
           SET title = :title,
               description = :desc,
               category = :cat,
               audience_scope = :aud,
               course_abbr = :course,
               image_path = :img,
               start_year = :sy,
               end_year = :ey,
               active_year = :ay,
               updated_at = NOW()
         WHERE id = :id
    ");

    $upd->execute([
        ':title'  => $title,
        ':desc'   => $description,
        ':cat'    => $category,
        ':aud'    => $audience_scope,
        ':course' => $course_abbr,
        ':img'    => $finalImage,
        ':sy'     => $start_year,
        ':ey'     => $end_year,
        ':ay'     => $active_year,
        ':id'     => $id
    ]);

    echo json_encode(['success'=>true,'message'=>'Updated','id'=>$id]);
    exit;

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>$e->getMessage()]);
}
