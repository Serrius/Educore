<?php
// php/get-users.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors','1');
error_reporting(E_ALL);
session_start();

try {
    require __DIR__ . '/database.php';
    if (!isset($pdo)) {
        throw new Exception('Database connection not available.');
    }

    // ===== basic auth: require logged-in user & admin-like role =====
    if (empty($_SESSION['id_number'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);
        exit;
    }

    $rawRole  = trim((string)($_SESSION['role'] ?? ''));
    $normRole = strtolower(str_replace([' ', '_'], '-', $rawRole));
    $allowedRoles = ['admin', 'super-admin', 'special-admin', 'treasurer'];

    if (!in_array($normRole, $allowedRoles, true)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Access denied.']);
        exit;
    }

    // ===== read filters from GET =====
    $userTypeParam = strtolower(trim((string)($_GET['user_type'] ?? ''))); // 'student' | 'staff'
    $statusParam   = strtolower(trim((string)($_GET['status'] ?? '')));    // 'active','inactive','archived','all'
    $roleParam     = strtolower(trim((string)($_GET['role'] ?? '')));      // 'admin','non-admin','treasurer', etc.
    $scope         = strtolower(trim((string)($_GET['scope'] ?? '')));     // 'pending','active','manage','admin','archived'
    $department    = trim((string)($_GET['department'] ?? ''));            // optional filter
    $q             = trim((string)($_GET['q'] ?? ''));                     // search

    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 200;
    $limit = max(1, min(500, $limit));
    $page  = isset($_GET['page']) ? (int)$_GET['page'] : 1;
    $page  = max(1, $page);
    $offset = ($page - 1) * $limit;

    $where  = [];
    $params = [];

    // Always alias table as u
    // ---- always exclude super-admin and special-admin from results ----
    $where[] = "u.role NOT IN ('super-admin', 'special-admin')";

    // ===== apply scope shortcuts (used by your JS) =====
    // scope usually decides user_type + status behavior
    switch ($scope) {
        case 'pending':
            // Pending students = user_type=student, Inactive, not Archived
            $where[] = "u.user_type = 'student'";
            $where[] = "u.status = 'Inactive'";
            $where[] = "u.status <> 'Archived'";
            break;

        case 'active':
            // Active students = user_type=student, Active, not Archived
            $where[] = "u.user_type = 'student'";
            $where[] = "u.status = 'Active'";
            $where[] = "u.status <> 'Archived'";
            break;

        case 'manage':
            // Manage students = user_type=student, any status except Archived
            $where[] = "u.user_type = 'student'";
            $where[] = "u.status <> 'Archived'";
            break;

        case 'admin':
            // Manage admins/staff = user_type=staff, role in admin-like
            $where[] = "u.user_type = 'staff'";
            // (super-admin & special-admin already excluded above)
            $where[] = "u.role IN ('admin', 'treasurer')";
            $where[] = "u.status <> 'Archived'";
            break;

        case 'archived':
            // Explicit view for archived users (if ever needed)
            $where[] = "u.status = 'Archived'";
            break;

        default:
            // no special scope; we'll use explicit filters below
            break;
    }

    // ===== explicit user_type filter (overrides nothing, just narrows) =====
    if ($userTypeParam !== '') {
        if (in_array($userTypeParam, ['student','staff'], true)) {
            $where[] = "u.user_type = :user_type";
            $params[':user_type'] = $userTypeParam;
        }
    }

    // ===== explicit role filter (for manage-admin table, etc.) =====
    if ($roleParam !== '') {
        // normalize to enum form
        $roleNorm = str_replace([' ', '_'], '-', $roleParam);
        // already globally excluding super-admin & special-admin
        if (!in_array($roleNorm, ['super-admin','special-admin'], true)) {
            $where[] = "u.role = :role";
            $params[':role'] = $roleNorm;
        }
    }

    // ===== explicit status filter only when scope is NOT enforcing it =====
    $scopeHandledStatuses = ['pending','active','manage','admin','archived'];
    if (!in_array($scope, $scopeHandledStatuses, true)) {
        if ($statusParam !== '' && $statusParam !== 'all') {
            $statusNorm = ucfirst(strtolower($statusParam)); // active -> Active
            if (in_array($statusNorm, ['Active','Inactive','Archived'], true)) {
                $where[] = "u.status = :status";
                $params[':status'] = $statusNorm;
            }
        }
    }

    // ===== department filter (optional) =====
    if ($department !== '') {
        $where[] = "u.department = :dept";
        $params[':dept'] = $department;
    }

    // ===== search (id, id_number, name, email, department, school_year) =====
    if ($q !== '') {
        $where[] = "(
            u.id_number LIKE :q
            OR u.email LIKE :q
            OR u.department LIKE :q
            OR u.school_year LIKE :q
            OR CONCAT_WS(' ', u.first_name, u.middle_name, u.last_name, u.suffix) LIKE :q
        )";
        $params[':q'] = '%' . $q . '%';
    }

    $whereSQL = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

    // ===== COUNT for pagination =====
    $cntSql = "SELECT COUNT(*) FROM users u {$whereSQL}";
    $cntStmt = $pdo->prepare($cntSql);
    foreach ($params as $k => $v) {
        $cntStmt->bindValue($k, $v);
    }
    $cntStmt->execute();
    $total = (int)$cntStmt->fetchColumn();

    // ===== FETCH rows =====
    $sql = "
        SELECT
            u.id,
            u.id_number,
            u.first_name,
            u.middle_name,
            u.last_name,
            u.suffix,
            u.user_type,
            u.role,
            u.department,
            u.status,
            u.profile_picture,
            u.email,
            u.school_year,
            u.year,
            u.created_at
        FROM users u
        {$whereSQL}
        ORDER BY u.id DESC
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

    // Safety: if any old row still has 'Unlisted', expose it as 'Archived' to JS
    foreach ($rows as &$r) {
        if (isset($r['status']) && $r['status'] === 'Unlisted') {
            $r['status'] = 'Archived';
        }
    }
    unset($r);

    echo json_encode([
        'success' => true,
        'total'   => $total,
        'page'    => $page,
        'limit'   => $limit,
        'users'   => $rows,
        'debug'   => [
            'scope'      => $scope,
            'user_type'  => $userTypeParam,
            'status'     => $statusParam,
            'role'       => $roleParam,
            'excludeRoles' => ['super-admin','special-admin'],
        ],
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Server error',
        'detail'  => $e->getMessage(),
    ]);
}
