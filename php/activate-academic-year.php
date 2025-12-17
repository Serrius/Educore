<?php
// php/activate-academic-year.php
declare(strict_types=1);

require 'database.php';
header('Content-Type: application/json');

// ----- Input validation -----
$id = isset($_POST['id']) ? (int)$_POST['id'] : 0;
if ($id <= 0) {
    echo json_encode([
        "success" => false,
        "message" => "Invalid academic year ID."
    ]);
    exit;
}

try {
    if (!isset($pdo) || !($pdo instanceof PDO)) {
        throw new RuntimeException("Database connection not available.");
    }

    $pdo->beginTransaction();

    // 1) Lock the TARGET academic year row
    $getTarget = $pdo->prepare("
        SELECT id, start_year, end_year, active_year, status
        FROM academic_years
        WHERE id = ?
        FOR UPDATE
    ");
    $getTarget->execute([$id]);
    $target = $getTarget->fetch(PDO::FETCH_ASSOC);

    if (!$target) {
        $pdo->rollBack();
        echo json_encode([
            "success" => false,
            "message" => "Academic year not found."
        ]);
        exit;
    }

    $targetStart  = (int)$target['start_year'];
    $targetEnd    = (int)$target['end_year'];
    $targetActive = $targetStart;
    $newSchoolYear = $targetStart . "-" . ($targetStart + 1);

    // 2) Lock the PREVIOUS active academic year (if any and different)
    $getPrevActive = $pdo->prepare("
        SELECT id, start_year, end_year, active_year
        FROM academic_years
        WHERE status = 'Active' AND id <> ?
        ORDER BY id DESC
        LIMIT 1
        FOR UPDATE
    ");
    $getPrevActive->execute([$id]);
    $prev = $getPrevActive->fetch(PDO::FETCH_ASSOC);

    // 3) Determine if we're moving FORWARD or BACKWARD in time
    $isMovingForward = false;
    $isMovingBackward = false;
    $isFirstActivation = false;
    
    $prevStart = null;
    $prevEnd = null;
    
    if ($prev) {
        $prevStart = (int)$prev['start_year'];
        $prevEnd   = (int)$prev['end_year'];
        
        if ($targetStart > $prevStart) {
            // Moving to a LATER year
            $isMovingForward = true;
            $direction = 'forward';
        } elseif ($targetStart < $prevStart) {
            // Moving to an EARLIER year
            $isMovingBackward = true;
            $direction = 'backward';
        } else {
            // Same year span (toggle between start/end?)
            $direction = 'same_span';
        }
    } else {
        // No previous active year - first activation
        $isFirstActivation = true;
        $direction = 'first_activation';
    }

    // 4) Close ALL academic years, then set the selected one as Active
    $pdo->exec("UPDATE academic_years SET status = 'Closed'");

    $setActive = $pdo->prepare("
        UPDATE academic_years
        SET status = 'Active',
            active_year = start_year
        WHERE id = ?
    ");
    $setActive->execute([$id]);

    // Define year level progression arrays
    $fourYearPrograms = ['BSIT', 'BSMET', 'BSTCM', 'BSESM', 'BSABG'];
    $fiveYearProgram = 'BSNAME';
    
    $yearLevels4Year = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
    $yearLevels5Year = ['First Year', 'Second Year', 'Third Year', 'Fourth Year', 'Fifth Year'];

    // 5) STUDENT TRANSITION LOGIC WITH PROPER YEAR LEVELS
    $studentTransitionDetails = [];
    
    if ($isMovingForward) {
        // ========== MOVING FORWARD TO NEW ACADEMIC YEAR ==========
        
        // A) Create a TEMPORARY TABLE to store student roles before changes
        $pdo->exec("
            CREATE TEMPORARY TABLE IF NOT EXISTS student_role_history_forward (
                id INT PRIMARY KEY AUTO_INCREMENT,
                student_id INT NOT NULL,
                id_number VARCHAR(50) NOT NULL,
                previous_role VARCHAR(20) NOT NULL,
                previous_year VARCHAR(20),
                previous_status VARCHAR(20),
                academic_year VARCHAR(20),
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ");
        
        // Store current roles before making changes
        $storeRoles = $pdo->prepare("
            INSERT INTO student_role_history_forward (student_id, id_number, previous_role, previous_year, previous_status, academic_year)
            SELECT id, id_number, role, year, status, ?
            FROM users 
            WHERE user_type = 'student'
            AND role IN ('treasurer', 'non-admin')
        ");
        $storeRoles->execute([$prevStart . "-" . ($prevStart + 1)]);
        $rolesStored = $storeRoles->rowCount();
        
        // Get counts before transition
        // Count 4th year students in 4-year programs
        $count4thYear = $pdo->prepare("
            SELECT COUNT(*) FROM users 
            WHERE user_type = 'student' 
            AND year = 'Fourth Year'
            AND department IN (" . implode(',', array_fill(0, count($fourYearPrograms), '?')) . ")
            AND status != 'Archived'
        ");
        $count4thYear->execute($fourYearPrograms);
        $total4thYearStudents = $count4thYear->fetchColumn();
        
        // Count 5th year students in 5-year program
        $count5thYear = $pdo->prepare("
            SELECT COUNT(*) FROM users 
            WHERE user_type = 'student' 
            AND year = 'Fifth Year'
            AND department = ?
            AND status != 'Archived'
        ");
        $count5thYear->execute([$fiveYearProgram]);
        $total5thYearStudents = $count5thYear->fetchColumn();
        
        // Count treasurers before transition
        $countTreasurers = $pdo->prepare("
            SELECT COUNT(*) FROM users 
            WHERE user_type = 'student' 
            AND role = 'treasurer'
        ");
        $countTreasurers->execute();
        $treasurersBefore = $countTreasurers->fetchColumn();
        
        // B) Archive ALL graduating students
        // Archive 4th year students from 4-year programs
        $archive4YearGrads = $pdo->prepare("
            UPDATE users 
            SET status = 'Archived',
                school_year = ?
            WHERE user_type = 'student' 
            AND status != 'Archived'
            AND year = 'Fourth Year'
            AND department IN (" . implode(',', array_fill(0, count($fourYearPrograms), '?')) . ")
        ");
        $params = array_merge([$newSchoolYear], $fourYearPrograms);
        $archive4YearGrads->execute($params);
        $archived4YearCount = $archive4YearGrads->rowCount();
        
        // Archive 5th year students from 5-year program (BSNAME)
        $archive5YearGrads = $pdo->prepare("
            UPDATE users 
            SET status = 'Archived',
                school_year = ?
            WHERE user_type = 'student' 
            AND status != 'Archived'
            AND year = 'Fifth Year'
            AND department = ?
        ");
        $archive5YearGrads->execute([$newSchoolYear, $fiveYearProgram]);
        $archived5YearCount = $archive5YearGrads->rowCount();
        
        $totalArchived = $archived4YearCount + $archived5YearCount;
        
        // C) Reset treasurer roles to non-admin for continuing students
        $resetTreasurerRoles = $pdo->prepare("
            UPDATE users 
            SET role = 'non-admin'
            WHERE user_type = 'student' 
            AND role = 'treasurer'
            AND status != 'Archived'
        ");
        $resetTreasurerRoles->execute();
        $treasurersReset = $resetTreasurerRoles->rowCount();
        
        // D) Set ALL remaining NON-ARCHIVED students to Inactive
        $deactivateAll = $pdo->prepare("
            UPDATE users 
            SET status = 'Inactive',
                school_year = ?
            WHERE user_type = 'student' 
            AND status != 'Archived'
        ");
        $deactivateAll->execute([$newSchoolYear]);
        $deactivatedCount = $deactivateAll->rowCount();
        
        // E) Advance year levels for Inactive students
        // For 4-year programs: First Year → Second Year → Third Year → Fourth Year
        $advance4Year = $pdo->prepare("
            UPDATE users 
            SET year = CASE 
                WHEN year = 'First Year' THEN 'Second Year'
                WHEN year = 'Second Year' THEN 'Third Year'
                WHEN year = 'Third Year' THEN 'Fourth Year'
                ELSE year
            END
            WHERE user_type = 'student' 
            AND status = 'Inactive'
            AND department IN (" . implode(',', array_fill(0, count($fourYearPrograms), '?')) . ")
            AND year IN ('First Year', 'Second Year', 'Third Year')
        ");
        $advance4Year->execute($fourYearPrograms);
        $advanced4YearCount = $advance4Year->rowCount();
        
        // For 5-year program: First Year → Second Year → Third Year → Fourth Year → Fifth Year
        $advance5Year = $pdo->prepare("
            UPDATE users 
            SET year = CASE 
                WHEN year = 'First Year' THEN 'Second Year'
                WHEN year = 'Second Year' THEN 'Third Year'
                WHEN year = 'Third Year' THEN 'Fourth Year'
                WHEN year = 'Fourth Year' THEN 'Fifth Year'
                ELSE year
            END
            WHERE user_type = 'student' 
            AND status = 'Inactive'
            AND department = ?
            AND year IN ('First Year', 'Second Year', 'Third Year', 'Fourth Year')
        ");
        $advance5Year->execute([$fiveYearProgram]);
        $advanced5YearCount = $advance5Year->rowCount();
        
        $totalAdvanced = $advanced4YearCount + $advanced5YearCount;
        
        // F) Handle students with invalid or null year values
        $validYears = array_merge($yearLevels4Year, $yearLevels5Year);
        $placeholders = implode(',', array_fill(0, count($validYears), '?'));
        
        $handleInvalidYears = $pdo->prepare("
            UPDATE users 
            SET status = 'Inactive'
            WHERE user_type = 'student' 
            AND status != 'Archived'
            AND (year IS NULL OR year NOT IN ($placeholders))
        ");
        $handleInvalidYears->execute($validYears);
        $invalidYearCount = $handleInvalidYears->rowCount();
        
        $studentTransitionDetails = [
            "transition_type" => "forward_progression",
            "roles_stored_in_history" => $rolesStored,
            "treasurers_before" => $treasurersBefore,
            "treasurer_roles_reset" => $treasurersReset,
            "graduating_students_archived" => [
                "4_year_programs" => $archived4YearCount,
                "5_year_program" => $archived5YearCount,
                "total" => $totalArchived
            ],
            "students_deactivated" => $deactivatedCount,
            "year_levels_advanced" => $totalAdvanced,
            "invalid_year_handled" => $invalidYearCount,
            "note" => "Treasurer roles reset to 'non-admin' for new academic year"
        ];
        
    } elseif ($isMovingBackward) {
        // ========== MOVING BACKWARD TO PREVIOUS ACADEMIC YEAR ==========
        // RESTORE roles from the target academic year's history
        
        $targetSchoolYear = $targetStart . "-" . ($targetStart + 1);
        
        // A) Restore treasurer roles from organization_fees table
        $restoreTreasurers = $pdo->prepare("
            UPDATE users u
            JOIN organization_fees of ON u.id_number = of.treasurer_id_number
            SET u.role = 'treasurer'
            WHERE u.user_type = 'student'
            AND of.active_year = ?
            AND u.status != 'Archived'
        ");
        $restoreTreasurers->execute([$targetStart]);
        $treasurersRestored = $restoreTreasurers->rowCount();
        
        // B) Update school_year for all students
        $updateStudentSchoolYear = $pdo->prepare("
            UPDATE users 
            SET school_year = ?
            WHERE user_type = 'student'
        ");
        $updateStudentSchoolYear->execute([$targetSchoolYear]);
        $schoolYearsUpdated = $updateStudentSchoolYear->rowCount();
        
        // C) REVERT year levels (would require history table)
        // For now, we cannot revert year levels without history
        
        $studentTransitionDetails = [
            "transition_type" => "backward_rewind",
            "treasurer_roles_restored" => $treasurersRestored,
            "school_years_updated" => $schoolYearsUpdated,
            "warning" => "Year levels not reverted (requires history table)",
            "note" => "Treasurer roles restored based on organization_fees records"
        ];
        
    } elseif ($isFirstActivation) {
        // ========== FIRST TIME ACTIVATION ==========
        $updateStudentSchoolYear = $pdo->prepare("
            UPDATE users 
            SET school_year = ?
            WHERE user_type = 'student'
        ");
        $updateStudentSchoolYear->execute([$newSchoolYear]);
        $schoolYearsUpdated = $updateStudentSchoolYear->rowCount();
        
        $studentTransitionDetails = [
            "transition_type" => "first_activation",
            "school_years_updated" => $schoolYearsUpdated
        ];
        
    } else {
        // ========== SAME SPAN (toggling active_year) ==========
        $updateStudentSchoolYear = $pdo->prepare("
            UPDATE users 
            SET school_year = ?
            WHERE user_type = 'student'
        ");
        $updateStudentSchoolYear->execute([$newSchoolYear]);
        $schoolYearsUpdated = $updateStudentSchoolYear->rowCount();
        
        $studentTransitionDetails = [
            "transition_type" => "same_span_toggle",
            "school_years_updated" => $schoolYearsUpdated
        ];
    }

    // 6) ORGANIZATION TRANSITIONS
    $markedPrev = 0;
    
    if ($isMovingForward && $prev) {
        $prevStart = (int)$prev['start_year'];
        $prevEnd   = (int)$prev['end_year'];
        
        $markPrev = $pdo->prepare("
            UPDATE organizations
               SET status = 'For Reaccreditation'
             WHERE start_year = :sy
               AND end_year   = :ey
               AND status IN ('Accredited', 'Reaccredited')
        ");
        $markPrev->execute([
            ':sy' => $prevStart,
            ':ey' => $prevEnd,
        ]);
        $markedPrev = $markPrev->rowCount();
    }
    
    // 7) Update organization years to match target span
    $updateOrgYears = $pdo->prepare("
        UPDATE organizations
           SET start_year  = :ts,
               end_year    = :te,
               active_year = :ay
        WHERE status <> 'Declined'
    ");
    $updateOrgYears->execute([
        ':ts' => $targetStart,
        ':te' => $targetEnd,
        ':ay' => $targetActive,
    ]);
    $orgsYearsUpdated = $updateOrgYears->rowCount();

    // 8) Restore organization status from accreditation files
    $restoredReaccredited = 0;
    $restoredAccredited   = 0;

    $restoreReaccredited = $pdo->prepare("
        UPDATE organizations o
        JOIN (
            SELECT DISTINCT org_id
            FROM accreditation_files
            WHERE start_year = :ts
              AND end_year   = :te
              AND status     = 'approved'
              AND doc_group  = 'reaccreditation'
        ) f ON f.org_id = o.id
        SET o.status = 'Reaccredited'
        WHERE o.status <> 'Declined'
    ");
    $restoreReaccredited->execute([
        ':ts' => $targetStart,
        ':te' => $targetEnd,
    ]);
    $restoredReaccredited = $restoreReaccredited->rowCount();

    $restoreAccredited = $pdo->prepare("
        UPDATE organizations o
        JOIN (
            SELECT DISTINCT org_id
            FROM accreditation_files
            WHERE start_year = :ts
              AND end_year   = :te
              AND status     = 'approved'
              AND doc_group  = 'new'
        ) f ON f.org_id = o.id
        SET o.status = 'Accredited'
        WHERE o.status NOT IN ('Reaccredited', 'Declined')
    ");
    $restoreAccredited->execute([
        ':ts' => $targetStart,
        ':te' => $targetEnd,
    ]);
    $restoredAccredited = $restoreAccredited->rowCount();
    
    // 9) Get final counts
    $finalActiveStmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE user_type = 'student' AND status = 'Active'");
    $finalActiveStmt->execute();
    $finalActiveStudents = $finalActiveStmt->fetchColumn();
    
    $finalInactiveStmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE user_type = 'student' AND status = 'Inactive'");
    $finalInactiveStmt->execute();
    $finalInactiveStudents = $finalInactiveStmt->fetchColumn();
    
    $finalArchivedStmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE user_type = 'student' AND status = 'Archived'");
    $finalArchivedStmt->execute();
    $finalArchivedStudents = $finalArchivedStmt->fetchColumn();
    
    // Count treasurers after transition
    $countTreasurersAfter = $pdo->prepare("
        SELECT COUNT(*) FROM users 
        WHERE user_type = 'student' 
        AND role = 'treasurer'
    ");
    $countTreasurersAfter->execute();
    $treasurersAfter = $countTreasurersAfter->fetchColumn();

    $pdo->commit();

    echo json_encode([
        "success"  => true,
        "message"  => "Academic year activated successfully.",
        "activated_ay_id" => (int)$target['id'],
        "activated_span"  => [
            "start_year" => $targetStart,
            "end_year"   => $targetEnd,
            "school_year" => $newSchoolYear
        ],
        "direction" => $direction,
        "student_transitions" => $studentTransitionDetails,
        "role_management" => [
            "treasurers_before" => $treasurersBefore ?? 0,
            "treasurers_after" => $treasurersAfter,
            "note" => $isMovingForward ? 
                "Treasurer roles reset for new academic year" : 
                ($isMovingBackward ? "Treasurer roles restored from organization records" : "No role changes")
        ],
        "final_student_counts" => [
            "active" => $finalActiveStudents,
            "inactive" => $finalInactiveStudents,
            "archived" => $finalArchivedStudents
        ],
        "organization_transitions" => [
            "marked_for_reaccreditation" => $markedPrev,
            "years_updated" => $orgsYearsUpdated,
            "status_restored" => [
                "reaccredited" => $restoredReaccredited,
                "accredited" => $restoredAccredited
            ]
        ],
        "year_level_progression" => [
            "4_year_programs" => $fourYearPrograms,
            "5_year_program" => $fiveYearProgram,
            "progression_4_year" => "First Year → Second Year → Third Year → Fourth Year",
            "progression_5_year" => "First Year → Second Year → Third Year → Fourth Year → Fifth Year"
        ]
    ]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }

    echo json_encode([
        "success" => false,
        "message" => "Error: " . $e->getMessage()
    ]);
}
?>