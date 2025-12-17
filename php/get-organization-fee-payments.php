<?php
// php/get-organization-fee-payments.php
header('Content-Type: application/json');
ini_set('display_errors','1'); 
error_reporting(E_ALL);
session_start();

function jerr($http,$msg,$extra=[]){
    http_response_code($http);
    echo json_encode(['success'=>false,'message'=>$msg]+$extra);
    exit;
}

try {
    require __DIR__.'/database.php';

    if (empty($_SESSION['id_number'])) jerr(401,'Not authenticated.');

    if (isset($pdo)) {
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    }

    // ---------- Inputs ----------
    $fee_id = (int)($_GET['org_fee_id'] ?? 0);
    $org_id = (int)($_GET['org_id'] ?? 0);

    $fee_cat_in = strtolower(trim((string)($_GET['fee_category'] ?? '')));
    $fee_cat = in_array($fee_cat_in, ['department','general'], true) ? $fee_cat_in : '';

    $ay = isset($_GET['active_year']) ? (int)$_GET['active_year'] : null;
    $sy = isset($_GET['start_year'])  ? (int)$_GET['start_year']  : null;
    $ey = isset($_GET['end_year'])    ? (int)$_GET['end_year']    : null;

    $statusIn = strtolower(trim((string)($_GET['status'] ?? 'all')));
    $q        = trim((string)($_GET['q'] ?? ''));
    $from     = trim((string)($_GET['from'] ?? ''));
    $to       = trim((string)($_GET['to'] ?? ''));

    $limit  = max(1, min(5000, (int)($_GET['limit'] ?? 1000)));
    $page   = max(1, (int)($_GET['page'] ?? 1));
    $offset = ($page - 1) * $limit;

    if ($sy!==null && $ey!==null && $ay!==null && !in_array($ay, [$sy,$ey], true)) {
        jerr(400,'active_year must equal start_year or end_year for the given span.');
    }

    // ---------- Resolution logic ----------
    $feeRow = null;

    if ($fee_id > 0) {
        $f = $pdo->prepare("
            SELECT id, org_id, fee_category, start_year, end_year, active_year
            FROM organization_fees
            WHERE id = ?
            LIMIT 1
        ");
        $f->execute([$fee_id]);
        $feeRow = $f->fetch();

        if (!$feeRow) jerr(404,'Fee not found.');

        if ($org_id <= 0) $org_id = (int)$feeRow['org_id'];
        if ($ay === null) $ay = (int)$feeRow['active_year'];
        if ($sy === null) $sy = (int)$feeRow['start_year'];
        if ($ey === null) $ey = (int)$feeRow['end_year'];
        if (!$fee_cat)   $fee_cat = (string)$feeRow['fee_category'];
    } else {
        if ($org_id <= 0 || $ay === null || $sy === null || $ey === null) {
            jerr(400,'Provide either org_fee_id OR (org_id, active_year, start_year, end_year).');
        }
    }

    // ---------- WHERE ----------
    $where  = [];
    $params = [];

    $where[]        = "p.org_id = :org";
    $params[':org'] = $org_id;

    if ($ay !== null) { $where[] = "p.active_year = :ay"; $params[':ay'] = $ay; }
    if ($sy !== null) { $where[] = "p.start_year = :sy";  $params[':sy'] = $sy; }
    if ($ey !== null) { $where[] = "p.end_year = :ey";    $params[':ey'] = $ey; }

    $joinFee = false;

    if ($fee_id > 0) {
        $where[]       = "p.org_fee_id = :fid";
        $params[':fid'] = $fee_id;
    }

    if ($fee_cat) $joinFee = true;

    $validStatuses = ['confirmed','void','recorded','all'];
    if (!in_array($statusIn, $validStatuses)) $statusIn = 'all';

    if ($statusIn !== 'all') {
        $where[]            = "p.status = :status";
        $params[':status'] = $statusIn;
    }

    if ($q !== '') {
        if (strlen($q) < 2) jerr(400,'Query too short.');
        $like = '%'.str_replace(['%','_','\\'], ['\\%','\\_','\\\\'], $q).'%';
        $where[] = "(p.payer_id_number LIKE :like ESCAPE '\\\\' OR p.receipt_no LIKE :like ESCAPE '\\\\')";
        $params[':like'] = $like;
    }

    if ($from !== '') { $where[] = "DATE(p.paid_on) >= :from"; $params[':from']=$from; }
    if ($to   !== '') { $where[] = "DATE(p.paid_on) <= :to";   $params[':to']=$to;   }

    $joinSQL = $joinFee ? "JOIN organization_fees f ON f.id = p.org_fee_id" : "";

    if ($fee_cat) {
        $where[] = "f.fee_category = :cat";
        $params[':cat'] = $fee_cat;
    }

    $whereSQL = $where ? "WHERE ".implode(" AND ", $where) : "";

    // ---------- LIST WITH NAMES (UPDATED) ----------
    $sql = "
        SELECT 
            p.*,
            CONCAT_WS(' ', u.first_name, u.middle_name, u.last_name, u.suffix) AS full_name,
            u.department AS course_abbr,
            u.school_year,
            u.year
        FROM organization_fee_payments p
        $joinSQL
        LEFT JOIN users u ON u.id_number = p.payer_id_number
        $whereSQL
        ORDER BY p.paid_on DESC, p.id DESC
        LIMIT {$limit} OFFSET {$offset}
    ";

    $stmt = $pdo->prepare($sql);
    foreach ($params as $k=>$v) $stmt->bindValue($k,$v);
    $stmt->execute();
    $payments = $stmt->fetchAll();

    // ---------- TOTAL COUNT ----------
    $countSQL = "SELECT COUNT(*) FROM organization_fee_payments p $joinSQL $whereSQL";
    $countStmt = $pdo->prepare($countSQL);
    foreach ($params as $k=>$v) $countStmt->bindValue($k,$v);
    $countStmt->execute();
    $totalRows = (int)$countStmt->fetchColumn();

    // ---------- SUMMARY (unchanged except names removed) ----------
    $baseWhere = ["p.org_id = :org", "p.status = 'confirmed'"];
    $baseParams = [':org'=>$org_id];

    if ($fee_id > 0) { $baseWhere[] = "p.org_fee_id = :fid"; $baseParams[':fid']=$fee_id; }
    if ($ay !== null) { $baseWhere[]="p.active_year = :ay"; $baseParams[':ay']=$ay; }
    if ($sy !== null) { $baseWhere[]="p.start_year = :sy";  $baseParams[':sy']=$sy; }
    if ($ey !== null) { $baseWhere[]="p.end_year = :ey";    $baseParams[':ey']=$ey; }

    $baseJoinSQL = $joinFee ? "JOIN organization_fees f ON f.id = p.org_fee_id" : "";

    if ($fee_cat) {
        $baseWhere[] = "f.fee_category = :cat";
        $baseParams[':cat']=$fee_cat;
    }

    $baseWhereSQL = "WHERE ".implode(" AND ",$baseWhere);

    // KPI counters
    $kToday = $pdo->prepare("SELECT COUNT(*) FROM organization_fee_payments p $baseJoinSQL $baseWhereSQL AND DATE(p.paid_on)=CURDATE()");
    $kWeek  = $pdo->prepare("SELECT COUNT(*) FROM organization_fee_payments p $baseJoinSQL $baseWhereSQL AND p.paid_on>=DATE_SUB(CURDATE(), INTERVAL 7 DAY)");
    $kMonth = $pdo->prepare("SELECT COUNT(*) FROM organization_fee_payments p $baseJoinSQL $baseWhereSQL AND YEAR(p.paid_on)=YEAR(CURDATE()) AND MONTH(p.paid_on)=MONTH(CURDATE())");
    $kSem   = $pdo->prepare("SELECT COUNT(*) FROM organization_fee_payments p $baseJoinSQL $baseWhereSQL");

    foreach ([$kToday,$kWeek,$kMonth,$kSem] as $st)
        foreach ($baseParams as $k=>$v) $st->bindValue($k,$v);

    $kToday->execute(); $today = (int)$kToday->fetchColumn();
    $kWeek->execute();  $week  = (int)$kWeek->fetchColumn();
    $kMonth->execute(); $month = (int)$kMonth->fetchColumn();
    $kSem->execute();   $sem   = (int)$kSem->fetchColumn();

    // KPI totals
    $sToday=$pdo->prepare("SELECT COALESCE(SUM(p.paid_amount),0) FROM organization_fee_payments p $baseJoinSQL $baseWhereSQL AND DATE(p.paid_on)=CURDATE()");
    $sWeek =$pdo->prepare("SELECT COALESCE(SUM(p.paid_amount),0) FROM organization_fee_payments p $baseJoinSQL $baseWhereSQL AND p.paid_on>=DATE_SUB(CURDATE(), INTERVAL 7 DAY)");
    $sMonth=$pdo->prepare("SELECT COALESCE(SUM(p.paid_amount),0) FROM organization_fee_payments p $baseJoinSQL $baseWhereSQL AND YEAR(p.paid_on)=YEAR(CURDATE()) AND MONTH(p.paid_on)=MONTH(CURDATE())");
    $sSem  =$pdo->prepare("SELECT COALESCE(SUM(p.paid_amount),0) FROM organization_fee_payments p $baseJoinSQL $baseWhereSQL");

    foreach ([$sToday,$sWeek,$sMonth,$sSem] as $st)
        foreach ($baseParams as $k=>$v) $st->bindValue($k,$v);

    $sToday->execute(); $sumToday = (float)$sToday->fetchColumn();
    $sWeek->execute();  $sumWeek  = (float)$sWeek->fetchColumn();
    $sMonth->execute(); $sumMonth = (float)$sMonth->fetchColumn();
    $sSem->execute();   $sumSem   = (float)$sSem->fetchColumn();

    echo json_encode([
        'success'      => true,
        'org_fee_id'   => $fee_id ?: null,
        'org_id'       => $org_id,
        'fee_category' => $fee_cat ?: null,
        'active_year'  => $ay,
        'start_year'   => $sy,
        'end_year'     => $ey,
        'payments'     => $payments,
        'summary' => [
            'paid_today'    => $today,
            'paid_week'     => $week,
            'paid_month'    => $month,
            'paid_semester' => $sem,
            'sum_today'     => round($sumToday,2),
            'sum_week'      => round($sumWeek,2),
            'sum_month'     => round($sumMonth,2),
            'sum_semester'  => round($sumSem,2),
        ],
        'meta'=>[
            'q'      => $q !== '' ? $q : null,
            'status' => $statusIn,
            'from'   => $from ?: null,
            'to'     => $to ?: null,
            'limit'  => $limit,
            'page'   => $page,
            'total'  => $totalRows
        ]
    ]);

} catch (Throwable $e) {
    jerr(500,'Server error',['detail'=>$e->getMessage()]);
}
