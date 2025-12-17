<?php
// php/register.php
header('Content-Type: application/json; charset=utf-8');
ini_set('display_errors', '1');
error_reporting(E_ALL);

require 'database.php'; // must create $pdo (PDO) connection

try {
    // Collect & sanitize inputs
    $id_number   = isset($_POST['idNumber']) ? trim($_POST['idNumber']) : '';

    // Separate name fields
    $first_name  = isset($_POST['firstName'])  ? trim($_POST['firstName'])  : '';
    $middle_name = isset($_POST['middleName']) ? trim($_POST['middleName']) : '';
    $last_name   = isset($_POST['lastName'])   ? trim($_POST['lastName'])   : '';
    $suffix      = isset($_POST['suffix'])     ? trim($_POST['suffix'])     : '';

    $email       = isset($_POST['email']) ? trim($_POST['email']) : '';
    $schoolYear  = isset($_POST['schoolYear']) ? trim($_POST['schoolYear']) : ''; // e.g. 2025-2026
    $course      = isset($_POST['course']) ? trim($_POST['course']) : '';         // course name or abbreviation
    $yearLevel   = isset($_POST['yearLevel']) ? trim($_POST['yearLevel']) : '';   // "1".."5"
    $password    = isset($_POST['password']) ? (string)$_POST['password'] : '';
    $confirm     = isset($_POST['confirmPassword']) ? (string)$_POST['confirmPassword'] : '';

    // Build full_name string only for display/notifications
    $nameParts = [];
    if ($first_name !== '')  $nameParts[] = $first_name;
    if ($middle_name !== '') $nameParts[] = $middle_name;
    if ($last_name !== '')   $nameParts[] = $last_name;
    if ($suffix !== '')      $nameParts[] = $suffix;
    $full_name = trim(preg_replace('/\s+/', ' ', implode(' ', $nameParts)));

    // Basic validation
    if (
        $id_number === '' ||
        $first_name === '' ||   // required
        $last_name === ''  ||   // required
        $email === '' ||
        $schoolYear === '' ||
        $course === '' ||
        $yearLevel === '' ||
        $password === '' ||
        $confirm === ''
    ) {
        echo json_encode(['success' => false, 'message' => 'Please complete all required fields.']);
        exit;
    }

    if (!preg_match('/^\d+$/', $id_number)) {
        echo json_encode(['success' => false, 'message' => 'ID Number must contain digits only.']);
        exit;
    }

    if (!preg_match('/^\d{4}-\d{4}$/', $schoolYear)) {
        echo json_encode(['success' => false, 'message' => 'Invalid School Year format. Use YYYY-YYYY.']);
        exit;
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        echo json_encode(['success' => false, 'message' => 'Invalid email address.']);
        exit;
    }

    if ($password !== $confirm) {
        echo json_encode(['success' => false, 'message' => 'Passwords do not match.']);
        exit;
    }

    // Map numeric year level -> display text
    $yearMap = [
        '1' => '1st Year',
        '2' => '2nd Year',
        '3' => '3rd Year',
        '4' => '4th Year',
        '5' => '5th Year'
    ];
    $yearText = $yearMap[$yearLevel] ?? null;
    if ($yearText === null) {
        echo json_encode(['success' => false, 'message' => 'Invalid year level.']);
        exit;
    }

    // Resolve course to department abbreviation (same style as add-student)
    $stmt = $pdo->prepare("SELECT abbreviation FROM courses WHERE course_name = ? OR abbreviation = ? LIMIT 1");
    $stmt->execute([$course, $course]);
    $courseRow = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$courseRow) {
        echo json_encode(['success' => false, 'message' => 'Invalid course/department.']);
        exit;
    }
    $department = $courseRow['abbreviation'];

    // Hash password (bcrypt, consistent with new scripts)
    $passwordHash = password_hash($password, PASSWORD_BCRYPT);

    // Defaults
    $user_type  = 'student';
    $role       = 'non-admin';
    $status     = 'Inactive';

    // Uniqueness checks
    $chk = $pdo->prepare("SELECT id FROM users WHERE id_number = ? LIMIT 1");
    $chk->execute([$id_number]);
    if ($chk->fetch()) {
        echo json_encode(['success' => false, 'message' => 'ID Number already exists.']);
        exit;
    }

    $chk2 = $pdo->prepare("SELECT id FROM users WHERE email = ? LIMIT 1");
    $chk2->execute([$email]);
    if ($chk2->fetch()) {
        echo json_encode(['success' => false, 'message' => 'Email is already registered.']);
        exit;
    }

    // Transaction: create user + notifications
    $pdo->beginTransaction();

    // Insert user (using split name fields)
    $stmt = $pdo->prepare("
        INSERT INTO users
            (id_number, first_name, middle_name, last_name, suffix,
             password, user_type, role, department, status,
             profile_picture, email, school_year, year, created_at)
        VALUES
            (:id_number, :first_name, :middle_name, :last_name, :suffix,
             :password, :user_type, :role, :department, :status,
             :profile_picture, :email, :school_year, :year, NOW())
    ");

    $ok = $stmt->execute([
        ':id_number'       => $id_number,
        ':first_name'      => $first_name,
        ':middle_name'     => $middle_name !== '' ? $middle_name : null,
        ':last_name'       => $last_name,
        ':suffix'          => $suffix !== '' ? $suffix : null,
        ':password'        => $passwordHash,
        ':user_type'       => $user_type,
        ':role'            => $role,
        ':department'      => $department,
        ':status'          => $status,
        ':profile_picture' => null,
        ':email'           => $email,
        ':school_year'     => $schoolYear,
        ':year'            => $yearText,
    ]);

    if (!$ok) {
        $pdo->rollBack();
        echo json_encode(['success' => false, 'message' => 'Failed to register user.']);
        exit;
    }

    // Find all Active super-admins to notify
    $saStmt = $pdo->query("
        SELECT id_number
        FROM users
        WHERE role = 'super-admin' AND status = 'Active'
    ");
    $superAdmins = $saStmt->fetchAll(PDO::FETCH_COLUMN);

    // Create notifications
    $notifCount = 0;
    if (!empty($superAdmins)) {
        $title   = 'New registration pending approval';
        $displayName = $full_name !== '' ? $full_name : $id_number;
        $message = "User {$id_number} ({$displayName}) has registered and is pending approval.";
        // Use 'registration' to align with JS routing (notif_type === 'registration')
        $type    = 'registration';

        $insN = $pdo->prepare("
            INSERT INTO notifications
                (recipient_id_number, actor_id_number, title, message, notif_type, status, created_at)
            VALUES
                (:recipient_id_number, :actor_id_number, :title, :message, :notif_type, 'unread', NOW())
        ");

        foreach ($superAdmins as $saIdNum) {
            $insN->execute([
                ':recipient_id_number' => $saIdNum,
                ':actor_id_number'     => $id_number,  // the registering user
                ':title'               => $title,
                ':message'             => $message,
                ':notif_type'          => $type,
            ]);
            $notifCount += $insN->rowCount();
        }
    }

    $pdo->commit();

    echo json_encode([
        'success'            => true,
        'message'            => 'Registration successful.',
        'notifications_sent' => $notifCount
    ]);

} catch (PDOException $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    if ($e->getCode() === '23000') {
        echo json_encode(['success' => false, 'message' => 'Duplicate entry. Check ID Number or Email.']);
    } else {
        echo json_encode(['success' => false, 'message' => 'Database error: '.$e->getMessage()]);
    }
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    echo json_encode(['success' => false, 'message' => 'Server error: '.$e->getMessage()]);
}
