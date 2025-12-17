<?php
// php/get-user.php
header('Content-Type: application/json');

require 'database.php'; // must create $pdo (PDO)

try {
    // Prefer id, else id_number
    $id        = isset($_GET['id']) ? trim($_GET['id']) : null;
    $id_number = isset($_GET['id_number']) ? trim($_GET['id_number']) : null;

    if (($id === null || $id === '') && ($id_number === null || $id_number === '')) {
        echo json_encode(['success' => false, 'message' => 'Missing id or id_number.']);
        exit;
    }

    if ($id !== null && $id !== '') {
        // numeric check to be safe
        if (!ctype_digit($id)) {
            echo json_encode(['success' => false, 'message' => 'Invalid id.']);
            exit;
        }

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
                school_year,
                year,
                created_at
            FROM users
            WHERE id = ?
            LIMIT 1
        ");
        $stmt->execute([$id]);
    } else {
        // id_number path
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
                school_year,
                year,
                created_at
            FROM users
            WHERE id_number = ?
            LIMIT 1
        ");
        $stmt->execute([$id_number]);
    }

    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$user) {
        echo json_encode(['success' => false, 'message' => 'User not found.']);
        exit;
    }

    // Build a full_name field on the fly for backwards compatibility / display
    $parts = [];
    if (!empty($user['first_name']))  $parts[] = $user['first_name'];
    if (!empty($user['middle_name'])) $parts[] = $user['middle_name'];
    if (!empty($user['last_name']))   $parts[] = $user['last_name'];
    $full = trim(implode(' ', $parts));
    if (!empty($user['suffix'])) {
        $full = trim($full . ' ' . $user['suffix']);
    }
    $user['full_name'] = $full;

    // You probably don’t want to leak the password hash
    unset($user['password']);

    // Ensure null-safe fields with defaults
    if (empty($user['profile_picture'])) {
        $user['profile_picture'] = null; // or a default path if you prefer
    }

    echo json_encode(['success' => true, 'user' => $user]);
} catch (PDOException $e) {
    // You can log $e->getMessage() to a file if needed
    echo json_encode(['success' => false, 'message' => 'Database error.']);
}
