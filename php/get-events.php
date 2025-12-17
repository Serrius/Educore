<?php
// get-events.php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    exit(0);
}

require_once 'database.php';

try {
    $conn = $pdo;
    
    // Get academic year filters if provided
    $start_year = $_GET['start_year'] ?? null;
    $end_year = $_GET['end_year'] ?? null;
    $active_year = $_GET['active_year'] ?? null;
    
    $query = "
        SELECT 
            e.id,
            e.title as name,  -- Using title as the event name
            e.organization_abbr,
            e.start_year,
            e.end_year,
            e.active_year
        FROM event_events e
        WHERE e.status IN ('Draft', 'Submitted', 'Approved')  -- Include relevant statuses
    ";
    
    $params = [];
    if ($start_year) {
        $query .= " AND e.start_year = :start_year";
        $params[':start_year'] = $start_year;
    }
    if ($end_year) {
        $query .= " AND e.end_year = :end_year";
        $params[':end_year'] = $end_year;
    }
    if ($active_year) {
        $query .= " AND e.active_year = :active_year";
        $params[':active_year'] = $active_year;
    }
    
    $query .= " ORDER BY e.title";
    
    $stmt = $conn->prepare($query);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value);
    }
    
    $stmt->execute();
    $events = $stmt->fetchAll(PDO::FETCH_ASSOC);
    
    echo json_encode([
        'success' => true,
        'events' => $events
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Error fetching events: ' . $e->getMessage(),
        'events' => []
    ]);
}
?>