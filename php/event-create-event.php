<?php
// php/event-create-event.php
require __DIR__.'/event-expenses-util.php';
[$actor] = require_auth(['admin','super-admin','treasurer']);

$pdo = db();

// Make sure session is available (require_auth most likely already started it)
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$role     = strtolower((string)($_SESSION['role']      ?? ''));
$idNumber = (string)($_SESSION['id_number'] ?? '');

// ---------------- Helper: orgs this user can handle in the ACTIVE AY -------------
/**
 * Returns array of organization abbreviations the user handles
 * in the given active academic year (start_year, end_year, active_year).
 *
 * - organizations.admin_id_number = user
 * - organizations.authors_id_number = user  (optional, kept from earlier logic)
 * - organization_fees.treasurer_id_number = user (joined via org_id)
 */
function ee_user_allowed_org_abbrs_for_active_ay(
    PDO $pdo,
    string $idNumber,
    int $sy,
    int $ey,
    int $ay
): array {
    if ($idNumber === '') return [];

    $abbrs = [];

    // As org admin / author
    $sqlOrg = "SELECT DISTINCT o.abbreviation
               FROM organizations o
               WHERE (o.admin_id_number = :id OR o.authors_id_number = :id)
                 AND o.start_year = :sy
                 AND o.end_year   = :ey
                 AND o.active_year= :ay";
    $paramsOrg = [
        ':id' => $idNumber,
        ':sy' => $sy,
        ':ey' => $ey,
        ':ay' => $ay,
    ];
    $st = $pdo->prepare($sqlOrg);
    $st->execute($paramsOrg);
    $abbrs = array_merge($abbrs, $st->fetchAll(PDO::FETCH_COLUMN) ?: []);

    // As org treasurer via organization_fees.org_id
    $sqlFee = "SELECT DISTINCT o.abbreviation
               FROM organization_fees f
               JOIN organizations o ON o.id = f.org_id
               WHERE f.treasurer_id_number = :id
                 AND f.start_year  = :sy
                 AND f.end_year    = :ey
                 AND f.active_year = :ay";
    $paramsFee = [
        ':id' => $idNumber,
        ':sy' => $sy,
        ':ey' => $ey,
        ':ay' => $ay,
    ];
    $st2 = $pdo->prepare($sqlFee);
    $st2->execute($paramsFee);
    $abbrs = array_merge($abbrs, $st2->fetchAll(PDO::FETCH_COLUMN) ?: []);

    $abbrs = array_values(array_unique(array_filter($abbrs)));
    return $abbrs;
}

// ---------------- Read input ----------------
$in = read_json();

$title    = trim($in['name'] ?? $in['title'] ?? '');
$location = trim($in['location'] ?? '');

// Raw scope from frontend: "general" | "organization" | "department" (legacy)
$scope_raw = $in['scope'] ?? 'general';
if (is_string($scope_raw)) {
    $scope_raw = strtolower(trim($scope_raw));
} else {
    $scope_raw = 'general';
}

// Normalize into "general" or "organization"
if ($scope_raw === 'department' || $scope_raw === 'organization') {
    $scope = 'organization';
} else {
    $scope = 'general';
}

// ---------------- Active academic year (server-side truth) ----------------
$yr = get_active_year($pdo);  // ['start_year','end_year','active_year']
$sy = (int)$yr['start_year'];
$ey = (int)$yr['end_year'];
$ay = (int)$yr['active_year'];

// ---------------- Resolve organization_abbr ----------------
$organization_abbr = null;

// For non–super-admin → FORCE organization scope + lock to their orgs only
if ($role !== 'super-admin') {
    $scope = 'organization';

    $organization_abbr = trim(
        $in['organization_abbr']
            ?? $in['org_abbr']
            ?? $in['department']
            ?? ''
    );

    if ($organization_abbr === '') {
        jerr(422, 'Organization is required for your role.');
    }

    // Check allowed orgs for this user in the active AY
    $allowedOrgs = ee_user_allowed_org_abbrs_for_active_ay($pdo, $idNumber, $sy, $ey, $ay);
    if (!in_array($organization_abbr, $allowedOrgs, true)) {
        jerr(403, 'You are not allowed to create events for this organization.');
    }

} else {
    // super-admin can create general or organization-scoped events
    if ($scope === 'organization') {
        $organization_abbr = trim(
            $in['organization_abbr']
                ?? $in['org_abbr']
                ?? $in['department']
                ?? ''
        );

        if ($organization_abbr === '') {
            jerr(422, 'Organization is required when scope=organization.');
        }
    } else {
        $organization_abbr = null; // general / campus-wide
    }
}

// Basic validation
if ($title === '' || $location === '') {
    jerr(422, 'Missing or invalid fields: name, location.');
}

// Optional: verify that the org exists (FK will also enforce this)
if ($scope === 'organization' && $organization_abbr !== null && $organization_abbr !== '') {
    $chkOrg = $pdo->prepare('SELECT 1 FROM organizations WHERE abbreviation = ? LIMIT 1');
    $chkOrg->execute([$organization_abbr]);
    if (!$chkOrg->fetch()) {
        jerr(422, 'Selected organization does not exist.');
    }
}

// ---------------- Insert event ----------------
$stmt = $pdo->prepare("
  INSERT INTO event_events
    (title, location, scope, organization_abbr,
     active_year, start_year, end_year,
     status, author_id_number)
  VALUES
    (:t, :loc, :sc, :org,
     :ay, :sy, :ey,
     'Draft', :author)
");

$stmt->execute([
  ':t'      => $title,
  ':loc'    => $location,
  ':sc'     => $scope,
  ':org'    => $organization_abbr,
  ':ay'     => $ay,
  ':sy'     => $sy,
  ':ey'     => $ey,
  ':author' => $actor, // id_number of creator from require_auth
]);

$id  = (int)$pdo->lastInsertId();
$row = $pdo->prepare('SELECT * FROM event_events WHERE id = ?');
$row->execute([$id]);

jok(['event' => $row->fetch()]);
