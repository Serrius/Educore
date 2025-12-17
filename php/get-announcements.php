<?php
// php/get-announcements.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors','1'); 
error_reporting(E_ALL);
session_start();

try {
    require __DIR__.'/database.php';
    if (!isset($pdo)) throw new Exception('DB missing');

    if (empty($_SESSION['id_number'])) {
        http_response_code(401);
        echo json_encode(['success'=>false,'message'=>'Not authenticated']);
        exit;
    }

    $currentUser = $_SESSION['id_number'];

    // Normalize role
    $rawRole = trim((string)($_SESSION['role'] ?? ''));
    $normalizedRole = strtolower(str_replace([' ', '_'], '-', $rawRole));

    $isSuperAdmin =
        $normalizedRole === 'super-admin' ||
        $normalizedRole === 'superadmin' ||
        (strpos($normalizedRole,'super') !== false && strpos($normalizedRole,'admin') !== false);

    $isSpecialAdmin =
        $normalizedRole === 'special-admin' ||
        $normalizedRole === 'specialadmin' ||
        (strpos($normalizedRole,'special') !== false && strpos($normalizedRole,'admin') !== false);

    // User's department
    $department = strtoupper(trim($_SESSION['department'] ?? ''));

    // Filters
    $q           = trim((string)($_GET['q'] ?? ''));
    $status      = trim((string)($_GET['status'] ?? ''));
    $start_year  = ($_GET['start_year'] ?? '') !== '' ? (int)$_GET['start_year'] : null;
    $end_year    = ($_GET['end_year']   ?? '') !== '' ? (int)$_GET['end_year']   : null;
    $active_year = ($_GET['active_year']?? '') !== '' ? (int)$_GET['active_year']: null;

    $limit  = max(1, min(200, (int)($_GET['limit'] ?? 50)));
    $page   = max(1, (int)($_GET['page'] ?? 1));
    $offset = ($page - 1) * $limit;

    $where  = [];
    $params = [];

    // ROLE-BASED VISIBILITY
    if (!$isSuperAdmin && !$isSpecialAdmin) {
        // Non-admin users can ONLY see their own announcements
        $where[] = "a.author_id = :current_user_id";
        $params[':current_user_id'] = $currentUser;
        
        // OPTIONAL: If you want non-admins to also see general announcements, uncomment below:
        // $where[] = "(a.author_id = :current_user_id OR a.audience_scope = 'general')";
        // $params[':current_user_id'] = $currentUser;
        
        // Remove department-based visibility unless specifically required
        // $where[] = "(
        //     a.author_id = :me
        //     OR a.course_abbr = :dept
        //     OR a.audience_scope = 'general'
        // )";
        // $params[':me']   = $currentUser;
        // $params[':dept'] = $department;
    }

    // STATUS filter
    if ($status !== '' && strtolower($status) !== 'all') {
        $where[] = "a.status = :status";
        $params[':status'] = $status;
    }

    // AY filters
    if ($start_year !== null && $end_year !== null) {
        $where[] = "a.start_year = :sy AND a.end_year = :ey";
        $params[':sy'] = $start_year;
        $params[':ey'] = $end_year;
    } else {
        if ($start_year !== null) {
            $where[] = "a.start_year = :sy";
            $params[':sy'] = $start_year;
        }
        if ($end_year !== null) {
            $where[] = "a.end_year = :ey";
            $params[':ey'] = $end_year;
        }
    }

    if ($active_year !== null) {
        $where[] = "a.active_year = :ay";
        $params[':ay'] = $active_year;
    }

    // SEARCH filter
    if ($q !== '') {
        // Build full_name from columns (no full_name field in table)
        $where[] = "(
            a.title LIKE :like
            OR a.description LIKE :like
            OR CONCAT(u.first_name,' ',u.middle_name,' ',u.last_name,' ',u.suffix) LIKE :like
        )";
        $params[':like'] = "%$q%";
    }

    $whereSQL = $where ? ("WHERE " . implode(" AND ", $where)) : "";

    // COUNT
    $cntSQL = "
        SELECT COUNT(*)
          FROM announcements a
     LEFT JOIN users u ON u.id_number = a.author_id
        $whereSQL
    ";
    $cntStmt = $pdo->prepare($cntSQL);
    foreach ($params as $k=>$v) $cntStmt->bindValue($k,$v);
    $cntStmt->execute();
    $total = (int)$cntStmt->fetchColumn();

    // FETCH rows
    $sql = "
        SELECT a.id,
               a.title,
               a.description,
               a.category,
               a.audience_scope,
               a.course_abbr,
               a.image_path,
               a.status,
               a.start_year,
               a.end_year,
               a.active_year,
               a.author_id,
               a.created_at,
               a.updated_at,
               a.declined_reason,

               -- NULL-safe full name
               TRIM(CONCAT_WS(' ',
                   NULLIF(u.first_name, ''),
                   NULLIF(u.middle_name, ''),
                   NULLIF(u.last_name, ''),
                   NULLIF(u.suffix, '')
               )) AS author_name,

               u.profile_picture AS author_picture

          FROM announcements a
     LEFT JOIN users u ON u.id_number = a.author_id
        $whereSQL
      ORDER BY a.status = 'Pending' DESC,
               a.updated_at DESC,
               a.created_at DESC
         LIMIT :lim OFFSET :off
    ";

    $stmt = $pdo->prepare($sql);
    foreach ($params as $k=>$v) $stmt->bindValue($k,$v);
    $stmt->bindValue(':lim',$limit,PDO::PARAM_INT);
    $stmt->bindValue(':off',$offset,PDO::PARAM_INT);
    $stmt->execute();

    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success'=>true,
        'total'=>$total,
        'page'=>$page,
        'limit'=>$limit,
        'announcements'=>$rows,
        'debug'=>[
            'rawRole'          => $rawRole,
            'normalizedRole'   => $normalizedRole,
            'isSuperAdmin'     => $isSuperAdmin,
            'isSpecialAdmin'   => $isSpecialAdmin,
            'currentUser'      => $currentUser,
            'filterApplied'    => (!$isSuperAdmin && !$isSpecialAdmin) ? 'user_own_announcements_only' : 'no_restriction'
        ]
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'success'=>false,
        'message'=>'Server error',
        'detail'=>$e->getMessage()
    ]);
}