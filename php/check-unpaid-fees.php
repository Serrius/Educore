<?php
// php/check-unpaid-fees.php
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

    // Get active academic year
    $ayStmt = $pdo->query("
        SELECT start_year, end_year, active_year
        FROM academic_years
        WHERE status = 'Active'
        ORDER BY created_at DESC
        LIMIT 1
    ");
    
    $ayRow = $ayStmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$ayRow) {
        echo json_encode(['success' => false, 'message' => 'No active academic year']);
        exit;
    }

    $start_year = (int)$ayRow['start_year'];
    $end_year = (int)$ayRow['end_year'];
    $active_year = (int)$ayRow['active_year'];

    // Build query similar to get-user-organization-fees.php
    $where = [];
    $params = [];

    // Only fees in this AY
    $where[] = "f.start_year = :sy AND f.end_year = :ey AND f.active_year = :ay";
    $params[':sy'] = $start_year;
    $params[':ey'] = $end_year;
    $params[':ay'] = $active_year;

    // Visibility rules (same as your working file)
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
    $unpaidFees = [];
    $totalAmount = 0;
    
    foreach ($rows as $row) {
        $isPaid = (!empty($row['payment_id']) && $row['payment_status'] !== 'void');
        
        if (!$isPaid) {
            // This fee is unpaid
            $unpaidFees[] = [
                'id' => $row['id'],
                'org_id' => $row['org_id'],
                'title' => $row['title'],
                'description' => $row['description'],
                'amount' => floatval($row['amount']),
                'currency' => $row['currency'],
                'fee_category' => $row['fee_category'],
                'org_name' => $row['org_name'],
                'org_abbr' => $row['org_abbr'],
                'is_paid' => false
            ];
            $totalAmount += floatval($row['amount']);
        }
    }

    echo json_encode([
        'success' => true,
        'unpaid_fees' => $unpaidFees,
        'total_amount' => $totalAmount,
        'count' => count($unpaidFees),
        'debug' => [
            'currentUser' => $currentUser,
            'userDept' => $userDept,
            'start_year' => $start_year,
            'end_year' => $end_year,
            'active_year' => $active_year
        ]
    ]);

} catch (Exception $e) {
    error_log("check-unpaid-fees.php error: " . $e->getMessage());
    echo json_encode([
        'success' => false, 
        'message' => 'Database error',
        'debug' => $e->getMessage()
    ]);
}
?>