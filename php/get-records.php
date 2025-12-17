<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight request
if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    exit(0);
}

// Sessions for role/department restriction
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Include your existing database connection
require_once 'database.php';

try {
    // Use your existing $pdo connection
    $conn = $pdo;

    // Get filter parameters
    $start_year  = $_GET['start_year']  ?? null;
    $end_year    = $_GET['end_year']    ?? null;
    $active_year = $_GET['active_year'] ?? null;

    // Normalize active_year: treat "" or "ALL" as no filter
    if ($active_year !== null) {
        $active_year = trim($active_year);
        if ($active_year === '' || strtoupper($active_year) === 'ALL') {
            $active_year = null;
        }
    }

    // Read session-based restrictions
    $sessionRole      = strtolower(trim($_SESSION['role']      ?? ''));
    $sessionUserType  = strtolower(trim($_SESSION['user_type'] ?? ''));
    $sessionDept      = $_SESSION['department']           ?? null; // e.g. "BSIT"
    $sessionIdNumber  = $_SESSION['id_number']            ?? null; // current logged-in id

    // Role helpers
    $isTreasurer  = ($sessionRole === 'treasurer' || $sessionUserType === 'treasurer');
    // "Admin-like" means department-based admin, not super-admin
    $isAdminLike  = in_array($sessionRole, ['admin'], true)
                 || in_array($sessionUserType, ['admin'], true);
    $isSuperAdmin = ($sessionRole === 'super-admin' || $sessionUserType === 'super-admin');
    $isSpecialAdmin = ($sessionRole === 'special-admin' || $sessionUserType === 'special-admin');

    $all_records = [];
    $errors      = [];

    // ======================= Query 1: Fee Payments =======================
    try {
        $fee_query = "
            SELECT 
                p.id,
                p.paid_amount as amount,
                p.paid_on as date,
                p.status,
                p.payer_id_number,
                p.receipt_no,
                p.payment_method,
                u.first_name,
                u.middle_name,
                u.last_name,
                u.suffix,
                CONCAT(
                    u.first_name, ' ',
                    IFNULL(u.middle_name, ''), ' ',
                    u.last_name,
                    IF(u.suffix IS NOT NULL, CONCAT(' ', u.suffix), '')
                ) as full_name,
                f.title as description,
                f.start_year,
                f.end_year,
                f.active_year,
                o.name as organization_name,
                o.abbreviation as organization_abbr,
                'fee' as record_type,
                p.notes,
                NULL as event_id,
                NULL as event_name
            FROM organization_fee_payments p
            JOIN organization_fees f ON p.org_fee_id = f.id
            JOIN organizations o     ON p.org_id = o.id
            LEFT JOIN users u        ON p.payer_id_number = u.id_number
            WHERE 1=1
        ";

        $params = [];

        // Academic year filters
        if ($start_year) {
            $fee_query .= " AND (f.start_year = :start_year OR p.start_year = :start_year)";
            $params[':start_year'] = $start_year;
        }
        if ($end_year) {
            $fee_query .= " AND (f.end_year = :end_year OR p.end_year = :end_year)";
            $params[':end_year'] = $end_year;
        }
        if ($active_year) {
            $fee_query .= " AND (f.active_year = :active_year OR p.active_year = :active_year)";
            $params[':active_year'] = $active_year;
        }

        // ---------- Role-based restriction ----------
        // SUPER-ADMIN: no restriction (can see everything)
        if (!$isSuperAdmin && !$isSpecialAdmin && !empty($sessionIdNumber) ) {
            if ($isTreasurer) {
                // Treasurer: show only fees where they are the treasurer
                $fee_query .= "
                    AND f.treasurer_id_number = :treasurerId
                ";
                $params[':treasurerId'] = $sessionIdNumber;
            } elseif ($isAdminLike && !empty($sessionDept)) {
                // Admin-like (department admins): original logic
                //  - EXCLUSIVE orgs: must match department
                //  - GENERAL orgs: department doesn't matter
                //  - Admin must handle the org (admin_id_number or authors_id_number)
                $fee_query .= "
                    AND (
                        (
                            o.scope = 'exclusive'
                            AND o.course_abbr = :dept
                        )
                        OR (
                            o.scope = 'general'
                        )
                    )
                    AND (
                        o.admin_id_number      = :adminId
                        OR o.authors_id_number = :adminId
                    )
                ";
                $params[':dept']    = $sessionDept;
                $params[':adminId'] = $sessionIdNumber;
            }
            // other roles (non-admin, non-treasurer) fall through with no extra filter
        }

        $stmt = $conn->prepare($fee_query);
        foreach ($params as $key => $value) {
            $stmt->bindValue($key, $value);
        }

        $stmt->execute();
        $fee_records = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $all_records = array_merge($all_records, $fee_records);

    } catch (Exception $e) {
        $errors[] = "Fee payments query failed: " . $e->getMessage();
    }

    // ======================= Query 2: Event Credits ======================
    try {
        $credit_query = "
            SELECT 
                c.id,
                c.amount,
                c.credit_date as date,
                'confirmed' as status,
                c.source as description,
                c.notes,
                e.start_year,
                e.end_year,
                e.active_year,
                o.name as organization_name,
                o.abbreviation as organization_abbr,
                'credit' as record_type,
                NULL as payer_id_number,
                NULL as receipt_no,
                NULL as payment_method,
                NULL as first_name,
                NULL as middle_name,
                NULL as last_name,
                NULL as suffix,
                NULL as full_name,
                e.id as event_id,
                e.title as event_name
            FROM event_credits c
            JOIN event_events e ON c.event_id = e.id
            LEFT JOIN organizations o ON e.organization_abbr = o.abbreviation
            WHERE 1=1
        ";

        $params = [];

        // Academic year filters
        if ($start_year) {
            $credit_query .= " AND e.start_year = :start_year";
            $params[':start_year'] = $start_year;
        }
        if ($end_year) {
            $credit_query .= " AND e.end_year = :end_year";
            $params[':end_year'] = $end_year;
        }
        if ($active_year) {
            $credit_query .= " AND e.active_year = :active_year";
            $params[':active_year'] = $active_year;
        }

        // ---------- Role-based restriction ----------
        if (!$isSuperAdmin && !$isSpecialAdmin && !empty($sessionIdNumber)) {
            if ($isTreasurer) {
                // Treasurer:
                // Show credits for events that belong to organizations
                // where this user is the treasurer of ANY fee (no year lock)
                $credit_query .= "
                    AND EXISTS (
                        SELECT 1
                        FROM organizations oo
                        JOIN organization_fees ff
                          ON ff.org_id = oo.id
                        WHERE oo.abbreviation = e.organization_abbr
                          AND ff.treasurer_id_number = :treasurerId
                    )
                ";
                $params[':treasurerId'] = $sessionIdNumber;
            } elseif ($isAdminLike && !empty($sessionDept)) {
                // Admin-like (department admins): original department/admin logic
                $credit_query .= "
                    AND (
                        (
                            o.id IS NOT NULL
                            AND (
                                (o.scope = 'exclusive' AND o.course_abbr = :dept)
                                OR (o.scope = 'general')
                            )
                            AND (
                                o.admin_id_number      = :adminId
                                OR o.authors_id_number = :adminId
                            )
                        )
                        OR (
                            o.id IS NULL
                            AND e.author_id_number = :adminId
                        )
                    )
                ";
                $params[':dept']    = $sessionDept;
                $params[':adminId'] = $sessionIdNumber;
            }
        }

        $stmt = $conn->prepare($credit_query);
        foreach ($params as $key => $value) {
            $stmt->bindValue($key, $value);
        }

        $stmt->execute();
        $credit_records = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $all_records = array_merge($all_records, $credit_records);

    } catch (Exception $e) {
        $errors[] = "Event credits query failed: " . $e->getMessage();
    }

    // ======================= Query 3: Event Debits =======================
    try {
        $debit_query = "
            SELECT 
                d.id,
                d.amount,
                d.debit_date as date,
                'confirmed' as status,
                d.category as description,
                d.notes,
                e.start_year,
                e.end_year,
                e.active_year,
                o.name as organization_name,
                o.abbreviation as organization_abbr,
                'debit' as record_type,
                NULL as payer_id_number,
                NULL as receipt_no,
                NULL as payment_method,
                NULL as first_name,
                NULL as middle_name,
                NULL as last_name,
                NULL as suffix,
                NULL as full_name,
                e.id as event_id,
                e.title as event_name
            FROM event_debits d
            JOIN event_events e ON d.event_id = e.id
            LEFT JOIN organizations o ON e.organization_abbr = o.abbreviation
            WHERE 1=1
        ";

        $params = [];

        // Academic year filters
        if ($start_year) {
            $debit_query .= " AND e.start_year = :start_year";
            $params[':start_year'] = $start_year;
        }
        if ($end_year) {
            $debit_query .= " AND e.end_year = :end_year";
            $params[':end_year'] = $end_year;
        }
        if ($active_year) {
            $debit_query .= " AND e.active_year = :active_year";
            $params[':active_year'] = $active_year;
        }

        // ---------- Role-based restriction ----------
        if (!$isSuperAdmin && !$isSpecialAdmin && !empty($sessionIdNumber)) {
            if ($isTreasurer) {
                // Treasurer:
                // Show debits for events that belong to organizations
                // where this user is the treasurer of ANY fee (no year lock)
                $debit_query .= "
                    AND EXISTS (
                        SELECT 1
                        FROM organizations oo
                        JOIN organization_fees ff
                          ON ff.org_id = oo.id
                        WHERE oo.abbreviation = e.organization_abbr
                          AND ff.treasurer_id_number = :treasurerId
                    )
                ";
                $params[':treasurerId'] = $sessionIdNumber;
            } elseif ($isAdminLike && !empty($sessionDept)) {
                // Admin-like (department admins): original department/admin logic
                $debit_query .= "
                    AND (
                        (
                            o.id IS NOT NULL
                            AND (
                                (o.scope = 'exclusive' AND o.course_abbr = :dept)
                                OR (o.scope = 'general')
                            )
                            AND (
                                o.admin_id_number      = :adminId
                                OR o.authors_id_number = :adminId
                            )
                        )
                        OR (
                            o.id IS NULL
                            AND e.author_id_number = :adminId
                        )
                    )
                ";
                $params[':dept']    = $sessionDept;
                $params[':adminId'] = $sessionIdNumber;
            }
        }

        $stmt = $conn->prepare($debit_query);
        foreach ($params as $key => $value) {
            $stmt->bindValue($key, $value);
        }

        $stmt->execute();
        $debit_records = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $all_records = array_merge($all_records, $debit_records);

    } catch (Exception $e) {
        $errors[] = "Event debits query failed: " . $e->getMessage();
    }

    // ======================= Final sort & response =======================
    // Sort all records by date (newest first)
    usort($all_records, function ($a, $b) {
        return strtotime($b['date']) - strtotime($a['date']);
    });

    $response = [
        'success'              => true,
        'records'              => $all_records,
        'count'                => count($all_records),
        'limited_by_dept'      => $isAdminLike && !empty($sessionDept),
        'limited_by_treasurer' => $isTreasurer,
        'current_department'   => $sessionDept,
    ];

    // Include warnings if any queries failed
    if (!empty($errors)) {
        $response['warnings'] = $errors;
    }

    echo json_encode($response);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Error fetching records: ' . $e->getMessage(),
        'records' => []
    ]);
}
?>
