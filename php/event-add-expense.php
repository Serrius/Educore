<?php
require __DIR__.'/event-expenses-util.php';
[$actor] = require_auth(['admin','super-admin','treasurer']);

$pdo = db();

// Detect content type: JSON vs multipart/form-data
$contentType = $_SERVER['CONTENT_TYPE'] ?? '';

// Defaults
$event_id = 0;
$date     = '';
$category = '';
$amount   = 0.0;
$unit_price = 0.0;
$notes    = '';
$receiptRelPath = null;
$receipt_number = '';
$quantity = 1;

// ======================= JSON MODE (current JS) ==========================
if (stripos($contentType, 'application/json') !== false) {
    // Expect JSON (read_json() also supports x-www-form-urlencoded if ever needed)
    $in = read_json();

    $event_id = (int)($in['event_id'] ?? 0);
    $date     = trim($in['date'] ?? '');
    $category = trim($in['category'] ?? ($in['source'] ?? '')); // "source" kept for backward-compat
    $amount   = (float)($in['amount'] ?? 0);
    $unit_price = (float)($in['unit_price'] ?? 0);
    $notes    = trim($in['notes'] ?? '');
    $receipt_number = trim($in['receipt_number'] ?? '');
    $quantity = (int)($in['quantity'] ?? 1);

    // NOTE: no file support in JSON mode
}
// =================== FORM-DATA MODE (file upload) =======================
else {
    // Accept standard POST + $_FILES (e.g., from FormData / multipart/form-data)
    $event_id = (int)($_POST['event_id'] ?? 0);
    $date     = trim($_POST['date'] ?? '');
    $category = trim($_POST['category'] ?? ($_POST['source'] ?? ''));
    $amount   = (float)($_POST['amount'] ?? 0);
    $unit_price = (float)($_POST['unit_price'] ?? 0);
    $notes    = trim($_POST['notes'] ?? '');
    $receipt_number = trim($_POST['receipt_number'] ?? '');
    $quantity = (int)($_POST['quantity'] ?? 1);

    // Handle optional receipt upload
    if (!empty($_FILES['receipt']['name']) && is_uploaded_file($_FILES['receipt']['tmp_name'])) {
        $origName = $_FILES['receipt']['name'];
        $ext      = strtolower(pathinfo($origName, PATHINFO_EXTENSION));

        // Allow basic image/PDF types
        $allowedExt = ['jpg','jpeg','png','gif','pdf'];
        if (in_array($ext, $allowedExt, true)) {
            $uploadDir = dirname(__DIR__) . '/uploads/event_receipts';
            if (!is_dir($uploadDir)) {
                @mkdir($uploadDir, 0775, true);
            }

            $base = preg_replace('/[^a-zA-Z0-9_\-\.]+/', '_', pathinfo($origName, PATHINFO_FILENAME));
            $fileName = 'evrc_' . time() . '_' . mt_rand(1000, 9999) . '_' . $base . '.' . $ext;
            $fullPath = $uploadDir . '/' . $fileName;

            if (move_uploaded_file($_FILES['receipt']['tmp_name'], $fullPath)) {
                // What we'll store in DB (relative to web root)
                $receiptRelPath = 'uploads/event_receipts/' . $fileName;
            }
        }
    }
}

// ============================ Validation ================================
if ($event_id <= 0 || $date === '' || $category === '' || $quantity <= 0) {
    jerr(422, 'Missing/invalid fields: event_id, date, category, quantity.');
}

// Calculate amount if not provided but unit_price is provided
if ($amount <= 0 && $unit_price > 0) {
    $amount = $unit_price * $quantity;
} elseif ($amount > 0 && $unit_price <= 0 && $quantity > 0) {
    // Calculate unit_price from amount and quantity
    $unit_price = $amount / $quantity;
} elseif ($amount <= 0 && $unit_price <= 0) {
    jerr(422, 'Either amount or unit_price must be provided.');
}

// Ensure event exists
$chk = $pdo->prepare('SELECT id FROM event_events WHERE id = ?');
$chk->execute([$event_id]);
if (!$chk->fetch()) {
    jerr(404, 'Event not found.');
}

// ============================ Insert Row ================================
$ins = $pdo->prepare("
    INSERT INTO event_debits (
        event_id,
        debit_date,
        category,
        notes,
        amount,
        unit_price,
        quantity,
        receipt_number,
        recorded_by,
        receipt_path
    )
    VALUES (
        :eid,
        :dt,
        :cat,
        :notes,
        :amt,
        :unit,
        :qty,
        :rcpt_no,
        :rb,
        :rp
    )
");

$ins->execute([
    ':eid'     => $event_id,
    ':dt'      => $date,
    ':cat'     => $category,
    ':notes'   => $notes,
    ':amt'     => $amount,
    ':unit'    => $unit_price,
    ':qty'     => $quantity,
    ':rcpt_no' => $receipt_number,
    ':rb'      => $actor,
    ':rp'      => $receiptRelPath, // can be null if no file
]);

$id  = (int)$pdo->lastInsertId();
$row = $pdo->prepare('SELECT * FROM event_debits WHERE id = ?');
$row->execute([$id]);

// JS should treat this as a debit/expense entry
jok(['expense' => $row->fetch()]);