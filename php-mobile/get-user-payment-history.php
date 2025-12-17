<?php
// php/get-user-payment-history.php
header('Content-Type: application/json; charset=utf-8');
session_start();
ini_set('display_errors', 1);
error_reporting(E_ALL);

try {
    require __DIR__ . '/database.php';

    if (!isset($pdo)) {
        throw new Exception('DB connection not available.');
    }

    // Must be logged in
    if (empty($_SESSION['id_number'])) {
        http_response_code(401);
        echo json_encode([
            'success' => false,
            'message' => 'Not authenticated',
        ]);
        exit;
    }

    $currentUser = $_SESSION['id_number'];

    // Optional filters from GET
    $startYear  = isset($_GET['start_year']) && $_GET['start_year'] !== '' ? (int)$_GET['start_year'] : null;
    $endYear    = isset($_GET['end_year'])   && $_GET['end_year']   !== '' ? (int)$_GET['end_year']   : null;
    $activeYear = isset($_GET['active_year'])&& $_GET['active_year']!== '' ? (int)$_GET['active_year']: null;

    // If any AY part is missing, fallback to currently active academic year
    if ($startYear === null || $endYear === null || $activeYear === null) {
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

        if ($startYear === null)  $startYear  = (int)$ayRow['start_year'];
        if ($endYear === null)    $endYear    = (int)$ayRow['end_year'];
        if ($activeYear === null) $activeYear = (int)$ayRow['active_year'];
    }

    // Status filter: "paid" / "unpaid" / "all"
    $statusParam = isset($_GET['status']) ? strtolower(trim($_GET['status'])) : 'all';
    $statusWhere = '';
    if ($statusParam === 'paid') {
        // Only confirmed payments
        $statusWhere = " AND p.status = 'confirmed' ";
    } elseif ($statusParam === 'unpaid') {
        // Only recorded (pending) payments
        $statusWhere = " AND p.status = 'recorded' ";
    } else {
        // Default: show both confirmed + recorded (hide void)
        $statusWhere = " AND p.status IN ('recorded','confirmed') ";
    }

    // Search text
    $q = trim((string)($_GET['q'] ?? ''));

    // Base query
    $sql = "
        SELECT
            p.id,
            p.receipt_no,
            p.paid_amount,
            p.active_year,
            p.start_year AS school_year_start,
            p.end_year   AS school_year_end,
            p.paid_on,
            p.payment_method,
            p.notes,

            -- Normalize status for the front-end badges
            CASE p.status
                WHEN 'confirmed' THEN 'confirmed'
                WHEN 'recorded'  THEN 'pending'
                WHEN 'void'      THEN 'cancelled'
                ELSE p.status
            END AS status,

            f.title      AS fee_title,
            f.currency   AS currency,

            o.name         AS org_name,
            o.abbreviation AS org_abbreviation,
            o.course_abbr,
            o.logo_path    AS org_logo_path,

            -- payer full name
            CONCAT_WS(' ',
                u.first_name,
                NULLIF(u.middle_name, ''),
                u.last_name,
                NULLIF(u.suffix, '')
            ) AS full_name
        FROM organization_fee_payments p
        INNER JOIN organization_fees f
            ON f.id = p.org_fee_id
        INNER JOIN organizations o
            ON o.id = p.org_id
        LEFT JOIN users u
            ON u.id_number = p.payer_id_number
        WHERE p.payer_id_number = :id_number
          AND p.start_year  = :start_year
          AND p.end_year    = :end_year
          AND p.active_year = :active_year
    ";

    $params = [
        ':id_number'   => $currentUser,
        ':start_year'  => $startYear,
        ':end_year'    => $endYear,
        ':active_year' => $activeYear,
    ];

    // Status filter
    $sql .= $statusWhere;

    // Search filter
    if ($q !== '') {
        $sql .= "
            AND (
                p.receipt_no      LIKE :q
                OR f.title        LIKE :q
                OR o.name         LIKE :q
                OR o.abbreviation LIKE :q
            )
        ";
        $params[':q'] = '%' . $q . '%';
    }

    // Sort latest payments first
    $sql .= " ORDER BY p.paid_on DESC, p.id DESC ";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success'  => true,
        'payments' => $rows,
        'filters'  => [
            'start_year'  => $startYear,
            'end_year'    => $endYear,
            'active_year' => $activeYear,
            'status'      => $statusParam,
        ],
    ]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Failed to fetch payment history.',
        'error'   => $e->getMessage(),
    ]);
}
