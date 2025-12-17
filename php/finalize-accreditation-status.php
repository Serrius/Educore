<?php
// php/finalize-accreditation-status.php
header('Content-Type: application/json');
ini_set('display_errors', 1);
error_reporting(E_ALL);
session_start();

function jerr($msg, $http = 400) {
    http_response_code($http);
    echo json_encode(['success' => false, 'message' => $msg]);
    exit;
}

try {
    require __DIR__ . "/database.php";

    if (empty($_SESSION['id_number'])) {
        jerr("Not authenticated", 401);
    }

    $actorId = $_SESSION['id_number'];
    $actorRole = $_SESSION['role'] ?? '';

    $raw = file_get_contents("php://input");
    $d = json_decode($raw, true);

    $orgId = intval($d["org_id"] ?? 0);
    $mode  = trim($d["mode"] ?? "");

    if (!$orgId) jerr("Missing organization ID.");
    if (!in_array($mode, ["accredit", "reaccredit"])) {
        jerr("Invalid mode. Use accredit or reaccredit.");
    }

    // Get organization details including admin
    $orgStmt = $pdo->prepare("
        SELECT o.id, o.name, o.abbreviation, o.admin_id_number, o.status as current_status,
               u.first_name, u.middle_name, u.last_name, u.suffix
        FROM organizations o
        LEFT JOIN users u ON u.id_number = o.admin_id_number
        WHERE o.id = :id
        LIMIT 1
    ");
    $orgStmt->execute([':id' => $orgId]);
    $organization = $orgStmt->fetch(PDO::FETCH_ASSOC);

    if (!$organization) {
        jerr("Organization not found.");
    }

    $orgName = $organization['name'];
    $orgAbbr = $organization['abbreviation'];
    $orgAdminId = $organization['admin_id_number'];
    
    // Get admin's full name if available
    $adminName = '';
    if ($organization['first_name']) {
        $adminName = $organization['first_name'];
        if ($organization['middle_name']) $adminName .= ' ' . $organization['middle_name'];
        if ($organization['last_name']) $adminName .= ' ' . $organization['last_name'];
        if ($organization['suffix']) $adminName .= ' ' . $organization['suffix'];
    }

    // Get the current active academic year
    $ay = $pdo->query("
        SELECT start_year, end_year, active_year
        FROM academic_years
        WHERE status='Active'
        ORDER BY id DESC LIMIT 1
    ")->fetch(PDO::FETCH_ASSOC);

    if (!$ay) jerr("Active academic year not found.");

    $ay_start  = (int)$ay["start_year"];
    $ay_end    = (int)$ay["end_year"];
    $ay_single = (int)$ay["active_year"];

    // ===== SEND NOTIFICATION FUNCTION =====
    function sendAccreditationNotification($pdo, $recipientId, $actorId, $title, $message, $notifType, $payloadId = null) {
        try {
            $notifStmt = $pdo->prepare("
                INSERT INTO notifications 
                (recipient_id_number, actor_id_number, title, message, notif_type, status, payload_id, created_at) 
                VALUES (:recipient, :actor, :title, :message, :notif_type, 'unread', :payload_id, NOW())
            ");
            
            $notifStmt->execute([
                ':recipient' => $recipientId,
                ':actor' => $actorId,
                ':title' => $title,
                ':message' => $message,
                ':notif_type' => $notifType,
                ':payload_id' => $payloadId
            ]);
            return true;
        } catch (PDOException $e) {
            error_log("Failed to send accreditation notification: " . $e->getMessage());
            return false;
        }
    }

    // ===== NOTIFY ALL ADMINS =====
    function notifyAllAdmins($pdo, $actorId, $orgId, $orgName, $orgAbbr, $newStatus, $mode) { // Added $orgId parameter
        try {
            // Get all admin users (admin, super-admin, special-admin)
            $adminsStmt = $pdo->prepare("
                SELECT id_number, first_name, last_name, role 
                FROM users 
                WHERE role IN ('admin', 'super-admin', 'special-admin') 
                AND status = 'Active'
                AND id_number != :actor
            ");
            $adminsStmt->execute([':actor' => $actorId]);
            $admins = $adminsStmt->fetchAll(PDO::FETCH_ASSOC);
            
            $notifiedCount = 0;
            foreach ($admins as $admin) {
                $notificationTitle = 'Organization Accreditation Completed';
                
                if ($mode === 'accredit') {
                    $notificationMessage = "Organization {$orgName} ({$orgAbbr}) has been ACCREDITED. All requirements have been met and approved.";
                } else {
                    $notificationMessage = "Organization {$orgName} ({$orgAbbr}) has been REACCREDITED. All requirements have been met and approved.";
                }
                
                sendAccreditationNotification(
                    $pdo, 
                    $admin['id_number'], 
                    $actorId, 
                    $notificationTitle, 
                    $notificationMessage, 
                    'accreditation', 
                    $orgId  // Now $orgId is accessible
                );
                $notifiedCount++;
            }
            
            return $notifiedCount;
        } catch (Exception $e) {
            error_log("Error notifying admins: " . $e->getMessage());
            return 0;
        }
    }

    // Start transaction
    $pdo->beginTransaction();

    if ($mode === "accredit") {
        // NEW Accreditation
        $stmt = $pdo->prepare("
            UPDATE organizations
            SET status = 'Accredited',
                active_year = :single,
                start_year = :sy,
                end_year = :ey
            WHERE id = :id
        ");
        $stmt->execute([
            ':single' => $ay_single,
            ':sy' => $ay_start,
            ':ey' => $ay_end,
            ':id' => $orgId
        ]);

        $newStatus = 'Accredited';
        
    } elseif ($mode === "reaccredit") {
        // RE-ACCREDITATION
        $stmt = $pdo->prepare("
            UPDATE organizations
            SET status = 'Reaccredited',
                active_year = :single,
                start_year = :sy,
                end_year = :ey
            WHERE id = :id
        ");
        $stmt->execute([
            ':single' => $ay_single,
            ':sy' => $ay_start,
            ':ey' => $ay_end,
            ':id' => $orgId
        ]);

        $newStatus = 'Reaccredited';
    }

    // ===== SEND NOTIFICATIONS =====
    
    // 1. Notify the organization admin
    if ($orgAdminId) {
        if ($mode === 'accredit') {
            $adminNotificationTitle = 'Organization Accredited';
            $adminNotificationMessage = "Congratulations! Your organization {$orgName} ({$orgAbbr}) has been ACCREDITED for AY {$ay_start}-{$ay_end}. All requirements have been approved.";
        } else {
            $adminNotificationTitle = 'Organization Reaccredited';
            $adminNotificationMessage = "Congratulations! Your organization {$orgName} ({$orgAbbr}) has been REACCREDITED for AY {$ay_start}-{$ay_end}. All requirements have been approved.";
        }
        
        sendAccreditationNotification(
            $pdo, 
            $orgAdminId, 
            $actorId, 
            $adminNotificationTitle, 
            $adminNotificationMessage, 
            'accreditation', 
            $orgId
        );
    }
    
    // 2. Notify all other admins
    $adminsNotified = notifyAllAdmins($pdo, $actorId, $orgId, $orgName, $orgAbbr, $newStatus, $mode); // Added $orgId parameter
    
    // 3. Also notify special-admin if actor is super-admin (and vice versa)
    if ($actorRole === 'super-admin') {
        // Notify special-admin about the accreditation
        $specialAdminStmt = $pdo->prepare("
            SELECT id_number FROM users 
            WHERE role = 'special-admin' 
            AND status = 'Active'
            AND id_number != :actor
            LIMIT 1
        ");
        $specialAdminStmt->execute([':actor' => $actorId]);
        $specialAdmin = $specialAdminStmt->fetch(PDO::FETCH_ASSOC);
        
        if ($specialAdmin) {
            $specialAdminTitle = 'Accreditation Finalized';
            $specialAdminMessage = "Organization {$orgName} ({$orgAbbr}) has been {$newStatus} by a super-admin.";
            sendAccreditationNotification(
                $pdo, 
                $specialAdmin['id_number'], 
                $actorId, 
                $specialAdminTitle, 
                $specialAdminMessage, 
                'accreditation', 
                $orgId
            );
        }
    } elseif ($actorRole === 'special-admin') {
        // Notify super-admin about the accreditation
        $superAdminStmt = $pdo->prepare("
            SELECT id_number FROM users 
            WHERE role = 'super-admin' 
            AND status = 'Active'
            LIMIT 1
        ");
        $superAdminStmt->execute();
        $superAdmin = $superAdminStmt->fetch(PDO::FETCH_ASSOC);
        
        if ($superAdmin) {
            $superAdminTitle = 'Accreditation Finalized';
            $superAdminMessage = "Organization {$orgName} ({$orgAbbr}) has been {$newStatus} by a special-admin.";
            sendAccreditationNotification(
                $pdo, 
                $superAdmin['id_number'], 
                $actorId, 
                $superAdminTitle, 
                $superAdminMessage, 
                'accreditation', 
                $orgId
            );
        }
    }

    $pdo->commit();

    echo json_encode([
        'success' => true,
        'new_status' => $newStatus,
        'organization' => [
            'id' => $orgId,
            'name' => $orgName,
            'abbreviation' => $orgAbbr
        ],
        'academic_year' => [
            'start' => $ay_start,
            'end' => $ay_end,
            'active' => $ay_single
        ],
        'notifications_sent' => [
            'to_admin' => $orgAdminId ? true : false,
            'to_admins' => $adminsNotified,
            'mode' => $mode
        ],
        'message' => "Organization {$newStatus} successfully. Notifications have been sent."
    ]);
    exit;
}
catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    jerr($e->getMessage(), 500);
}