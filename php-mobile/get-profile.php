<?php
// php/get-profile.php
session_start();
require_once 'database.php';

// ========== CORS HEADERS FOR MOBILE APP ==========
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Headers: Content-Type, Cookie, Authorization');
header('Content-Type: application/json');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// ========== SESSION HANDLING FOR MOBILE ==========
// Check session from cookie if not in session
if (!isset($_SESSION['id_number'])) {
    // Try to get session from cookie (mobile apps send cookies)
    if (isset($_COOKIE['PHPSESSID'])) {
        session_id($_COOKIE['PHPSESSID']);
        session_start();
    }
    
    // Also check Authorization header for token-based auth (optional)
    $headers = getallheaders();
    if (isset($headers['Authorization'])) {
        // You could implement token-based auth here
    }
}

// Check if user is logged in
if (!isset($_SESSION['id_number'])) {
    echo json_encode([
        'success' => false, 
        'message' => 'Not authenticated. Please login again.',
        'session_id' => session_id()
    ]);
    exit;
}

try {
    $idNumber = $_SESSION['id_number'];
    
    $stmt = $pdo->prepare("
        SELECT 
            id,
            id_number,
            first_name,
            middle_name,
            last_name,
            suffix,
            email,
            user_type,
            role,
            department,
            school_year,
            status,
            profile_picture,
            created_at
        FROM users 
        WHERE id_number = ?
    ");
    $stmt->execute([$idNumber]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$user) {
        echo json_encode([
            'success' => false, 
            'message' => 'User not found in database'
        ]);
        exit;
    }
    
    // Ensure profile picture has a default and full URL
    if (empty($user['profile_picture'])) {
        $user['profile_picture'] = 'assets/images/profile.png';
    }
    
    // Convert relative path to full URL if needed
    if (!empty($user['profile_picture']) && !filter_var($user['profile_picture'], FILTER_VALIDATE_URL)) {
        $protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https://' : 'http://';
        $host = $_SERVER['HTTP_HOST'];
        $baseUrl = $protocol . $host . dirname(dirname($_SERVER['SCRIPT_NAME']));
        $user['profile_picture'] = $baseUrl . '/' . ltrim($user['profile_picture'], '/');
    }
    
    // Calculate account age
    $createdAt = new DateTime($user['created_at']);
    $now = new DateTime();
    $interval = $createdAt->diff($now);
    
    $user['account_age'] = [
        'years' => $interval->y,
        'months' => $interval->m,
        'days' => $interval->d
    ];
    
    // Add session info for debugging
    $debugInfo = [
        'session_id' => session_id(),
        'session_active' => true,
        'user_id' => $_SESSION['id'] ?? null,
        'id_number' => $_SESSION['id_number'] ?? null
    ];
    
    echo json_encode([
        'success' => true,
        'user' => $user,
        'debug' => $debugInfo // Remove this in production
    ]);
    
} catch (PDOException $e) {
    error_log("Database error in get-profile.php: " . $e->getMessage());
    echo json_encode([
        'success' => false, 
        'message' => 'Database error. Please try again later.',
        'error' => $e->getMessage()
    ]);
} catch (Exception $e) {
    error_log("General error in get-profile.php: " . $e->getMessage());
    echo json_encode([
        'success' => false, 
        'message' => 'An error occurred. Please try again.'
    ]);
}
?>