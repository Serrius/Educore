<?php
declare(strict_types=1);

// Student / Treasurer department-based single event view
require __DIR__ . '/event-expenses-util.php';

// Treat treasurers the same as students / non-admins for this endpoint
$user = require_auth([
    'student',
    'treasurer',
    'non-admin',
]);

$pdo = db();

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$dept     = strtoupper(trim($user['department'] ?? ($_SESSION['department'] ?? '')));
$idNumber = $user['id_number'] ?? ($_SESSION['id_number'] ?? null);

if (!$idNumber) {
    jerr(401, 'Not authenticated');
}
if ($dept === '') {
    jerr(403, 'User has no department set');
}

// Input
$eventId = isset($_GET['event_id']) ? (int)$_GET['event_id'] : 0;
if ($eventId <= 0) {
    jerr(400, 'Invalid event_id');
}

// Load event restricted by department + organization scope
//  - same rule as list:
//      e.scope = 'organization'
//      UPPER(o.course_abbr) = :dept
$sqlEvent = "
    SELECT
        e.*,
        e.created_at AS event_date,
        o.name         AS org_name,
        o.abbreviation AS org_abbr,
        o.course_abbr  AS org_course_abbr
    FROM event_events e
    INNER JOIN organizations o
        ON o.abbreviation = e.organization_abbr
    WHERE
        e.id = :id
        AND e.scope = 'organization'
        AND UPPER(o.course_abbr) = :dept
    LIMIT 1
";

$stmtEvt = $pdo->prepare($sqlEvent);
$stmtEvt->execute([
    ':id'   => $eventId,
    ':dept' => $dept,
]);
$event = $stmtEvt->fetch(PDO::FETCH_ASSOC);

if (!$event) {
    jerr(404, 'Event not found for this department');
}

// Credits
$sqlCredits = "
    SELECT
        id,
        event_id,
        credit_date,
        source,
        notes,
        amount,
        recorded_by,
        created_at,
        updated_at
    FROM event_credits
    WHERE event_id = :id
    ORDER BY credit_date ASC, id ASC
";
$stmtC = $pdo->prepare($sqlCredits);
$stmtC->execute([':id' => $eventId]);
$credits = $stmtC->fetchAll(PDO::FETCH_ASSOC) ?: [];

// Debits
$sqlDebits = "
    SELECT
        id,
        event_id,
        debit_date,
        category,
        notes,
        amount,
        unit_price,
        quantity,
        receipt_path,
        receipt_number,
        recorded_by,
        created_at,
        updated_at
    FROM event_debits
    WHERE event_id = :id
    ORDER BY debit_date ASC, id ASC
";
$stmtD = $pdo->prepare($sqlDebits);
$stmtD->execute([':id' => $eventId]);
$debits = $stmtD->fetchAll(PDO::FETCH_ASSOC) ?: [];

jok([
    'success' => true,
    'event'   => $event,
    'credits' => $credits,
    'debits'  => $debits,
]);
