<?php
// php/student-homestats.php
// Dashboard summary for student home

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
session_start();

// Helper function for date formatting
function formatDateForDisplay($dateString) {
    if (!$dateString) return 'Not specified';
    $date = new DateTime($dateString);
    return $date->format('M d, Y');
}

try {
    require __DIR__ . '/database.php';

    if (!isset($pdo)) {
        throw new RuntimeException('DB connection not available');
    }

    // --- Auth: require a logged-in student ---
    if (empty($_SESSION['id_number']) || empty($_SESSION['role'])) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'error'   => 'Not authenticated.',
        ]);
        exit;
    }

    $role = strtolower((string)$_SESSION['role']);
    $studentId = trim((string)$_SESSION['id_number']);
    $courseAbbr = trim((string)($_SESSION['course_abbr'] ?? ''));
    $userDept = isset($_SESSION['department']) ? strtoupper(trim($_SESSION['department'])) : '';
    $yearLevel = (int)($_SESSION['year_level'] ?? 1);

    if ($role !== 'non-admin') {
        http_response_code(403);
        echo json_encode([
            'success' => false,
            'error'   => 'Access denied. Student only.',
        ]);
        exit;
    }

    // --- Get current academic year ---
    $stmt = $pdo->query(
        "SELECT start_year, end_year, active_year
         FROM academic_years
         WHERE status = 'Active'
         ORDER BY id DESC
         LIMIT 1"
    );
    $ayRow = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$ayRow) {
        $stmt2 = $pdo->query(
            "SELECT start_year, end_year, active_year
             FROM academic_years
             ORDER BY id DESC
             LIMIT 1"
        );
        $ayRow = $stmt2->fetch(PDO::FETCH_ASSOC);
    }

    if (!$ayRow) {
        echo json_encode([
            'success' => false,
            'error'   => 'No academic year configured.',
        ]);
        exit;
    }

    $sy = (int)$ayRow['start_year'];
    $ey = (int)$ayRow['end_year'];
    $ay = (int)$ayRow['active_year'];
    
    // Semester label
    $semesterLabel = null;
    if ($ay === $sy) {
        $semesterLabel = '1st Semester';
    } elseif ($ay === $ey) {
        $semesterLabel = '2nd Semester';
    }

    // ============ CARD 1: ACTIVE ANNOUNCEMENTS ============
    // Count announcements visible to this student
    $announcementsSql = "
        SELECT COUNT(DISTINCT a.id) as count
        FROM announcements a
        WHERE a.status = 'Active'
          AND a.start_year = :sy
          AND a.end_year = :ey
          AND a.active_year = :ay
          AND (
            (a.audience_scope = 'general')
            OR (a.audience_scope = 'course' AND a.course_abbr = :course)
          )
    ";
    
    $stmtAnn = $pdo->prepare($announcementsSql);
    $stmtAnn->execute([
        ':sy' => $sy,
        ':ey' => $ey,
        ':ay' => $ay,
        ':course' => $courseAbbr
    ]);
    
    $activeAnnouncements = (int)$stmtAnn->fetchColumn();

    // ============ CARD 2 & 3: GET ALL APPLICABLE FEES WITH PAYMENT STATUS ============
    // CRITICAL FIX: Use the same logic as get-user-organization-fees.php
    $allFeesSql = "
        SELECT 
            f.id as fee_id,
            f.title as fee_name,
            f.description as fee_description,
            f.amount,
            f.fee_category,
            f.org_id,
            f.active_year,
            f.start_year as fee_start_year,
            f.end_year as fee_end_year,
            
            o.name as org_name,
            o.abbreviation as org_abbr,
            o.logo_path as org_logo_path,
            o.scope as org_scope,
            o.course_abbr as org_course_abbr,
            o.status as org_status,
            
            p.id as payment_id,
            p.paid_amount,
            p.paid_on,
            p.payment_method,
            p.status as payment_status,
            p.receipt_no
            
        FROM organization_fees f
        JOIN organizations o ON o.id = f.org_id
        LEFT JOIN organization_fee_payments p 
            ON p.org_fee_id = f.id 
            AND p.payer_id_number = :studentId
            AND p.active_year = f.active_year  -- Match the academic year!
            AND p.status IN ('recorded', 'confirmed')
        
        WHERE f.start_year = :sy 
          AND f.end_year = :ey 
          AND f.active_year = :ay
          AND (  -- CRITICAL FIX: Use the correct visibility rules
            f.fee_category = 'general'
            OR (f.fee_category = 'department' AND UPPER(o.course_abbr) = :dept)
          )
        ORDER BY o.name, f.title, f.active_year DESC
    ";
    
    $stmtAllFees = $pdo->prepare($allFeesSql);
    $stmtAllFees->execute([
        ':studentId' => $studentId,
        ':sy' => $sy,
        ':ey' => $ey,
        ':ay' => $ay,
        ':dept' => $userDept ?: $courseAbbr
    ]);
    
    $allFees = $stmtAllFees->fetchAll(PDO::FETCH_ASSOC);
    
    // Count unpaid and paid fees from the result
    $pendingDues = 0;
    $completedDues = 0;
    $pendingDuesDetails = [];
    $studentOrganizations = [];
    $processedOrgs = [];
    
    foreach ($allFees as $fee) {
        // Determine payment status using LEFT JOIN logic
        $isPaid = !empty($fee['payment_id']) && $fee['payment_status'] !== 'void';
        
        if ($isPaid) {
            $completedDues++;
            
            // Track organizations the student has paid fees for
            if (!in_array($fee['org_id'], $processedOrgs)) {
                $studentOrganizations[] = [
                    'id' => $fee['org_id'],
                    'name' => $fee['org_name'],
                    'abbreviation' => $fee['org_abbr'],
                    'logo_path' => $fee['org_logo_path'],
                    'scope' => $fee['org_scope'],
                    'status' => $fee['org_status'],
                    'active_year' => $fee['active_year'],
                    'course_abbr' => $fee['org_course_abbr']
                ];
                $processedOrgs[] = $fee['org_id'];
            }
        } else {
            $pendingDues++;
            
            // Collect details for pending dues (limit to 5)
            if (count($pendingDuesDetails) < 5) {
                // Calculate due date (7 days from fee creation or current date)
                $dueDate = date('Y-m-d', strtotime('+7 days'));
                $dueDateFormatted = formatDateForDisplay($dueDate);
                
                $pendingDuesDetails[] = [
                    'fee_id' => $fee['fee_id'],
                    'fee_name' => $fee['fee_name'],
                    'description' => $fee['fee_description'],
                    'amount' => $fee['amount'],
                    'fee_category' => $fee['fee_category'],
                    'org_id' => $fee['org_id'],
                    'org_name' => $fee['org_name'],
                    'org_abbr' => $fee['org_abbr'],
                    'org_logo_path' => $fee['org_logo_path'],
                    'org_course_abbr' => $fee['org_course_abbr'],
                    'formatted_amount' => '₱' . number_format((float)$fee['amount'], 2),
                    'status' => 'unpaid',
                    'receipt_no' => 'Not applicable',
                    'formatted_due_date' => $dueDateFormatted,
                    'active_year' => $fee['active_year'],
                    'academic_year' => sprintf('%d-%d', $fee['fee_start_year'], $fee['fee_end_year'])
                ];
            }
        }
    }

    // ============ RECENT ANNOUNCEMENTS FOR LIST ============
    // Get latest 5 announcements for the student
    $recentAnnouncementsSql = "
        SELECT a.id, a.title, a.description, a.category, a.audience_scope,
               a.course_abbr, a.image_path, a.created_at,
               u.first_name, u.last_name
        FROM announcements a
        LEFT JOIN users u ON a.author_id = u.id_number
        WHERE a.status = 'Active'
          AND a.start_year = :sy
          AND a.end_year = :ey
          AND a.active_year = :ay
          AND (
            (a.audience_scope = 'general')
            OR (a.audience_scope = 'course' AND a.course_abbr = :course)
          )
        ORDER BY a.created_at DESC
        LIMIT 5
    ";
    
    $stmtRecent = $pdo->prepare($recentAnnouncementsSql);
    $stmtRecent->execute([
        ':sy' => $sy,
        ':ey' => $ey,
        ':ay' => $ay,
        ':course' => $courseAbbr
    ]);
    
    $recentAnnouncements = $stmtRecent->fetchAll(PDO::FETCH_ASSOC);

    // Format dates for display
    foreach ($recentAnnouncements as &$ann) {
        $date = new DateTime($ann['created_at']);
        $ann['formatted_date'] = $date->format('M d, Y');
        $ann['formatted_time'] = $date->format('h:i A');
        $ann['author_name'] = $ann['first_name'] . ' ' . $ann['last_name'];
        // Clean up unused fields
        unset($ann['first_name'], $ann['last_name']);
    }

    // ============ RECENT PAYMENTS ============
    // Get student's recent payments (all years)
    $recentPaymentsSql = "
        SELECT p.id, p.receipt_no, p.paid_amount, p.payment_method, 
               p.paid_on, p.status,
               o.name as org_name, o.abbreviation as org_abbr,
               f.title as fee_title,
               f.active_year,
               f.start_year as fee_start_year,
               f.end_year as fee_end_year
        FROM organization_fee_payments p
        INNER JOIN organization_fees f ON p.org_fee_id = f.id
        INNER JOIN organizations o ON f.org_id = o.id
        WHERE p.payer_id_number = :studentId
          AND p.status IN ('recorded', 'confirmed')
        ORDER BY p.paid_on DESC
        LIMIT 5
    ";
    
    $stmtRecentPayments = $pdo->prepare($recentPaymentsSql);
    $stmtRecentPayments->execute([
        ':studentId' => $studentId
    ]);
    
    $recentPayments = $stmtRecentPayments->fetchAll(PDO::FETCH_ASSOC);

    // Format payment details
    foreach ($recentPayments as &$payment) {
        $date = new DateTime($payment['paid_on']);
        $payment['formatted_date'] = $date->format('M d, Y');
        $payment['formatted_time'] = $date->format('h:i A');
        $payment['formatted_amount'] = '₱' . number_format((float)$payment['paid_amount'], 2);
        $payment['formatted_method'] = ucfirst($payment['payment_method']);
        $payment['formatted_status'] = ucfirst($payment['status']);
        $payment['academic_year'] = sprintf('%d-%d', $payment['fee_start_year'], $payment['fee_end_year']);
        unset($payment['fee_start_year'], $payment['fee_end_year']);
    }

    // Get treasurer names for pending dues (if needed)
    if (!empty($pendingDuesDetails)) {
        $orgIds = array_column($pendingDuesDetails, 'org_id');
        $orgIds = array_unique($orgIds);
        if (!empty($orgIds)) {
            $placeholders = implode(',', array_fill(0, count($orgIds), '?'));
            
            $treasurerSql = "
                SELECT f.org_id, u.first_name, u.last_name, u.id_number
                FROM organization_fees f
                LEFT JOIN users u ON f.treasurer_id_number = u.id_number
                WHERE f.org_id IN ($placeholders)
                GROUP BY f.org_id
            ";
            
            $stmtTreasurer = $pdo->prepare($treasurerSql);
            $stmtTreasurer->execute($orgIds);
            $treasurers = $stmtTreasurer->fetchAll(PDO::FETCH_ASSOC);
            
            // Map treasurers to pending dues
            $treasurerMap = [];
            foreach ($treasurers as $treasurer) {
                $treasurerMap[$treasurer['org_id']] = [
                    'treasurer_name' => $treasurer['first_name'] . ' ' . $treasurer['last_name'],
                    'treasurer_id' => $treasurer['id_number']
                ];
            }
            
            // Add treasurer info to pending dues
            foreach ($pendingDuesDetails as &$dueDetail) {
                if (isset($treasurerMap[$dueDetail['org_id']])) {
                    $dueDetail['treasurer_name'] = $treasurerMap[$dueDetail['org_id']]['treasurer_name'];
                    $dueDetail['treasurer_id'] = $treasurerMap[$dueDetail['org_id']]['treasurer_id'];
                } else {
                    $dueDetail['treasurer_name'] = 'Not assigned';
                    $dueDetail['treasurer_id'] = null;
                }
            }
        }
    }

    // Final JSON response
    echo json_encode([
        'success' => true,
        'academic_year' => [
            'start_year'     => $sy,
            'end_year'       => $ey,
            'active_year'    => $ay,
            'school_year'    => sprintf('%d-%d', $sy, $ey),
            'semester_label' => $semesterLabel,
        ],
        'cards' => [
            'active_announcements' => $activeAnnouncements,
            'pending_dues'         => $pendingDues,
            'completed_dues'       => $completedDues,
        ],
        'recent_announcements'   => $recentAnnouncements,
        'pending_dues_details'   => $pendingDuesDetails,
        'student_organizations'  => array_slice($studentOrganizations, 0, 5),
        'recent_payments'        => $recentPayments,
        'student_info' => [
            'id_number'  => $studentId,
            'course'     => $courseAbbr,
            'department' => $userDept,
            'year_level' => $yearLevel
        ]
    ], JSON_PRETTY_PRINT | JSON_NUMERIC_CHECK);

} catch (Throwable $e) {
    http_response_code(500);
    error_log("Student HomeStats Error: " . $e->getMessage() . " in " . $e->getFile() . ":" . $e->getLine());
    echo json_encode([
        'success' => false,
        'error'   => 'Internal server error.',
        'details' => 'Please try again later.',
        // For debugging only - remove in production
        'debug' => [
            'message' => $e->getMessage(),
            'file' => $e->getFile(),
            'line' => $e->getLine()
        ]
    ], JSON_PRETTY_PRINT);
}