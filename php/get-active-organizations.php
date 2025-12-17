<?php
// php/get-active-organizations.php
require __DIR__ . '/event-expenses-util.php';
require_auth(['admin','super-admin', 'special-admin', 'treasurer']); // adjust as needed

$pdo = db();

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$role     = $_SESSION['role']      ?? '';
$idNumber = $_SESSION['id_number'] ?? '';

// Optional AY filters (will come from JS when we update it)
$startYear  = isset($_GET['start_year'])  && $_GET['start_year']  !== '' ? (int)$_GET['start_year']  : null;
$endYear    = isset($_GET['end_year'])    && $_GET['end_year']    !== '' ? (int)$_GET['end_year']    : null;
$activeYear = isset($_GET['active_year']) && $_GET['active_year'] !== '' ? (int)$_GET['active_year'] : null;

// Base query: only "active" orgs (you can tweak the statuses allowed)
$sql = "SELECT o.*
        FROM organizations o
        WHERE o.status IN ('Accredited','Reaccredited')";

$params = [];

// Apply AY filters to organizations
if ($startYear !== null) {
    $sql .= " AND o.start_year = :sy";
    $params[':sy'] = $startYear;
}
if ($endYear !== null) {
    $sql .= " AND o.end_year = :ey";
    $params[':ey'] = $endYear;
}
if ($activeYear !== null) {
    $sql .= " AND o.active_year = :ay";
    $params[':ay'] = $activeYear;
}

if (strtolower($role) !== 'super-admin' && strtolower($role) !== 'special-admin') {
    // Join with organization_fees for treasurer lock, and admin_id_number
    $sql .= " AND (
                o.admin_id_number = :id
             OR EXISTS (
                    SELECT 1
                    FROM organization_fees f
                    WHERE f.org_id = o.id
                      AND f.treasurer_id_number = :id2
                      " . ($startYear !== null ? " AND f.start_year = :fsy" : "") . "
                      " . ($endYear   !== null ? " AND f.end_year   = :fey" : "") . "
                      " . ($activeYear!== null ? " AND f.active_year= :fay" : "") . "
                )
            )";

    $params[':id']  = $idNumber;
    $params[':id2'] = $idNumber;

    if ($startYear !== null) $params[':fsy'] = $startYear;
    if ($endYear   !== null) $params[':fey'] = $endYear;
    if ($activeYear!== null) $params[':fay'] = $activeYear;
}

$sql .= " ORDER BY o.abbreviation, o.name";

$stmt = $pdo->prepare($sql);
$stmt->execute($params);

$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

jok([
    'success'        => true,
    'organizations'  => $rows,
]);
