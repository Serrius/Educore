<?php
// php/get-payment-details.php
header('Content-Type: application/json');
session_start();

try {
    require __DIR__ . '/database.php';
    
    if (empty($_SESSION['id_number'])) {
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);
        exit;
    }

    $currentUser = $_SESSION['id_number'];
    $userDept = isset($_SESSION['department']) ? strtoupper(trim($_SESSION['department'])) : '';
    $paymentId = isset($_GET['id']) ? (int)$_GET['id'] : 0;

    // Get payment details if paymentId is provided
    $paymentDetails = null;
    if ($paymentId > 0) {
        $paymentQuery = $pdo->prepare("
            SELECT p.*, o.name as org_name, o.abbreviation as org_abbr, f.title as fee_title
            FROM organization_fee_payments p
            JOIN organization_fees f ON f.id = p.org_fee_id
            JOIN organizations o ON o.id = p.org_id
            WHERE p.id = :payment_id 
            AND p.payer_id_number = :student_id
            LIMIT 1
        ");
        
        $paymentQuery->execute([
            ':payment_id' => $paymentId,
            ':student_id' => $currentUser
        ]);
        
        $paymentDetails = $paymentQuery->fetch(PDO::FETCH_ASSOC);
    }

    // Get active academic year
    $ayStmt = $pdo->query("
        SELECT start_year, end_year, active_year
        FROM academic_years
        WHERE status = 'Active'
        ORDER BY created_at DESC
        LIMIT 1
    ");
    
    $ayRow = $ayStmt->fetch(PDO::FETCH_ASSOC);
    
    $unpaidFees = [];
    if ($ayRow) {
        $start_year = (int)$ayRow['start_year'];
        $end_year = (int)$ayRow['end_year'];
        $active_year = (int)$ayRow['active_year'];

        // Build query for unpaid fees (same logic as check-unpaid-fees.php)
        $where = [];
        $params = [];

        $where[] = "f.start_year = :sy AND f.end_year = :ey AND f.active_year = :ay";
        $params[':sy'] = $start_year;
        $params[':ey'] = $end_year;
        $params[':ay'] = $active_year;

        // Visibility rules
        if ($userDept !== '') {
            $where[] = "(
                f.fee_category = 'general'
                OR (f.fee_category = 'department' AND UPPER(o.course_abbr) = :dept)
            )";
            $params[':dept'] = $userDept;
        } else {
            $where[] = "f.fee_category = 'general'";
        }

        $whereSQL = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

        // Get all fees for current user
        $sql = "
            SELECT
                f.id,
                f.org_id,
                f.fee_category,
                f.title,
                f.description,
                f.amount,
                f.currency,
                o.name AS org_name,
                o.abbreviation AS org_abbr,
                p.id AS payment_id,
                p.status AS payment_status
            FROM organization_fees f
            JOIN organizations o ON o.id = f.org_id
            LEFT JOIN organization_fee_payments p
                ON p.org_fee_id = f.id
                AND p.payer_id_number = :me
                AND p.status IN ('recorded','confirmed')
                AND p.start_year = :sy
                AND p.end_year = :ey
                AND p.active_year = :ay
            $whereSQL
            ORDER BY f.created_at DESC
        ";

        $stmt = $pdo->prepare($sql);
        $stmt->bindValue(':me', $currentUser);
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v);
        }
        $stmt->execute();

        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Find unpaid fees
        foreach ($rows as $row) {
            $isPaid = (!empty($row['payment_id']) && $row['payment_status'] !== 'void');
            
            if (!$isPaid) {
                // This fee is unpaid
                $unpaidFees[] = [
                    'id' => $row['id'],
                    'title' => $row['title'],
                    'description' => $row['description'],
                    'amount' => floatval($row['amount']),
                    'currency' => $row['currency'],
                    'org_name' => $row['org_name'],
                    'org_abbr' => $row['org_abbr'],
                    'fee_category' => $row['fee_category']
                ];
            }
        }
    }

    echo json_encode([
        'success' => true,
        'payment' => $paymentDetails,
        'unpaid_fees' => $unpaidFees,
        'active_year' => $ayRow
    ]);
    
} catch (Exception $e) {
    error_log("get-payment-details.php error: " . $e->getMessage());
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}
?>