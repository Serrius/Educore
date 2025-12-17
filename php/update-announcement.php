<?php
// php/update-announcement.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors','1'); 
error_reporting(E_ALL);
session_start();

try {
    require __DIR__.'/database.php';
    if (!isset($pdo)) throw new Exception('Database not available.');

    if (empty($_SESSION['id_number'])) {
        http_response_code(401);
        echo json_encode(['success'=>false,'message'=>'Not authenticated']);
        exit;
    }

    $actorIdNumber = $_SESSION['id_number'];
    $actorRole     = strtolower((string)($_SESSION['role'] ?? ''));
    $actorDept     = strtoupper(trim($_SESSION['department'] ?? ''));

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        echo json_encode(['success'=>false,'message'=>'Method not allowed']);
        exit;
    }

    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(['success'=>false,'message'=>'Invalid announcement ID']);
        exit;
    }

    // ============================================================
    // 1) Load existing announcement
    // ============================================================
    $st = $pdo->prepare("SELECT * FROM announcements WHERE id = ? LIMIT 1");
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);

    if (!$row) {
        http_response_code(404);
        echo json_encode(['success'=>false,'message'=>'Announcement not found']);
        exit;
    }

    // ============================================================
    // 2) Permission rule:
    //    - Authors can edit their own
    //    - Super-admin can edit all
    // ============================================================
    $isAuthor     = ($row['author_id'] === $actorIdNumber);
    $isSuperAdmin = ($actorRole === 'super-admin');

    if (!$isAuthor && !$isSuperAdmin) {
        http_response_code(403);
        echo json_encode(['success'=>false,'message'=>'Not allowed to edit this announcement']);
        exit;
    }

    // ============================================================
    // 3) Extract incoming fields
    // ============================================================
    $title       = trim($_POST['title'] ?? $row['title']);
    $description = trim($_POST['description'] ?? $row['description']);
    $category    = trim($_POST['category'] ?? $row['category']);

    $start_year  = ($_POST['start_year'] ?? '') !== '' ? (int)$_POST['start_year'] : (int)$row['start_year'];
    $end_year    = ($_POST['end_year']   ?? '') !== '' ? (int)$_POST['end_year']   : (int)$row['end_year'];
    $active_year = ($_POST['active_year']?? '') !== '' ? (int)$_POST['active_year']: (int)$row['active_year'];

    // ================== NEW AUDIENCE FIELDS =====================
    $audience_scope = strtolower(trim($_POST['audience_scope'] ?? $row['audience_scope']));
    $course_abbr    = strtoupper(trim($_POST['course_abbr'] ?? $row['course_abbr']));

    // Validate audience_scope
    if (!in_array($audience_scope, ['general','course'], true)) {
        $audience_scope = 'general';
    }

    // If audience_scope = general → course_abbr must be null
    if ($audience_scope === 'general') {
        $course_abbr = null;
    }

    // If audience_scope = course → course_abbr required
    if ($audience_scope === 'course') {
        if (!$course_abbr) {
            http_response_code(400);
            echo json_encode(['success'=>false,'message'=>'course_abbr is required for audience_scope=course']);
            exit;
        }

        // If NOT super-admin → enforce "stay within their course"
        if (!$isSuperAdmin && $actorDept !== $course_abbr) {
            http_response_code(403);
            echo json_encode([
                'success'=>false,
                'message'=>'Admins can only target their own course: '.$actorDept
            ]);
            exit;
        }
    }

    // Validation
    if ($title === '' || $description === '' || $category === '') {
        http_response_code(400);
        echo json_encode(['success'=>false,'message'=>'Missing required fields']);
        exit;
    }

    // Fix active_year
    if (!in_array($active_year, [$start_year, $end_year], true)) {
        $active_year = $start_year;
    }

    // ============================================================
    // 4) Handle image upload
    // ============================================================
    $finalImagePath = $row['image_path'];

    if (!empty($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
        $allowed = ['image/jpeg','image/png','image/webp'];
        if (!in_array($_FILES['image']['type'], $allowed, true)) {
            http_response_code(400);
            echo json_encode(['success'=>false,'message'=>'Invalid image type']);
            exit;
        }

        $ext = pathinfo($_FILES['image']['name'], PATHINFO_EXTENSION);
        $dir = __DIR__.'/../uploads/announcements';
        if (!is_dir($dir)) mkdir($dir,0755,true);

        $filename = uniqid('ann_',true).'.'.$ext;
        $dest     = $dir.'/'.$filename;

        if (!move_uploaded_file($_FILES['image']['tmp_name'],$dest)) {
            http_response_code(500);
            echo json_encode(['success'=>false,'message'=>'Failed to save image']);
            exit;
        }

        if (!empty($row['image_path'])) {
            @unlink(__DIR__.'/../'.$row['image_path']);
        }

        $finalImagePath = 'uploads/announcements/'.$filename;
    }

    // ============================================================
    // 5) Super-admin may change STATUS
    // ============================================================
    $incomingStatus = trim($_POST['status'] ?? '');
    $status = $row['status'];

    if ($isSuperAdmin && $incomingStatus !== '') {
        $allowedStatuses = ['Active','Pending','Rejected','Unlisted'];
        if (in_array($incomingStatus,$allowedStatuses,true)) {
            $status = $incomingStatus;
        }
    }

    // ============================================================
    // 6) UPDATE query
    // ============================================================
    $sql = "
        UPDATE announcements
           SET title          = :title,
               description    = :description,
               category       = :category,
               image_path     = :img,
               start_year     = :sy,
               end_year       = :ey,
               active_year    = :ay,
               audience_scope = :aud_scope,
               course_abbr    = :course_abbr,
               status         = :status,
               updated_at     = NOW()
         WHERE id = :id
    ";

    $upd = $pdo->prepare($sql);
    $upd->execute([
        ':title'        => $title,
        ':description'  => $description,
        ':category'     => $category,
        ':img'          => $finalImagePath,
        ':sy'           => $start_year,
        ':ey'           => $end_year,
        ':ay'           => $active_year,
        ':aud_scope'    => $audience_scope,
        ':course_abbr'  => $course_abbr,
        ':status'       => $status,
        ':id'           => $id
    ]);

    echo json_encode(['success'=>true,'message'=>'Announcement updated']);
    exit;

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success'=>false,'message'=>$e->getMessage()]);
    exit;
}
