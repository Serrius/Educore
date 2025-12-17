<?php
// php/event-list-events-students.php
require __DIR__ . '/event-expenses-util.php';

// Student view for department event expenses.
// Treasurers are treated the same as students here.
require_auth([
    'student',
    'treasurer',
    'non-admin',
]);

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json; charset=utf-8');

// Remove the duplicate jerr() function declaration since it's already in event-expenses-util.php

try {
    $pdo = db();

    // -------- SESSION CONTEXT --------
    $idNumber = $_SESSION['id_number']  ?? null;
    $dept     = $_SESSION['department'] ?? null;

    if (!$idNumber) {
        jerr(401, 'Not authenticated');
    }

    $dept = strtoupper(trim((string)$dept));
    if ($dept === '') {
        // Walay klarong department → walay makita nga dept events
        echo json_encode([
            'success' => true,
            'events'  => [],
        ]);
        exit;
    }

    // -------- FILTERS (AY + SEARCH) --------
    $q          = trim($_GET['q'] ?? '');
    $startYear  = isset($_GET['start_year'])  && $_GET['start_year']  !== '' ? (int)$_GET['start_year']  : null;
    $endYear    = isset($_GET['end_year'])    && $_GET['end_year']    !== '' ? (int)$_GET['end_year']    : null;
    $activeYear = isset($_GET['active_year']) && $_GET['active_year'] !== '' ? (int)$_GET['active_year'] : null;

    // -------- MAIN QUERY --------
    // IMPORTANT:
    //  - department-based only: UPPER(o.course_abbr) = :dept
    //  - only ORGANIZATION-scope events (no campus-wide/general)
    //  - we alias created_at -> event_date (to avoid missing column)
    $sql = "
        SELECT
            e.id,
            e.title,
            e.location,
            e.scope,
            e.organization_abbr,
            e.active_year,
            e.start_year,
            e.end_year,
            e.status,
            e.created_at AS event_date,
            e.created_at,
            e.updated_at,
            o.name         AS org_name,
            o.abbreviation AS org_abbr,
            o.course_abbr  AS org_course_abbr
        FROM event_events e
        INNER JOIN organizations o
            ON o.abbreviation = e.organization_abbr
        WHERE
            e.scope = 'organization'
            AND UPPER(o.course_abbr) = :dept
    ";

    $params = [
        ':dept' => $dept,
    ];

    if ($startYear !== null) {
        $sql .= " AND e.start_year = :sy";
        $params[':sy'] = $startYear;
    }
    if ($endYear !== null) {
        $sql .= " AND e.end_year = :ey";
        $params[':ey'] = $endYear;
    }
    if ($activeYear !== null) {
        $sql .= " AND e.active_year = :ay";
        $params[':ay'] = $activeYear;
    }

    if ($q !== '') {
        $sql .= " AND (e.title LIKE :q OR e.location LIKE :q)";
        $params[':q'] = '%' . $q . '%';
    }

    $sql .= " ORDER BY e.created_at DESC, e.id DESC LIMIT 300";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

    echo json_encode([
        'success' => true,
        'events'  => $rows,
    ]);
} catch (Throwable $e) {
    jerr(500, 'Failed to load department events', ['error' => $e->getMessage()]);
}