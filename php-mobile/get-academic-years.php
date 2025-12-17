<?php
// get-academic-years.php - FIXED
header('Content-Type: application/json; charset=utf-8');
session_start();

try {
    require __DIR__ . '/database.php';

    if (!isset($pdo)) {
        throw new Exception("Database connection not available.");
    }

    // Get all academic years
    $stmt = $pdo->query("
        SELECT 
            id,
            start_year,
            end_year,
            active_year,
            status,
            created_at,
            CONCAT(start_year, '-', end_year) as school_year
        FROM academic_years 
        ORDER BY start_year DESC, id DESC
    ");
    
    $academicYears = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Find active academic year (multiple fallback methods)
    $activeYear = null;
    $currentYear = date('Y');
    
    // Method 1: Status = 'Active'
    $activeStmt = $pdo->query("
        SELECT start_year, end_year, active_year, status
        FROM academic_years 
        WHERE status = 'Active' 
        LIMIT 1
    ");
    $activeYear = $activeStmt->fetch(PDO::FETCH_ASSOC);
    
    // Method 2: Year includes current year
    if (!$activeYear) {
        $currentStmt = $pdo->query("
            SELECT start_year, end_year, active_year, status
            FROM academic_years 
            WHERE $currentYear BETWEEN start_year AND end_year
            LIMIT 1
        ");
        $activeYear = $currentStmt->fetch(PDO::FETCH_ASSOC);
    }
    
    // Method 3: Most recent year
    if (!$activeYear && count($academicYears) > 0) {
        $activeYear = $academicYears[0];
    }

    // Format the response
    $formattedYears = [];
    foreach ($academicYears as $year) {
        $isCurrent = ($currentYear >= $year['start_year'] && $currentYear <= $year['end_year']);
        
        $formattedYears[] = [
            'id' => (int)$year['id'],
            'start_year' => (int)$year['start_year'],
            'end_year' => (int)$year['end_year'],
            'active_year' => (int)$year['active_year'],
            'school_year' => $year['school_year'],
            'status' => $year['status'],
            'is_current' => $isCurrent,
            'created_at' => $year['created_at']
        ];
    }

    echo json_encode([
        'success' => true,
        'data' => [
            'academic_years' => $formattedYears,
            'active_academic_year' => $activeYear ? [
                'start_year' => (int)$activeYear['start_year'],
                'end_year' => (int)$activeYear['end_year'],
                'active_year' => (int)$activeYear['active_year'],
                'status' => $activeYear['status'],
                'school_year' => $activeYear['start_year'] . '-' . $activeYear['end_year']
            ] : null,
            'current_year' => $currentYear
        ]
    ]);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Server error while fetching academic years.',
        'detail' => $e->getMessage(),
    ]);
}