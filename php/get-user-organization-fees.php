<?php
// php/get-user-organization-fees.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors', '1');
error_reporting(E_ALL);
session_start();

try {
    require __DIR__ . '/database.php';
    if (!isset($pdo)) {
        throw new Exception('DB connection not available');
    }

    // Must be logged in
    if (empty($_SESSION['id_number'])) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'message' => 'Not authenticated'
        ]);
        exit;
    }

    $currentUser = $_SESSION['id_number'];
    $userDept    = isset($_SESSION['department']) ? strtoupper(trim($_SESSION['department'])) : '';

    // === AY params (optional, fallback to active academic_years) ===
    $start_year  = isset($_GET['start_year']) && $_GET['start_year'] !== '' ? (int)$_GET['start_year'] : null;
    $end_year    = isset($_GET['end_year'])   && $_GET['end_year']   !== '' ? (int)$_GET['end_year']   : null;
    $active_year = isset($_GET['active_year'])&& $_GET['active_year']!== '' ? (int)$_GET['active_year']: null;

    if ($start_year === null || $end_year === null || $active_year === null) {
        // Fallback: use currently active academic year
        $ayStmt = $pdo->query("
            SELECT start_year, end_year, active_year
              FROM academic_years
             WHERE status = 'Active'
             ORDER BY created_at DESC
             LIMIT 1
        ");
        $ayRow = $ayStmt->fetch(PDO::FETCH_ASSOC);
        if (!$ayRow) {
            throw new Exception('No active academic year configured.');
        }

        if ($start_year === null)  $start_year  = (int)$ayRow['start_year'];
        if ($end_year === null)    $end_year    = (int)$ayRow['end_year'];
        if ($active_year === null) $active_year = (int)$ayRow['active_year'];
    }

    // Search text
    $q = trim((string)($_GET['q'] ?? ''));

    $limit  = max(1, min(200, (int)($_GET['limit'] ?? 100)));
    $page   = max(1, (int)($_GET['page'] ?? 1));
    $offset = ($page - 1) * $limit;

    $where  = [];
    $params = [];

    // Only fees in this AY + semester
    $where[] = "f.start_year = :sy AND f.end_year = :ey AND f.active_year = :ay";
    $params[':sy'] = $start_year;
    $params[':ey'] = $end_year;
    $params[':ay'] = $active_year;

    // Visibility rules:
    // - general fees: everyone can see
    // - department fees: only if org.course_abbr matches user's department
    if ($userDept !== '') {
        $where[] = "(
            f.fee_category = 'general'
            OR (f.fee_category = 'department' AND UPPER(o.course_abbr) = :dept)
        )";
        $params[':dept'] = $userDept;
    } else {
        $where[] = "f.fee_category = 'general'";
    }

    // Search filter
    if ($q !== '') {
        $where[] = "(
            f.title LIKE :like
            OR f.description LIKE :like
            OR o.name LIKE :like
            OR o.abbreviation LIKE :like
        )";
        $params[':like'] = '%' . $q . '%';
    }

    $whereSQL = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

    // COUNT
    $cntSQL = "
        SELECT COUNT(*)
          FROM organization_fees f
          JOIN organizations o ON o.id = f.org_id
     LEFT JOIN organization_fee_payments p
            ON p.org_fee_id = f.id
           AND p.payer_id_number = :me
           AND p.status IN ('recorded','confirmed')
        $whereSQL
    ";
    $cntStmt = $pdo->prepare($cntSQL);
    $cntStmt->bindValue(':me', $currentUser);
    foreach ($params as $k => $v) {
        $cntStmt->bindValue($k, $v);
    }
    $cntStmt->execute();
    $total = (int)$cntStmt->fetchColumn();

    // FETCH rows
    $sql = "
        SELECT
            f.id,
            f.org_id,
            f.fee_category,
            f.title,
            f.description,
            f.amount,
            f.currency,
            f.start_year,
            f.end_year,
            f.active_year,
            f.treasurer_id_number,
            f.created_by,
            f.created_at,
            f.updated_at,

            o.name AS org_name,
            o.abbreviation AS org_abbr,
            o.logo_path AS org_logo_path,
            o.course_abbr AS org_course_abbr,

            p.id AS payment_id,
            p.receipt_no,
            p.paid_amount,
            p.paid_on,
            p.payment_method,
            p.notes AS payment_notes,
            p.status AS payment_status
          FROM organization_fees f
          JOIN organizations o ON o.id = f.org_id
     LEFT JOIN organization_fee_payments p
            ON p.org_fee_id = f.id
           AND p.payer_id_number = :me
           AND p.status IN ('recorded','confirmed')
        $whereSQL
      ORDER BY f.created_at DESC, f.id DESC
         LIMIT :lim OFFSET :off
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->bindValue(':me', $currentUser);
    foreach ($params as $k => $v) {
        $stmt->bindValue($k, $v);
    }
    $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':off', $offset, PDO::PARAM_INT);
    $stmt->execute();

    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Compute convenient flags
    $fees = [];
    foreach ($rows as $row) {
        $isPaid = false;
        $paymentLabel = 'Unpaid';

        if (!empty($row['payment_id']) && $row['payment_status'] !== 'void') {
            $isPaid = true;
            $paymentLabel = 'Paid';
        }

        $row['is_paid'] = $isPaid;
        $row['payment_label'] = $paymentLabel;
        $row['school_year_text'] = $row['start_year'] . ' - ' . $row['end_year'];

        $fees[] = $row;
    }

    echo json_encode([
        'success' => true,
        'total'   => $total,
        'page'    => $page,
        'limit'   => $limit,
        'start_year'  => $start_year,
        'end_year'    => $end_year,
        'active_year' => $active_year,
        'fees'    => $fees,
        'debug'   => [
            'currentUser'  => $currentUser,
            'userDept'     => $userDept,
        ],
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Server error',
        'detail'  => $e->getMessage()
    ]);
}
