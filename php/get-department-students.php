<?php
// php/get-department-students.php
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

    // Accept department from multiple inputs
    $deptIn = $_GET['department'] 
           ?? $_POST['department'] 
           ?? $_GET['course_abbr'] 
           ?? $_POST['course_abbr'] 
           ?? '';

    $dept = strtoupper(trim((string)$deptIn));
    if ($dept === '') jerr(400,'department/course_abbr is required.');

    // Optional passthrough params
    $ay = isset($_GET['active_year']) ? (int)$_GET['active_year'] : null;
    $q  = trim((string)($_GET['q'] ?? $_POST['q'] ?? ''));

    // WHERE builder
    $where  = ["user_type = 'student'"];
    $params = [];

    // Department matching
    $where[] = "(UPPER(department) = :dept_exact OR UPPER(department) LIKE :dept_like)";
    $params[':dept_exact'] = $dept;
    $params[':dept_like']  = '%'.$dept.'%';

    // Search filter
    if ($q !== '') {
        if (mb_strlen($q) < 2) jerr(400,'Query too short (min 2 chars).', ['min_chars'=>2]);

        $escaped = '%'.str_replace(['%','_','\\'], ['\\%','\\_','\\\\'], strtolower($q)).'%';

        // Search across name fields
        $where[] = "(
            LOWER(first_name)  LIKE :like ESCAPE '\\\\' OR
            LOWER(middle_name) LIKE :like ESCAPE '\\\\' OR
            LOWER(last_name)   LIKE :like ESCAPE '\\\\' OR
            LOWER(suffix)      LIKE :like ESCAPE '\\\\' OR
            LOWER(CONCAT_WS(' ', first_name, middle_name, last_name, suffix)) LIKE :like ESCAPE '\\\\' OR
            id_number LIKE :like ESCAPE '\\\\'
        )";

        $params[':like'] = $escaped;
    }

    $whereSQL = implode(' AND ', $where);

    // --- Query ---
    // Generate full_name dynamically (no stored full_name field)
    $sql = "
        SELECT 
            id_number,
            CONCAT_WS(' ', first_name, middle_name, last_name, suffix) AS full_name,
            department,
            `year` AS year_level,
            school_year
        FROM users
        WHERE {$whereSQL}
        ORDER BY first_name ASC, last_name ASC, id_number ASC
    ";

    $st = $pdo->prepare($sql);
    foreach ($params as $k=>$v) $st->bindValue($k,$v);
    $st->execute();
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);

    // Normalize output
    $students = [];
    foreach ($rows as $r) {
        $dep = (string)($r['department'] ?? '');
        $students[] = [
            'id_number'   => (string)$r['id_number'],
            'full_name'   => (string)$r['full_name'],
            'year_level'  => (string)($r['year_level'] ?? ''),
            'course_abbr' => $dep,
            'department'  => $dep,
            'school_year' => (string)$r['school_year'],
        ];
    }

    echo json_encode([
        'success'     => true,
        'active_year' => $ay,
        'students'    => $students,
        'meta'        => [
            'department' => $dept,
            'q'          => ($q !== '' ? $q : null),
            'count'      => count($students),
        ],
    ]);

} catch (Throwable $e) {
    jerr(500,'Server error',['detail'=>$e->getMessage()]);
}
