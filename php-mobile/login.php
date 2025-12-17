<?php
// php/login.php - Mobile optimized version
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

session_start();

require_once 'database.php'; // provides $pdo (PDO)

// Read JSON input (fallback to POST if needed)
$raw  = file_get_contents('php://input');
$data = json_decode($raw, true) ?: $_POST;

$username = trim($data['username'] ?? '');
$password = (string)($data['password'] ?? '');

// Basic validation
if ($username === '' || $password === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Missing username or password.']);
    exit;
}

try {
    // Fetch user with additional student info if available
    $stmt = $pdo->prepare("
        SELECT 
            u.id,
            u.id_number,
            u.first_name,
            u.middle_name,
            u.last_name,
            u.suffix,
            u.password,
            u.user_type,
            u.role,
            u.department,
            u.status,
            u.profile_picture,
            u.email,
            u.school_year,
            u.phone,
            u.address,
            u.created_at,
            s.year_level,
            s.course_abbr as student_course_abbr,
            s.department as student_department
        FROM users u
        LEFT JOIN students s ON u.id_number = s.id_number
        WHERE u.id_number = ? 
        LIMIT 1
    ");
    $stmt->execute([$username]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid credentials.']);
        exit;
    }

    // Verify password
    $stored = (string)($user['password'] ?? '');
    $verified = false;
    $migrated = false;

    // 1) Password verification (modern bcrypt)
    $info = password_get_info($stored);
    if (!empty($stored) && $info['algo'] !== 0) {
        if (password_verify($password, $stored)) {
            $verified = true;

            // Rehash password if necessary
            if (password_needs_rehash($stored, PASSWORD_DEFAULT)) {
                $newHash = password_hash($password, PASSWORD_DEFAULT);
                $upd = $pdo->prepare("UPDATE users SET password = ? WHERE id = ?");
                $upd->execute([$newHash, (int)$user['id']]);
            }
        }
    }

    // 2) Legacy MD5 fallback
    if (!$verified) {
        $looksLikeMD5 = (strlen($stored) === 32 && ctype_xdigit($stored));
        if ($looksLikeMD5 && hash_equals($stored, md5($password))) {
            $verified = true;

            // Migrate to bcrypt
            $newHash = password_hash($password, PASSWORD_DEFAULT);
            $upd = $pdo->prepare("UPDATE users SET password = ? WHERE id = ?");
            $upd->execute([$newHash, (int)$user['id']]);
            $migrated = true;
        }
    }

    if (!$verified) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid credentials.']);
        exit;
    }

    // Check user status
    if ($user['status'] !== 'active') {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Account is not active.']);
        exit;
    }

    // Check user role and block admin/super-admin from logging in via mobile app
    $allowedRoles = ['non-admin', 'student', 'treasurer'];
    if (!in_array($user['role'], $allowedRoles)) {
        http_response_code(403);
        echo json_encode([
            'success' => false, 
            'message' => 'This role cannot log in through this app. Please use the web portal.'
        ]);
        exit;
    }

    // Build readable full name
    $full_name = trim(
        ($user['first_name'] ?? '') . ' ' . 
        ($user['middle_name'] ?? '') . ' ' . 
        ($user['last_name'] ?? '') . ' ' . 
        ($user['suffix'] ?? '')
    );
    $full_name = preg_replace('/\s+/', ' ', $full_name);

    // Use student data if available, fall back to user data
    $courseAbbr = $user['student_course_abbr'] ?? $user['department'] ?? '';
    $department = $user['student_department'] ?? $user['department'] ?? '';
    $yearLevel = $user['year_level'] ?? 1;

    // Regenerate session ID for security
    session_regenerate_id(true);

    // ============ CRITICAL: Store ALL session data needed for dashboard ============
    $_SESSION['id'] = (int)$user['id'];
    $_SESSION['id_number'] = $user['id_number'];
    $_SESSION['first_name'] = $user['first_name'];
    $_SESSION['middle_name'] = $user['middle_name'];
    $_SESSION['last_name'] = $user['last_name'];
    $_SESSION['suffix'] = $user['suffix'];
    $_SESSION['full_name'] = $full_name;
    $_SESSION['role'] = $user['role'];
    $_SESSION['user_type'] = $user['user_type'];
    $_SESSION['email'] = $user['email'];
    $_SESSION['department'] = $department;
    $_SESSION['course_abbr'] = $courseAbbr; // This is CRITICAL for dashboard
    $_SESSION['school_year'] = $user['school_year'];
    $_SESSION['status'] = $user['status'];
    $_SESSION['profile_picture'] = $user['profile_picture'];
    $_SESSION['year_level'] = $yearLevel; // This is CRITICAL for dashboard
    $_SESSION['phone'] = $user['phone'];
    $_SESSION['address'] = $user['address'];
    $_SESSION['created_at'] = $user['created_at'];
    $_SESSION['last_login'] = date('Y-m-d H:i:s');

    // Log session data for debugging
    error_log("Login successful - Session data stored for user: " . $user['id_number']);
    error_log("Session ID: " . session_id());
    error_log("Session role: " . $user['role']);
    error_log("Session course_abbr: " . $courseAbbr);
    error_log("Session year_level: " . $yearLevel);

    // Return user details as JSON with ALL necessary data
    $response = [
        'success' => true,
        'session_id' => session_id(),
        'user' => [
            'id' => (int)$user['id'],
            'id_number' => $user['id_number'],
            'first_name' => $user['first_name'],
            'middle_name' => $user['middle_name'],
            'last_name' => $user['last_name'],
            'suffix' => $user['suffix'],
            'full_name' => $full_name,
            'role' => $user['role'],
            'user_type' => $user['user_type'],
            'email' => $user['email'],
            'department' => $department,
            'course_abbr' => $courseAbbr, // Added this
            'school_year' => $user['school_year'],
            'status' => $user['status'],
            'profile_picture' => $user['profile_picture'],
            'phone' => $user['phone'],
            'address' => $user['address'],
            'year_level' => $yearLevel, // Added this
            'created_at' => $user['created_at']
        ],
        'migrated' => $migrated,
        'session_info' => [
            'session_id' => session_id(),
            'role' => $user['role'],
            'course_abbr_set' => !empty($courseAbbr),
            'year_level_set' => !empty($yearLevel)
        ]
    ];
    
    // Get current academic year for dashboard
    $ayStmt = $pdo->query("
        SELECT start_year, end_year, active_year, status
        FROM academic_years
        WHERE status = 'Active'
        ORDER BY id DESC
        LIMIT 1
    ");
    $academicYear = $ayStmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$academicYear) {
        $ayStmt2 = $pdo->query("
            SELECT start_year, end_year, active_year, status
            FROM academic_years
            ORDER BY id DESC
            LIMIT 1
        ");
        $academicYear = $ayStmt2->fetch(PDO::FETCH_ASSOC);
    }

    // Add academic year info if available
    if ($academicYear) {
        $response['academic_year'] = [
            'start_year' => (int)$academicYear['start_year'],
            'end_year' => (int)$academicYear['end_year'],
            'active_year' => (int)$academicYear['active_year'],
            'status' => $academicYear['status'],
            'school_year' => sprintf('%d-%d', $academicYear['start_year'], $academicYear['end_year'])
        ];
    }
    
    echo json_encode($response, JSON_PRETTY_PRINT | JSON_NUMERIC_CHECK);
    
} catch (PDOException $e) {
    http_response_code(500);
    error_log("Login Error: " . $e->getMessage());
    echo json_encode([
        'success' => false, 
        'message' => 'Database error. Please try again later.',
        'debug' => $e->getMessage() // Remove in production
    ]);
} catch (Exception $e) {
    http_response_code(500);
    error_log("Login Error: " . $e->getMessage());
    echo json_encode([
        'success' => false, 
        'message' => 'An error occurred. Please try again.'
    ]);
}