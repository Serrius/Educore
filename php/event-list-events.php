<?php
require __DIR__.'/event-expenses-util.php';

// Allow admins, super-admin, special-admin, treasurers, and non-admin roles to view
require_auth([
    'admin',
    'super-admin',
    'special-admin',
    'treasurer',
    'faculty',
    'guard',
    'student',
    'guest'
]);

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$pdo      = db();
$q        = trim($_GET['q'] ?? '');
$role     = strtolower($_SESSION['role'] ?? '');
$idNumber = $_SESSION['id_number'] ?? '';

// -------- Academic Year Filters (optional) --------
$startYear  = isset($_GET['start_year'])  && $_GET['start_year']  !== '' ? (int)$_GET['start_year']  : null;
$endYear    = isset($_GET['end_year'])    && $_GET['end_year']    !== '' ? (int)$_GET['end_year']    : null;
$activeYear = isset($_GET['active_year']) && $_GET['active_year'] !== '' ? (int)$_GET['active_year'] : null;

// ====================== BASE SELECT (credits/debits sums) ======================
$baseSelect = "
SELECT e.*,
       IFNULL(c.sum_amount,0) AS total_credits,
       IFNULL(d.sum_amount,0) AS total_debits
FROM event_events e
LEFT JOIN (
    SELECT event_id, SUM(amount) AS sum_amount
    FROM event_credits
    GROUP BY event_id
) c ON c.event_id = e.id
LEFT JOIN (
    SELECT event_id, SUM(amount) AS sum_amount
    FROM event_debits
    GROUP BY event_id
) d ON d.event_id = e.id
";

// ============================ BUILD QUERY BY ROLE ==============================
$params = [];

// ---------- SUPER-ADMIN & SPECIAL-ADMIN: can see everything ----------
if ($role === 'super-admin' || $role === 'special-admin') {

    $sql = $baseSelect . " WHERE 1=1";

    // Search
    if ($q !== '') {
        $sql .= " AND (e.title LIKE :q OR e.location LIKE :q)";
        $params[':q'] = "%{$q}%";
    }

    // AY filters on events
    if ($startYear !== null) {
        $sql .= " AND e.start_year = :esy";
        $params[':esy'] = $startYear;
    }
    if ($endYear !== null) {
        $sql .= " AND e.end_year = :eey";
        $params[':eey'] = $endYear;
    }
    if ($activeYear !== null) {
        $sql .= " AND e.active_year = :eay";
        $params[':eay'] = $activeYear;
    }

// ---------- ADMIN / TREASURER: locked to their org(s), no GENERAL scope ----------
} elseif ($role === 'admin' || $role === 'treasurer') {

    // Join organizations to tie event_events.organization_abbr → organizations.abbreviation
    $sql = $baseSelect . "
JOIN organizations o
  ON o.abbreviation = e.organization_abbr
WHERE e.scope = 'organization'
";

    // Role-specific restriction
    if ($role === 'admin') {
        // Admin: must be the org admin
        $sql .= " AND o.admin_id_number = :idnum";
        $params[':idnum'] = $idNumber;
    } elseif ($role === 'treasurer') {
        // Treasurer: must be treasurer for that org (via organization_fees)
        $sql .= " AND EXISTS (
            SELECT 1
            FROM organization_fees f
            WHERE f.org_id = o.id
              AND f.treasurer_id_number = :idnum
        )";
        $params[':idnum'] = $idNumber;
    }

    // Search
    if ($q !== '') {
        $sql .= " AND (e.title LIKE :q OR e.location LIKE :q)";
        $params[':q'] = "%{$q}%";
    }

    // AY filters on events
    if ($startYear !== null) {
        $sql .= " AND e.start_year = :esy";
        $params[':esy'] = $startYear;
    }
    if ($endYear !== null) {
        $sql .= " AND e.end_year = :eey";
        $params[':eey'] = $endYear;
    }
    if ($activeYear !== null) {
        $sql .= " AND e.active_year = :eay";
        $params[':eay'] = $activeYear;
    }

// ---------- NON-ADMIN / OTHER ROLES: allowed to view, read-only, see everything ----------
} else {

    // Treat other authenticated roles similar to super-admin (no org lock),
    // but they still only have front-end permissions for viewing.
    $sql = $baseSelect . " WHERE 1=1";

    // Search
    if ($q !== '') {
        $sql .= " AND (e.title LIKE :q OR e.location LIKE :q)";
        $params[':q'] = "%{$q}%";
    }

    // AY filters on events
    if ($startYear !== null) {
        $sql .= " AND e.start_year = :esy";
        $params[':esy'] = $startYear;
    }
    if ($endYear !== null) {
        $sql .= " AND e.end_year = :eey";
        $params[':eey'] = $endYear;
    }
    if ($activeYear !== null) {
        $sql .= " AND e.active_year = :eay";
        $params[':eay'] = $activeYear;
    }
}

// ============================ ORDER & LIMIT ====================================
$sql .= " ORDER BY e.created_at DESC, e.id DESC LIMIT 300";

$stmt = $pdo->prepare($sql);
$stmt->execute($params);

jok(['events' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
