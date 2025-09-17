<?php
// php/register.php
header('Content-Type: application/json');

require 'database.php'; // must create $pdo (PDO) connection

try {
    // Collect & sanitize inputs
    $id_number  = isset($_POST['idNumber']) ? trim($_POST['idNumber']) : '';
    $full_name  = isset($_POST['fullName']) ? trim($_POST['fullName']) : '';
    $email      = isset($_POST['email']) ? trim($_POST['email']) : '';
    $schoolYear = isset($_POST['schoolYear']) ? trim($_POST['schoolYear']) : ''; // e.g. 2025-2026
    $course     = isset($_POST['course']) ? trim($_POST['course']) : '';         // we store this in department
    $yearLevel  = isset($_POST['yearLevel']) ? trim($_POST['yearLevel']) : '';   // "1".."5"
    $password   = isset($_POST['password']) ? (string)$_POST['password'] : '';
    $confirm    = isset($_POST['confirmPassword']) ? (string)$_POST['confirmPassword'] : '';

    // Basic validation
    if ($id_number === '' || $full_name === '' || $email === '' || $schoolYear === '' ||
        $course === '' || $yearLevel === '' || $password === '' || $confirm === '') {
        echo json_encode(['success' => false, 'message' => 'Please complete all required fields.']);
        exit;
    }

    // ID number: digits only
    if (!preg_match('/^\d+$/', $id_number)) {
        echo json_encode(['success' => false, 'message' => 'ID Number must contain digits only.']);
        exit;
    }

    // Academic Year like 2025-2026
    if (!preg_match('/^\d{4}-\d{4}$/', $schoolYear)) {
        echo json_encode(['success' => false, 'message' => 'Invalid School Year format. Use YYYY-YYYY.']);
        exit;
    }

    // Email format
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        echo json_encode(['success' => false, 'message' => 'Invalid email address.']);
        exit;
    }

    // Passwords match
    if ($password !== $confirm) {
        echo json_encode(['success' => false, 'message' => 'Passwords do not match.']);
        exit;
    }

    // Map year level to text
    $yearMap = [
        '1' => '1st Year',
        '2' => '2nd Year',
        '3' => '3rd Year',
        '4' => '4th Year',
        '5' => '5th Year',
    ];
    $yearText = $yearMap[$yearLevel] ?? null;
    if ($yearText === null) {
        echo json_encode(['success' => false, 'message' => 'Invalid year level.']);
        exit;
    }

    // Hash password (MD5 to match your existing data; switch to password_hash in the future)
    $passwordHash = md5($password);

    // Defaults
    $user_type = 'student';
    $role      = 'non-admin';
    $status    = 'Inactive';
    $department = $course; // per your instruction: put the selected course inside department

    // Ensure id_number unique (DB has UNIQUE constraint, but we check for nicer message)
    $chk = $pdo->prepare("SELECT id FROM users WHERE id_number = ?");
    $chk->execute([$id_number]);
    if ($chk->fetch()) {
        echo json_encode(['success' => false, 'message' => 'ID Number already exists.']);
        exit;
    }

    // Optional: also prevent duplicate email if you want (not unique in schema)
    $chk2 = $pdo->prepare("SELECT id FROM users WHERE email = ?");
    $chk2->execute([$email]);
    if ($chk2->fetch()) {
        echo json_encode(['success' => false, 'message' => 'Email is already registered.']);
        exit;
    }

    // Insert
    $stmt = $pdo->prepare("
        INSERT INTO users
            (id_number, full_name, password, user_type, role, department, status, profile_picture, email, school_year, year, created_at)
        VALUES
            (:id_number, :full_name, :password, :user_type, :role, :department, :status, :profile_picture, :email, :school_year, :year, NOW())
    ");

    $ok = $stmt->execute([
        ':id_number'       => $id_number,
        ':full_name'       => $full_name,
        ':password'        => $passwordHash,
        ':user_type'       => $user_type,
        ':role'            => $role,
        ':department'      => $department,   // course abbreviation/value
        ':status'          => $status,       // Inactive by default
        ':profile_picture' => null,          // default null
        ':email'           => $email,
        ':school_year'     => $schoolYear,   // e.g. 2025-2026
        ':year'            => $yearText,     // e.g. "1st Year"
    ]);

    if (!$ok) {
        echo json_encode(['success' => false, 'message' => 'Failed to register user.']);
        exit;
    }

    echo json_encode(['success' => true, 'message' => 'Registration successful.']);
} catch (PDOException $e) {
    // Handle unique constraint or other DB errors cleanly
    if ($e->getCode() === '23000') {
        echo json_encode(['success' => false, 'message' => 'Duplicate entry. Check ID Number or Email.']);
    } else {
        echo json_encode(['success' => false, 'message' => 'Database error: '.$e->getMessage()]);
    }
} catch (Exception $e) {
    echo json_encode(['success' => false, 'message' => 'Server error: '.$e->getMessage()]);
}
