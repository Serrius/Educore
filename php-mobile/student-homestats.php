<?php
// Disable error display but log them
ini_set('display_errors', 0);
ini_set('log_errors', 1);
error_reporting(E_ALL);

// Start session
session_start();

// Include database
require_once '../php/database.php';

// Set headers
header('Content-Type: application/json');
header('Cache-Control: no-cache, must-revalidate');

// Check if user is logged in
if (empty($_SESSION) || !isset($_SESSION['id_number'])) {
    if (isset($_SESSION['user_id'])) {
        $_SESSION['id_number'] = $_SESSION['user_id'];
    } else {
        echo json_encode([
            'success' => false,
            'error' => 'Not logged in',
            'message' => 'Please login first'
        ]);
        exit;
    }
}

// Get user data from session
$userId = $_SESSION['id_number'];
$userRole = $_SESSION['role'] ?? 'non-admin';
$userType = $_SESSION['user_type'] ?? 'student';
$department = $_SESSION['department'] ?? null;
$userName = $_SESSION['full_name'] ?? ($_SESSION['first_name'] . ' ' . $_SESSION['last_name']);

try {
    $response = [
        'success' => true,
        'message' => 'Dashboard data loaded successfully',
        'data' => []
    ];

    // 1. Get academic year FIRST
    $stmt = $pdo->prepare("SELECT active_year, start_year, end_year FROM academic_years WHERE status = 'Active' LIMIT 1");
    $stmt->execute();
    $academicYear = $stmt->fetch(PDO::FETCH_ASSOC);
    
    $activeYear = date('Y');
    $startYear = $activeYear;
    $endYear = $activeYear + 1;
    
    if ($academicYear) {
        $activeYear = $academicYear['active_year'];
        $startYear = $academicYear['start_year'];
        $endYear = $academicYear['end_year'];
    }

    // Set academic year in response
    $response['data']['academic_year'] = [
        'active_year' => $activeYear,
        'start_year' => $startYear,
        'end_year' => $endYear
    ];

    // 2. Set user info WITH school_year
    $response['data']['user'] = [
        'id_number' => $userId,
        'name' => $userName,
        'role' => $userRole,
        'user_type' => $userType,
        'department' => $department,
        'profile_picture' => $_SESSION['profile_picture'] ?? null,
        'email' => $_SESSION['email'] ?? null,
        'school_year' => $_SESSION['school_year'] ?? ($startYear . '-' . $endYear),
        'year_level' => $_SESSION['year_level'] ?? null
    ];

    // 3. Get organizations for student
    if ($userType === 'student' && $department) {
        // Get organizations this student can join
        $stmt = $pdo->prepare("
            SELECT id, name, abbreviation, logo_path, status, scope, admin_id_number
            FROM organizations 
            WHERE active_year = ? 
            AND status IN ('Accredited', 'Reaccredited')
            AND (scope = 'general' OR (scope = 'exclusive' AND course_abbr = ?))
            ORDER BY name
        ");
        $stmt->execute([$activeYear, $department]);
        $organizations = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        $response['data']['organizations'] = $organizations;
        $response['data']['organization_count'] = count($organizations);

        // Check if user is an admin of any organization
        $adminOrgs = array_filter($organizations, function($org) use ($userId) {
            return $org['admin_id_number'] === $userId;
        });
        $response['data']['is_org_admin'] = !empty($adminOrgs);
        $response['data']['managed_org_count'] = count($adminOrgs);

        // Get announcements
        $stmt = $pdo->prepare("
            SELECT id, title, LEFT(description, 100) as description, category, created_at, image_path
            FROM announcements 
            WHERE active_year = ? 
            AND status = 'Active'
            AND (audience_scope = 'general' OR (audience_scope = 'course' AND course_abbr = ?))
            ORDER BY created_at DESC 
            LIMIT 5
        ");
        $stmt->execute([$activeYear, $department]);
        $announcements = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        $response['data']['announcements'] = $announcements;

        // Get unpaid fees
        $stmt = $pdo->prepare("
            SELECT f.id as fee_id, f.title, f.amount, f.currency, 
                   o.name as org_name, o.abbreviation as org_abbr
            FROM organization_fees f
            JOIN organizations o ON f.org_id = o.id
            WHERE f.active_year = ?
            AND o.status IN ('Accredited', 'Reaccredited')
            AND (o.scope = 'general' OR (o.scope = 'exclusive' AND o.course_abbr = ?))
            AND NOT EXISTS (
                SELECT 1 FROM organization_fee_payments p 
                WHERE p.org_fee_id = f.id 
                AND p.payer_id_number = ?
                AND p.status = 'confirmed'
            )
            ORDER BY o.name, f.title
        ");
        $stmt->execute([$activeYear, $department, $userId]);
        $unpaidFees = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        $totalUnpaid = 0;
        foreach ($unpaidFees as $fee) {
            $totalUnpaid += (float)$fee['amount'];
        }
        
        $response['data']['unpaid_fees'] = [
            'count' => count($unpaidFees),
            'total_amount' => number_format($totalUnpaid, 2),
            'fees' => $unpaidFees
        ];

        // Get payment history
        $stmt = $pdo->prepare("
            SELECT p.id, p.paid_amount, p.payment_method, p.paid_on, 
                   p.receipt_no, p.status, f.title as fee_title, 
                   o.name as org_name, o.abbreviation as org_abbr
            FROM organization_fee_payments p
            JOIN organization_fees f ON p.org_fee_id = f.id
            JOIN organizations o ON f.org_id = o.id
            WHERE p.payer_id_number = ?
            ORDER BY p.paid_on DESC
            LIMIT 5
        ");
        $stmt->execute([$userId]);
        $paymentHistory = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        $response['data']['payment_history'] = $paymentHistory;

        // Get upcoming events
        if (!empty($organizations)) {
            $orgAbbrs = array_column($organizations, 'abbreviation');
            $placeholders = str_repeat('?,', count($orgAbbrs) - 1) . '?';
            
            $stmt = $pdo->prepare("
                SELECT id, title, location, organization_abbr, created_at
                FROM event_events
                WHERE active_year = ?
                AND organization_abbr IN ($placeholders)
                AND status = 'Approved'
                ORDER BY created_at DESC
                LIMIT 5
            ");
            $params = array_merge([$activeYear], $orgAbbrs);
            $stmt->execute($params);
            $events = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            $response['data']['upcoming_events'] = $events;
        }
        
    } elseif ($userType === 'staff') {
        // Staff-specific data
        $response['data']['user_type'] = 'staff';
        
        // Get all active announcements
        $stmt = $pdo->prepare("
            SELECT id, title, LEFT(description, 100) as description, 
                   category, created_at, image_path, author_id
            FROM announcements 
            WHERE active_year = ? 
            AND status = 'Active'
            ORDER BY created_at DESC 
            LIMIT 5
        ");
        $stmt->execute([$activeYear]);
        $announcements = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        $response['data']['announcements'] = $announcements;
        
        // Get managed organizations
        $stmt = $pdo->prepare("
            SELECT id, name, abbreviation, logo_path, status, scope
            FROM organizations 
            WHERE active_year = ?
            AND admin_id_number = ?
            ORDER BY name
        ");
        $stmt->execute([$activeYear, $userId]);
        $managedOrgs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
        $response['data']['managed_organizations'] = $managedOrgs;
    }

    // Get unread notification count
    $stmt = $pdo->prepare("SELECT COUNT(*) as count FROM notifications WHERE recipient_id_number = ? AND status = 'unread'");
    $stmt->execute([$userId]);
    $notification = $stmt->fetch(PDO::FETCH_ASSOC);
    
    $response['data']['notification_count'] = (int)$notification['count'];

    // Return successful response
    echo json_encode($response);

} catch (PDOException $e) {
    error_log("Database error in dashboard: " . $e->getMessage());
    
    echo json_encode([
        'success' => false,
        'error' => 'Database error',
        'message' => 'Unable to fetch data'
    ]);
} catch (Exception $e) {
    error_log("General error in dashboard: " . $e->getMessage());
    
    echo json_encode([
        'success' => false,
        'error' => 'Server error',
        'message' => 'An unexpected error occurred'
    ]);
}

exit;