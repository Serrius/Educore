<?php
// get-user-organization-fees.php - UPDATED TO FILTER BY ACADEMIC YEAR
header('Content-Type: application/json; charset=utf-8');
session_start();

try {
    require __DIR__ . '/database.php';

    if (empty($_SESSION['id_number'])) {
        echo json_encode([
            'success' => false,
            'message' => 'Not authenticated',
        ]);
        exit;
    }

    $studentId = $_SESSION['id_number'];
    $studentDept = isset($_SESSION['department'])
        ? strtoupper(trim($_SESSION['department']))
        : '';

    // Get academic year parameters from request
    $requestedStartYear = isset($_GET['start_year']) ? (int)$_GET['start_year'] : null;
    $requestedEndYear = isset($_GET['end_year']) ? (int)$_GET['end_year'] : null;
    $requestedActiveYear = isset($_GET['active_year']) ? (int)$_GET['active_year'] : null;

    // Determine which academic year to use
    if ($requestedStartYear && $requestedEndYear && $requestedActiveYear) {
        // Use requested academic year
        $AY_START = $requestedStartYear;
        $AY_END = $requestedEndYear;
        $AY_ACTIVE = $requestedActiveYear;
        $source = 'request';
    } else {
        // Fallback: Get active academic year from database
        $ayQuery = $pdo->query("
            SELECT start_year, end_year, active_year
            FROM academic_years
            WHERE status = 'Active'
            ORDER BY start_year DESC
            LIMIT 1
        ");
        
        $ay = $ayQuery->fetch(PDO::FETCH_ASSOC);
        
        if (!$ay) {
            echo json_encode([
                'success' => false,
                'message' => 'No active academic year found.',
            ]);
            exit;
        }
        
        $AY_START = (int)$ay['start_year'];
        $AY_END = (int)$ay['end_year'];
        $AY_ACTIVE = (int)$ay['active_year'];
        $source = 'database';
    }

    // ===== GET FEES WITH PAYMENT INFO =====
    $sql = "
        SELECT
            f.id AS fee_id,
            f.title,
            f.description,
            f.fee_category,
            f.amount,
            f.currency,
            f.start_year,
            f.end_year,
            f.active_year,
            CONCAT(f.start_year, '–', f.end_year) AS school_year,
            
            o.abbreviation,
            o.name AS org_name,
            o.logo_path,
            o.status AS org_status,
            o.course_abbr,
            
            -- Payment details
            p.id AS payment_id,
            p.receipt_no,
            p.paid_on,
            p.payment_method,
            p.status AS payment_status,
            p.paid_amount
            
        FROM organization_fees f
        INNER JOIN organizations o ON o.id = f.org_id
        
        LEFT JOIN organization_fee_payments p ON 
            p.org_fee_id = f.id 
            AND p.payer_id_number = :student_id
            AND p.start_year = f.start_year
            AND p.end_year = f.end_year
            AND p.active_year = f.active_year
            AND p.status IN ('recorded', 'confirmed')
        
        WHERE 
            f.start_year = :sy
            AND f.end_year = :ey
            AND f.active_year = :ay
            AND o.status IN ('Accredited', 'Reaccredited')
            
        ORDER BY 
            o.name ASC, 
            f.title ASC
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        ':student_id' => $studentId,
        ':sy' => $AY_START,
        ':ey' => $AY_END,
        ':ay' => $AY_ACTIVE
    ]);

    $fees = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Filter fees by department in PHP
    $filteredFees = [];
    foreach ($fees as $fee) {
        // Always include general fees
        if ($fee['fee_category'] === 'general') {
            $filteredFees[] = $fee;
        }
        // Include department fees only if student's department matches
        elseif ($fee['fee_category'] === 'department') {
            $orgCourseAbbr = strtoupper(trim($fee['course_abbr'] ?? ''));
            if ($orgCourseAbbr === $studentDept) {
                $filteredFees[] = $fee;
            }
        }
    }

    // Format the response
    $formattedFees = [];
    foreach ($filteredFees as $fee) {
        $isPaid = !empty($fee['payment_id']) && 
                 in_array($fee['payment_status'], ['recorded', 'confirmed']);
        
        $formattedFee = [
            'fee_id' => (int)$fee['fee_id'],
            'title' => $fee['title'],
            'description' => $fee['description'],
            'fee_category' => $fee['fee_category'],
            'amount' => (float)$fee['amount'],
            'currency' => $fee['currency'],
            'school_year' => $fee['school_year'],
            'academic_year' => [
                'start_year' => (int)$fee['start_year'],
                'end_year' => (int)$fee['end_year'],
                'active_year' => (int)$fee['active_year'],
            ],
            'organization' => [
                'abbreviation' => $fee['abbreviation'],
                'name' => $fee['org_name'],
                'logo_path' => $fee['logo_path'],
                'status' => $fee['org_status'],
                'course_abbr' => $fee['course_abbr']
            ],
            'is_paid' => $isPaid,
            'payment' => $isPaid ? [
                'payment_id' => (int)$fee['payment_id'],
                'receipt_no' => $fee['receipt_no'],
                'paid_on' => $fee['paid_on'],
                'payment_method' => $fee['payment_method'],
                'status' => $fee['payment_status'],
                'paid_amount' => (float)$fee['paid_amount']
            ] : null
        ];
        
        $formattedFees[] = $formattedFee;
    }

    // Count stats
    $paidCount = count(array_filter($formattedFees, fn($f) => $f['is_paid']));
    $unpaidCount = count($formattedFees) - $paidCount;

    echo json_encode([
        'success' => true,
        'data' => [
            'fees' => $formattedFees,
            'academic_year' => [
                'start_year' => $AY_START,
                'end_year' => $AY_END,
                'active_year' => $AY_ACTIVE,
                'school_year' => "{$AY_START}-{$AY_END}",
                'source' => $source
            ],
            'student_info' => [
                'id_number' => $studentId,
                'department' => $studentDept,
                'total_fees' => count($formattedFees),
                'paid_count' => $paidCount,
                'unpaid_count' => $unpaidCount
            ]
        ]
    ]);

} catch (Throwable $e) {
    http_response_code(500);
    error_log('Organization fees error: ' . $e->getMessage());
    echo json_encode([
        'success' => false,
        'message' => 'Server error while fetching organization fees.',
        'detail'  => $e->getMessage(),
    ]);
}