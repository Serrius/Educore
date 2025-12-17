<?php
require __DIR__ . '/event-expenses-util.php';

// Allow admins, super-admin, special-admin, treasurers, and non-admin roles to view
$user = require_auth([
    'admin',
    'super-admin',
    'special-admin',
    'treasurer',
    'faculty',
    'guard',
    'student',
    'non-admin',
    'guest'
]);

$event_id = (int)($_GET['event_id'] ?? 0);
if ($event_id <= 0) {
    jerr(422, 'Invalid event_id.');
}

$pdo = db();

// ==================== Fetch event =====================
$evt = $pdo->prepare("SELECT * FROM event_events WHERE id = ? LIMIT 1");
$evt->execute([$event_id]);
$event = $evt->fetch(PDO::FETCH_ASSOC);

if (!$event) {
    jerr(404, 'Event not found.');
}

// ==================== Access control ====================
// Rule:
// - super-admin & special-admin: can view any event
// - admin/treasurer: can only view organization-scoped events that belong
//   to their own course/department (via organizations.course_abbr).
//   General-scope events are treated as campus-wide (allowed).
// - other roles (faculty/guard/student/guest): can view any event (read-only).

$role = strtolower($user['role'] ?? '');

$isSuper = in_array($role, ['super-admin', 'special-admin'], true);

if (!$isSuper) {
    // Only enforce department/org checks for admin/treasurer
    if (in_array($role, ['admin', 'treasurer'], true)) {
        $userDept = $user['department'] ?? null;

        // Only need to check when the event is tied to an organization
        $orgCourseAbbr = null;

        if (
            isset($event['scope'], $event['organization_abbr']) &&
            $event['scope'] === 'organization' &&
            $event['organization_abbr'] !== ''
        ) {
            $orgStmt = $pdo->prepare("
                SELECT course_abbr
                FROM organizations
                WHERE abbreviation = ?
                LIMIT 1
            ");
            $orgStmt->execute([$event['organization_abbr']]);
            $org = $orgStmt->fetch(PDO::FETCH_ASSOC);

            if ($org) {
                $orgCourseAbbr = $org['course_abbr'] ?? null;
            }
        }

        // If the event is organization-based AND the org has a specific course_abbr,
        // then enforce that it must match the admin/treasurer's department.
        if (
            ($event['scope'] ?? '') === 'organization' &&
            $orgCourseAbbr &&            // org is tied to a specific course
            $userDept &&                 // user has a department
            $orgCourseAbbr !== $userDept // mismatch => no access
        ) {
            jerr(403, 'You are not allowed to view the event expenses for this department.');
        }

        // If:
        // - scope = 'general', OR
        // - org has no course_abbr (campus-wide org),
        // then we let admin/treasurer pass through.
    }
    // other roles (faculty/guard/student/guest) pass without extra checks
}

// ==================== Credits ====================
$creditsStmt = $pdo->prepare("
    SELECT *
    FROM event_credits
    WHERE event_id = ?
    ORDER BY credit_date, id
");
$creditsStmt->execute([$event_id]);
$credits = $creditsStmt->fetchAll(PDO::FETCH_ASSOC);

// ==================== Debits ====================
$debitsStmt = $pdo->prepare("
    SELECT *, 
           COALESCE(unit_price, amount / GREATEST(quantity, 1)) as calculated_unit_price
    FROM event_debits
    WHERE event_id = ?
    ORDER BY debit_date, id
");
$debitsStmt->execute([$event_id]);
$debits = $debitsStmt->fetchAll(PDO::FETCH_ASSOC);

// ==================== Totals ====================
$tc = $pdo->prepare("
    SELECT IFNULL(SUM(amount),0) AS total
    FROM event_credits
    WHERE event_id = ?
");
$tc->execute([$event_id]);
$totalCreditsRow = $tc->fetch(PDO::FETCH_ASSOC);
$totalCredits = isset($totalCreditsRow['total']) ? (float)$totalCreditsRow['total'] : 0.0;

$td = $pdo->prepare("
    SELECT IFNULL(SUM(amount),0) AS total
    FROM event_debits
    WHERE event_id = ?
");
$td->execute([$event_id]);
$totalDebitsRow = $td->fetch(PDO::FETCH_ASSOC);
$totalDebits = isset($totalDebitsRow['total']) ? (float)$totalDebitsRow['total'] : 0.0;

// ==================== Response ====================

$response = [
    'event'   => $event,
    'credits' => $credits,
    'debits'  => $debits,
    'totals'  => [
        'credits' => $totalCredits,
        'debits'  => $totalDebits,
    ],
];

jok([
    'success' => true,
] + $response);
