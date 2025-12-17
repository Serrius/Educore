<?php
// php/upload-profile.php
session_start();
require_once 'database.php';

header('Content-Type: application/json');

// Check if user is logged in
if (!isset($_SESSION['id'])) {
    echo json_encode(['success' => false, 'message' => 'Not authenticated']);
    exit;
}

$response = ['success' => false, 'message' => '', 'profile_picture' => '', 'email' => ''];

try {
    $userId = $_SESSION['id'];
    $idNumber = $_SESSION['id_number'];
    
    // Get current user data first for comparison
    $stmt = $pdo->prepare("SELECT profile_picture, email FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $currentUser = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$currentUser) {
        throw new Exception('User not found');
    }
    
    $currentProfilePicture = $currentUser['profile_picture'];
    $currentEmail = $currentUser['email'];
    
    $newProfilePicture = $currentProfilePicture;
    $newEmail = $currentEmail;
    $hasChanges = false;
    
    // Handle profile picture upload
    if (isset($_FILES['profile_picture']) && $_FILES['profile_picture']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['profile_picture'];
        
        // Validate file
        $allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        $maxSize = 2 * 1024 * 1024; // 2MB
        
        // Check file type
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mimeType = $finfo->file($file['tmp_name']);
        
        if (!in_array($mimeType, ['image/jpeg', 'image/png', 'image/gif', 'image/webp'])) {
            throw new Exception('Invalid file type. Only JPG, PNG, GIF, and WebP images are allowed.');
        }
        
        // Check file size
        if ($file['size'] > $maxSize) {
            throw new Exception('File size must be less than 2MB.');
        }
        
        // Verify it's actually an image
        $imageInfo = getimagesize($file['tmp_name']);
        if (!$imageInfo) {
            throw new Exception('Uploaded file is not a valid image.');
        }
        
        // Check image dimensions (optional, for security)
        $maxWidth = 2000;
        $maxHeight = 2000;
        if ($imageInfo[0] > $maxWidth || $imageInfo[1] > $maxHeight) {
            throw new Exception("Image dimensions too large. Maximum allowed: {$maxWidth}x{$maxHeight}px");
        }
        
        // Create upload directory if it doesn't exist - go up one level from php/ to root
        $uploadDir = '../uploads/profile_picture/';
        
        // Check if directory exists, create if not
        if (!file_exists($uploadDir)) {
            if (!mkdir($uploadDir, 0755, true)) {
                throw new Exception('Could not create upload directory.');
            }
        }
        
        // Generate secure filename
        $fileExt = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
        $safeFilename = preg_replace('/[^a-zA-Z0-9]/', '_', $idNumber);
        
        // Generate unique filename with timestamp and random bytes
        $timestamp = time();
        $randomBytes = bin2hex(random_bytes(4)); // 8 characters
        $filename = 'profile_' . $safeFilename . '_' . $timestamp . '_' . $randomBytes . '.' . $fileExt;
        $filePath = $uploadDir . $filename;
        
        // Move uploaded file
        if (!move_uploaded_file($file['tmp_name'], $filePath)) {
            // Debug: check if we can write to directory
            if (!is_writable($uploadDir)) {
                throw new Exception('Upload directory is not writable. Check permissions.');
            }
            throw new Exception('Failed to move uploaded file.');
        }
        
        // Verify the file was actually saved
        if (!file_exists($filePath)) {
            throw new Exception('File upload failed - file not found after move.');
        }
        
        // Path to store in database (relative to root, not php folder)
        $dbFilePath = 'uploads/profile_picture/' . $filename;
        
        // Delete old profile picture if it exists and is not the default
        if ($currentProfilePicture && 
            !empty($currentProfilePicture) &&
            $currentProfilePicture !== 'assets/img/default-avatar.jpg') {
            
            // Construct full path to old file
            $oldFilePath = '../' . $currentProfilePicture;
            
            // Check if file exists and delete it
            if (file_exists($oldFilePath)) {
                // Check if this file is being used by other users (optional safety check)
                $checkStmt = $pdo->prepare("SELECT COUNT(*) as count FROM users WHERE profile_picture = ? AND id != ?");
                $checkStmt->execute([$currentProfilePicture, $userId]);
                $usageCount = $checkStmt->fetch(PDO::FETCH_ASSOC)['count'];
                
                if ($usageCount == 0) {
                    if (!unlink($oldFilePath)) {
                        error_log("Warning: Could not delete old profile picture: " . $oldFilePath);
                    }
                }
            }
        }
        
        $newProfilePicture = $dbFilePath; // Store relative path for database
        $hasChanges = true;
        
        // Debug: log successful upload
        error_log("Profile picture uploaded successfully: " . $dbFilePath);
    }
    
    // Handle email update
    $email = filter_input(INPUT_POST, 'email', FILTER_SANITIZE_EMAIL);
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
        
        if (!empty($updateFields)) {
            $updateParams[] = $userId;
            
            $sql = "UPDATE users SET " . implode(', ', $updateFields) . " WHERE id = ?";
            $stmt = $pdo->prepare($sql);
            
            if (!$stmt->execute($updateParams)) {
                throw new Exception('Failed to update database.');
            }
            
            // Update session variables
            $_SESSION['profile_picture'] = $newProfilePicture;
            $_SESSION['email'] = $newEmail;
            
            $response['success'] = true;
            $response['message'] = 'Profile updated successfully!';
            $response['profile_picture'] = $newProfilePicture;
            $response['email'] = $newEmail;
            
            // Log the update (optional)
            $logMessage = "User {$idNumber} updated profile";
            if ($newProfilePicture !== $currentProfilePicture) {
                $logMessage .= ", changed profile picture";
            }
            if ($newEmail !== $currentEmail) {
                $logMessage .= ", changed email from {$currentEmail} to {$newEmail}";
            }
            error_log($logMessage);
            
        } else {
            $response['message'] = 'No changes detected.';
        }
    } else {
        $response['message'] = 'No changes detected.';
    }
    
} catch (Exception $e) {
    $response['message'] = $e->getMessage();
    error_log("Profile update error for user {$idNumber}: " . $e->getMessage());
} catch (PDOException $e) {
    $response['message'] = 'Database error. Please try again.';
    error_log("Database error in upload-profile.php: " . $e->getMessage());
}

echo json_encode($response);
?>