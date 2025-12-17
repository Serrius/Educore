<?php
// php/get-announcements-user.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors', '1');
error_reporting(E_ALL);
session_start();

try {
    require __DIR__ . '/database.php';
    if (!isset($pdo)) {
        throw new Exception('DB connection not available');
    }

    // Must be logged in
    if (empty($_SESSION['id_number'])) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'message' => 'Not authenticated'
        ]);
        exit;
    }

    $currentUser = $_SESSION['id_number'];

    // ===== Resolve DEPARTMENT (SESSION-BASED ONLY) =====
    // Uses the department stored during login.php
    $department = '';
    if (!empty($_SESSION['department'])) {
        $department = strtoupper(trim($_SESSION['department']));
    }

    // ----- Filters from GET (search only, AY handled client-side) -----
    $q = trim((string)($_GET['q'] ?? ''));

    $limit  = max(1, min(200, (int)($_GET['limit'] ?? 100)));
    $page   = max(1, (int)($_GET['page'] ?? 1));
    $offset = ($page - 1) * $limit;

    $where  = [];
    $params = [];

    // ===================== Get ACTIVE academic year =====================
    $ayStmt = $pdo->query("
        SELECT start_year, end_year, active_year
        FROM academic_years
        WHERE status = 'Active'
        ORDER BY id DESC
        LIMIT 1
    ");
    $ay = $ayStmt->fetch(PDO::FETCH_ASSOC);

    if (!$ay) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'No active academic year configured.'
        ]);
        exit;
    }

    $AY_START  = (int)$ay['start_year'];
    $AY_END    = (int)$ay['end_year'];
    $AY_ACTIVE = (int)$ay['active_year'];

    // ===== Only ACTIVE announcements =====
    $where[] = "a.status = 'Active'";

    // ===== Must belong to ACTIVE academic year =====
    $where[] = "a.start_year = :sy";
    $where[] = "a.end_year = :ey";
    $where[] = "a.active_year = :ay";

    $params[':sy'] = $AY_START;
    $params[':ey'] = $AY_END;
    $params[':ay'] = $AY_ACTIVE;

    // ===== Audience rules for USERS =====
    // Show:
    //   - general (for current academic year)
    //   - course & course_abbr = department (if we know department, for current academic year)
    if ($department !== '') {
        $where[] = "(
            a.audience_scope = 'general'
            OR (a.audience_scope = 'course' AND UPPER(a.course_abbr) = :dept)
        )";
        $params[':dept'] = $department;
    } else {
        // No department info → show only general
        $where[] = "a.audience_scope = 'general'";
    }

    // ===== SEARCH filter =====
    if ($q !== '') {
        $where[] = "(
            a.title LIKE :like
            OR a.description LIKE :like
            OR CONCAT(u.first_name,' ',u.middle_name,' ',u.last_name,' ',u.suffix) LIKE :like
        )";
        $params[':like'] = '%' . $q . '%';
    }

    $whereSQL = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

    // Debug logging
    error_log("Web System Announcements Query:");
    error_log("User: $currentUser, Department: $department");
    error_log("Active AY: $AY_START-$AY_END (Active Year: $AY_ACTIVE)");

    // ===== COUNT =====
    $cntSQL = "
        SELECT COUNT(*)
          FROM announcements a
     LEFT JOIN users u ON u.id_number = a.author_id
        $whereSQL
    ";
    $cntStmt = $pdo->prepare($cntSQL);
    foreach ($params as $k => $v) {
        $cntStmt->bindValue($k, $v);
    }
    $cntStmt->execute();
    $total = (int)$cntStmt->fetchColumn();

    // ===== FETCH rows =====
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

               TRIM(CONCAT_WS(' ',
                   NULLIF(u.first_name, ''),
                   NULLIF(u.middle_name, ''),
                   NULLIF(u.last_name, ''),
                   NULLIF(u.suffix, '')
               )) AS author_name,

               u.profile_picture AS author_picture,

               CASE
                   WHEN a.created_at >= (NOW() - INTERVAL 3 DAY) THEN 1
                   ELSE 0
               END AS is_new

          FROM announcements a
     LEFT JOIN users u ON u.id_number = a.author_id
        $whereSQL
      ORDER BY a.created_at DESC, a.id DESC
         LIMIT :lim OFFSET :off
    ";

    $stmt = $pdo->prepare($sql);
    foreach ($params as $k => $v) {
        $stmt->bindValue($k, $v);
    }
    $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':off', $offset, PDO::PARAM_INT);
    $stmt->execute();

    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Debug: Log results
    error_log("Found $total announcements for user $currentUser");
    foreach ($rows as $index => $row) {
        error_log("Row $index: ID={$row['id']}, Title='{$row['title']}', Scope={$row['audience_scope']}, Course={$row['course_abbr']}");
    }

    echo json_encode([
        'success'       => true,
        'total'         => $total,
        'page'          => $page,
        'limit'         => $limit,
        'announcements' => $rows,
        'active_ay'     => [
            'start_year'  => $AY_START,
            'end_year'    => $AY_END,
            'active_year' => $AY_ACTIVE,
            'school_year' => "$AY_START-$AY_END",
        ],
        'debug'         => [
            'session_department' => $_SESSION['department'] ?? null,
            'used_department'    => $department,
            'currentUser'        => $currentUser,
            'academic_year'      => "$AY_START-$AY_END"
        ],
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    http_response_code(500);
    error_log("Web System Announcements Error: " . $e->getMessage());
    echo json_encode([
        'success' => false,
        'message' => 'Server error',
        'detail'  => $e->getMessage()
    ]);
}