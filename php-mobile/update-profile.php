<?php
// php/update-profile.php
session_start();
require_once 'database.php';

// ========== CORS HEADERS FOR MOBILE APP ==========
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Headers: Content-Type, Cookie, Authorization, X-Requested-With');
header('Content-Type: application/json');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// ========== SESSION HANDLING FOR MOBILE ==========
// Check session from cookie if not in session
if (!isset($_SESSION['id'])) {
    if (isset($_COOKIE['PHPSESSID'])) {
        session_id($_COOKIE['PHPSESSID']);
        session_start();
    }
}

// Check if user is logged in
if (!isset($_SESSION['id'])) {
    echo json_encode([
        'success' => false, 
        'message' => 'Not authenticated. Session expired.',
        'requires_login' => true
    ]);
    exit;
}

$response = [
    'success' => false, 
    'message' => '', 
    'profile_picture' => '', 
    'email' => '',
    'debug' => []
];

try {
    $userId = $_SESSION['id'];
    $idNumber = $_SESSION['id_number'];
    
    // Debug info
    $response['debug']['session_id'] = session_id();
    $response['debug']['user_id'] = $userId;
    $response['debug']['id_number'] = $idNumber;
    
    // Get current user data first for comparison - include department and school_year
    $stmt = $pdo->prepare("SELECT profile_picture, email, department, school_year FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $currentUser = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$currentUser) {
        throw new Exception('User not found in database');
    }
    
    $currentProfilePicture = $currentUser['profile_picture'];
    $currentEmail = $currentUser['email'];
    $currentDepartment = $currentUser['department'];
    $currentSchoolYear = $currentUser['school_year'];
    
    $newProfilePicture = $currentProfilePicture;
    $newEmail = $currentEmail;
    $newDepartment = $currentDepartment;
    $newSchoolYear = $currentSchoolYear;
    $hasChanges = false;
    
    // Log received data for debugging
    $response['debug']['received_files'] = !empty($_FILES) ? array_keys($_FILES) : 'No files';
    $response['debug']['received_post'] = $_POST;
    
    // Handle profile picture upload
    if (isset($_FILES['profile_picture']) && $_FILES['profile_picture']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['profile_picture'];
        
        // Validate file
        $allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        $maxSize = 5 * 1024 * 1024; // 5MB (increased for mobile)
        
        // Check file type using file extension and MIME type
        $fileExt = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        $allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        
        if (!in_array($fileExt, $allowedExtensions)) {
            throw new Exception('Invalid file type. Only JPG, PNG, GIF, and WebP images are allowed.');
        }
        
        // Check MIME type
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mimeType = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);
        
        if (!in_array($mimeType, ['image/jpeg', 'image/png', 'image/gif', 'image/webp'])) {
            throw new Exception('Invalid file MIME type.');
        }
        
        // Check file size
        if ($file['size'] > $maxSize) {
            throw new Exception('File size must be less than 5MB.');
        }
        
        // Verify it's actually an image
        $imageInfo = @getimagesize($file['tmp_name']);
        if (!$imageInfo) {
            throw new Exception('Uploaded file is not a valid image.');
        }
        
        // Check image dimensions (optional)
        $maxWidth = 3000;
        $maxHeight = 3000;
        if ($imageInfo[0] > $maxWidth || $imageInfo[1] > $maxHeight) {
            throw new Exception("Image dimensions too large. Maximum allowed: {$maxWidth}x{$maxHeight}px");
        }
        
        // Create upload directory if it doesn't exist
        $uploadDir = '../uploads/profile_pictures/';
        
        if (!file_exists($uploadDir)) {
            if (!mkdir($uploadDir, 0755, true)) {
                throw new Exception('Could not create upload directory.');
            }
        }
        
        // Generate secure filename
        $safeFilename = preg_replace('/[^a-zA-Z0-9]/', '_', $idNumber);
        $timestamp = time();
        $randomBytes = bin2hex(random_bytes(4));
        $filename = 'mobile_profile_' . $safeFilename . '_' . $timestamp . '_' . $randomBytes . '.' . $fileExt;
        $filePath = $uploadDir . $filename;
        
        // Move uploaded file
        if (!move_uploaded_file($file['tmp_name'], $filePath)) {
            if (!is_writable($uploadDir)) {
                throw new Exception('Upload directory is not writable. Check permissions.');
            }
            throw new Exception('Failed to move uploaded file. Check server permissions.');
        }
        
        // Verify the file was saved
        if (!file_exists($filePath)) {
            throw new Exception('File upload failed - file not found after move.');
        }
        
        // Path to store in database (relative to root)
        $dbFilePath = 'uploads/profile_pictures/' . $filename;
        
        // Convert to full URL for mobile app
        $protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https://' : 'http://';
        $host = $_SERVER['HTTP_HOST'];
        $baseUrl = $protocol . $host . dirname(dirname($_SERVER['SCRIPT_NAME']));
        $fullImageUrl = $baseUrl . '/' . ltrim($dbFilePath, '/');
        
        // Delete old profile picture if it exists and is not the default
        if ($currentProfilePicture && 
            !empty($currentProfilePicture) &&
            $currentProfilePicture !== 'assets/images/profile.png') {
            
            // Extract filename from full URL if needed
            $oldPath = $currentProfilePicture;
            if (filter_var($oldPath, FILTER_VALIDATE_URL)) {
                $oldPath = parse_url($oldPath, PHP_URL_PATH);
                $oldPath = ltrim($oldPath, '/');
            }
            
            $oldFilePath = '../' . $oldPath;
            
            if (file_exists($oldFilePath) && is_writable($oldFilePath)) {
                // Check if this file is being used by other users
                $checkStmt = $pdo->prepare("SELECT COUNT(*) as count FROM users WHERE profile_picture LIKE ? AND id != ?");
                $checkStmt->execute(['%' . basename($oldPath) . '%', $userId]);
                $usageCount = $checkStmt->fetch(PDO::FETCH_ASSOC)['count'];
                
                if ($usageCount == 0) {
                    if (!unlink($oldFilePath)) {
                        error_log("Warning: Could not delete old profile picture: " . $oldFilePath);
                    }
                }
            }
        }
        
        $newProfilePicture = $fullImageUrl; // Store full URL for mobile app
        $hasChanges = true;
        
        $response['debug']['uploaded_file'] = $filename;
        $response['debug']['file_size'] = $file['size'];
        $response['debug']['file_path'] = $dbFilePath;
        $response['debug']['full_url'] = $fullImageUrl;
    }
    
    // Handle email update
    $email = isset($_POST['email']) ? filter_var(trim($_POST['email']), FILTER_SANITIZE_EMAIL) : null;
    if ($email) {
        // Validate email
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new Exception('Invalid email format.');
        }
        
        // Check if email is already taken by another user
        $emailCheckStmt = $pdo->prepare("SELECT id FROM users WHERE email = ? AND id != ?");
        $emailCheckStmt->execute([$email, $userId]);
        $existingUser = $emailCheckStmt->fetch(PDO::FETCH_ASSOC);
        
        if ($existingUser) {
            throw new Exception('This email is already registered by another user.');
        }
        
        if ($email !== $currentEmail) {
            $newEmail = $email;
            $hasChanges = true;
        }
    }
    
    // Handle other fields
    $department = isset($_POST['department']) ? trim($_POST['department']) : null;
    $school_year = isset($_POST['school_year']) ? trim($_POST['school_year']) : null;
    
    if ($department && $department !== $currentDepartment) {
        $newDepartment = $department;
        $hasChanges = true;
    }
    
    if ($school_year && $school_year !== $currentSchoolYear) {
        $newSchoolYear = $school_year;
        $hasChanges = true;
    }
    
    // Only update database if there are changes
    if ($hasChanges) {
        $updateFields = [];
        $updateParams = [];
        
        if ($newProfilePicture !== $currentProfilePicture) {
            $updateFields[] = 'profile_picture = ?';
            $updateParams[] = $newProfilePicture;
        }
        
        if ($newEmail !== $currentEmail) {
            $updateFields[] = 'email = ?';
            $updateParams[] = $newEmail;
        }
        
        if ($newDepartment !== $currentDepartment) {
            $updateFields[] = 'department = ?';
            $updateParams[] = $newDepartment;
        }
        
        if ($newSchoolYear !== $currentSchoolYear) {
            $updateFields[] = 'school_year = ?';
            $updateParams[] = $newSchoolYear;
        }
        
        if (!empty($updateFields)) {
            $updateParams[] = $userId;
            
            // REMOVED: updated_at = NOW() from the SQL query
            $sql = "UPDATE users SET " . implode(', ', $updateFields) . " WHERE id = ?";
            $stmt = $pdo->prepare($sql);
            
            if (!$stmt->execute($updateParams)) {
                $errorInfo = $stmt->errorInfo();
                throw new Exception('Failed to update database: ' . ($errorInfo[2] ?? 'Unknown error'));
            }
            
            // Update session variables
            $_SESSION['profile_picture'] = $newProfilePicture;
            $_SESSION['email'] = $newEmail;
            
            $response['success'] = true;
            $response['message'] = 'Profile updated successfully!';
            $response['profile_picture'] = $newProfilePicture;
            $response['email'] = $newEmail;
            
            // Log the update
            error_log("Mobile App: User {$idNumber} updated profile. Changes: " . implode(', ', $updateFields));
            
        } else {
            $response['message'] = 'No changes detected.';
        }
    } else {
        $response['message'] = 'No changes detected.';
    }
    
} catch (Exception $e) {
    $response['message'] = $e->getMessage();
    $response['debug']['error'] = $e->getMessage();
    error_log("Mobile Profile update error for user {$idNumber}: " . $e->getMessage());
} catch (PDOException $e) {
    $response['message'] = 'Database error. Please try again.';
    $response['debug']['pdo_error'] = $e->getMessage();
    error_log("Mobile Database error in update-profile.php: " . $e->getMessage());
}

// Remove debug info in production
// unset($response['debug']);

echo json_encode($response);
?>