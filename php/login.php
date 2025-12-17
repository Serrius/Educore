<?php
// php/login.php
header('Content-Type: application/json');

require_once 'database.php'; // provides $pdo (PDO)
session_start();

// Read JSON input (fallback to POST if needed)
$raw  = file_get_contents('php://input');
$data = json_decode($raw, true) ?: $_POST;

$username = trim($data['username'] ?? '');
$password = (string)($data['password'] ?? '');

// Basic validation
if ($username === '' || $password === '') {
    echo json_encode(['success' => false, 'message' => 'Missing username or password.']);
    exit;
}

try {
    // Updated: fetch ONLY columns that exist
    $stmt = $pdo->prepare("
        SELECT 
            id,
            id_number,
            first_name,
            middle_name,
            last_name,
            suffix,
            password,
            user_type,
            role,
            department,
            status,
            profile_picture,
            email,
            school_year
        FROM users
        WHERE id_number = ?
        LIMIT 1
    ");
    $stmt->execute([$username]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        echo json_encode(['success' => false, 'message' => 'Invalid credentials.']);
        exit;
    }

    // Check user status - block Inactive and Archived users
    $userStatus = $user['status'] ?? '';
    if (in_array($userStatus, ['Inactive', 'Archived'])) {
        echo json_encode([
            'success' => false, 
            'message' => 'Your account is ' . strtolower($userStatus) . '. Please contact the administrator.'
        ]);
        exit;
    }

    $stored = (string)($user['password'] ?? '');
    $verified = false;
    $migrated = false;

    // 1) password_* modern hashing
    $info = password_get_info($stored);
    if (!empty($stored) && $info['algo'] !== 0) {
        if (password_verify($password, $stored)) {
            $verified = true;

            // Rehash if needed
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
        echo json_encode(['success' => false, 'message' => 'Invalid credentials.']);
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

    // Regenerate session id
    session_regenerate_id(true);

    // Store session fields
    $_SESSION['id']              = (int)$user['id'];
    $_SESSION['id_number']       = $user['id_number'];
    $_SESSION['first_name']      = $user['first_name'];
    $_SESSION['middle_name']     = $user['middle_name'];
    $_SESSION['last_name']       = $user['last_name'];
    $_SESSION['suffix']          = $user['suffix'];
    $_SESSION['full_name']       = $full_name;
    $_SESSION['role']            = $user['role'];
    $_SESSION['user_type']       = $user['user_type'];
    $_SESSION['email']           = $user['email'];
    $_SESSION['department']      = $user['department'];
    $_SESSION['school_year']     = $user['school_year'];
    $_SESSION['status']          = $user['status'];
    $_SESSION['profile_picture'] = $user['profile_picture'];

    echo json_encode([
        'success'         => true,
        'session_id'      => session_id(),
        'id'              => (int)$user['id'],
        'id_number'       => $user['id_number'],
        'first_name'      => $user['first_name'],
        'middle_name'     => $user['middle_name'],
        'last_name'       => $user['last_name'],
        'suffix'          => $user['suffix'],
        'full_name'       => $full_name,
        'role'            => $user['role'],
        'user_type'       => $user['user_type'],
        'email'           => $user['email'],
        'department'      => $user['department'],
        'school_year'     => $user['school_year'],
        'status'          => $user['status'],
        'profile_picture' => $user['profile_picture'],
        'migrated'        => $migrated
    ]);

} catch (PDOException $e) {
    echo json_encode(['success' => false, 'message' => 'Database error.']);
}