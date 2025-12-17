<?php
// php/records-print-org-fee.php
// Single Organization Fee Receipt (PDF, compact layout like JS print)

declare(strict_types=1);

ini_set('display_errors', '1');
error_reporting(E_ALL);

session_start();

require __DIR__ . '/database.php';
require __DIR__ . '/../vendor/autoload.php';

use Mpdf\Mpdf;

function h($s): string {
    return htmlspecialchars((string)($s ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
function peso($n): string {
    return '₱' . number_format((float)$n, 2, '.', ',');
}

// ----------------- Auth (optional) -----------------
if (empty($_SESSION['id_number'])) {
    http_response_code(401);
    echo 'Not authenticated.';
    exit;
}

// ----------------- Input -----------------
$paymentId = isset($_GET['payment_id']) ? (int)$_GET['payment_id'] : 0;
if (!$paymentId && isset($_GET['id'])) {
    $paymentId = (int)$_GET['id'];
}
$receiptNoParam = isset($_GET['receipt_no']) ? trim((string)$_GET['receipt_no']) : '';

if ($paymentId <= 0 && $receiptNoParam === '') {
    http_response_code(400);
    echo 'Missing payment_id / id / receipt_no.';
    exit;
}

if (!isset($pdo)) {
    http_response_code(500);
    echo 'DB connection not available.';
    exit;
}

// ----------------- Fetch data (real tables) -----------------
$sql = "
    SELECT
        p.id                       AS payment_id,
        p.org_fee_id,
        p.org_id,
        p.payer_id_number,
        p.receipt_no,
        p.paid_amount,
        p.active_year,
        p.start_year,
        p.end_year,
        p.paid_on,
        p.payment_method,
        p.notes,
        p.status,

        f.title        AS fee_title,
        f.description  AS fee_description,
        f.amount       AS fee_original_amount,
        f.fee_category,
        f.currency,

        o.name         AS org_name,
        o.abbreviation AS org_abbr,
        o.logo_path    AS org_logo_path,

        u.first_name,
        u.middle_name,
        u.last_name,
        u.suffix,
        u.id_number    AS user_id_number
    FROM organization_fee_payments p
    INNER JOIN organization_fees f
        ON f.id = p.org_fee_id
    INNER JOIN organizations o
        ON o.id = p.org_id
    LEFT JOIN users u
        ON u.id_number = p.payer_id_number
    WHERE 1 = 1
";

$params = [];
if ($paymentId > 0) {
    $sql .= " AND p.id = :pid";
    $params[':pid'] = $paymentId;
} else {
    $sql .= " AND p.receipt_no = :rno";
    $params[':rno'] = $receiptNoParam;
}

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$row = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$row) {
    http_response_code(404);
    echo 'Payment record not found.';
    exit;
}

// ----------------- Map / format data -----------------
$orgName     = $row['org_name'] ?? 'Organization';
$orgAbbr     = $row['org_abbr'] ?? '';
$orgLogoPath = $row['org_logo_path'] ?? '';

$feeTitle = $row['fee_title'] ?: 'Organization Membership Fee';
$feeDesc  = $row['fee_description'] ?: $feeTitle;

$paidAmount    = (float)$row['paid_amount'];
$paidAmountStr = peso($paidAmount);
$receiptNo     = $row['receipt_no'] ?: '—';

$fn = $row['first_name'] ?? '';
$mn = $row['middle_name'] ?? '';
$ln = $row['last_name'] ?? '';
$sx = $row['suffix'] ?? '';
$fullName = trim(
    $fn . ' ' .
    ($mn !== '' ? mb_substr($mn, 0, 1) . '. ' : '') .
    $ln . ' ' .
    $sx
);
if ($fullName === '') {
    $fullName = '—';
}

$payerId = $row['payer_id_number'] ?? '—';

// AY + sem
$sy = $row['start_year'] ? (int)$row['start_year'] : null;
$ey = $row['end_year']   ? (int)$row['end_year']   : null;
$ay = $row['active_year'] ? (int)$row['active_year'] : null;

$syText = ($sy && $ey) ? ($sy . '–' . $ey) : '—';

$semLabel = null;
if ($sy && $ey && $ay) {
    if ($ay === $sy) {
        $semLabel = '1st Semester';
    } elseif ($ay === $ey) {
        $semLabel = '2nd Semester';
    }
}
$ayText = $semLabel
    ? ($semLabel . ', AY ' . $syText)
    : ('AY ' . $syText);

// Paid date
$paidOnRaw = $row['paid_on'] ?: date('Y-m-d');
try {
    $dtPaid = new DateTime($paidOnRaw);
    $paidOnText = $dtPaid->format('F j, Y'); // November 25, 2025
} catch (Throwable $e) {
    $paidOnText = $paidOnRaw;
}

// Payment method
$methodRaw = strtolower((string)($row['payment_method'] ?? 'cash'));
switch ($methodRaw) {
    case 'online':
        $methodLabel = 'Online';
        break;
    case 'other':
        $methodLabel = 'Other';
        break;
    default:
        $methodLabel = 'Cash';
}

// Status
$statusRaw = strtolower((string)($row['status'] ?? 'recorded'));
if ($statusRaw === 'confirmed') {
    $statusLabel = 'Paid';
} elseif ($statusRaw === 'void') {
    $statusLabel = 'Void';
} else {
    $statusLabel = ucfirst($statusRaw);
}

$notes = trim((string)($row['notes'] ?? ''));

// ----------------- Org logo (base64 so mPDF sees it) -----------------
$orgLogoHtml = '';
if ($orgLogoPath !== '') {
    // Example stored path: uploads/accreditation/2025/1/org_logo_org1_xxx.jpg
    $fsPath = realpath(__DIR__ . '/../' . ltrim($orgLogoPath, '/'));
    if ($fsPath && is_file($fsPath)) {
        $ext = strtolower(pathinfo($fsPath, PATHINFO_EXTENSION));
        if ($ext === 'jpg') {
            $ext = 'jpeg';
        }
        $mime = 'image/' . $ext;
        $data = base64_encode(file_get_contents($fsPath));
        $orgLogoHtml = '<img src="data:' . $mime . ';base64,' . $data . '" class="org-logo" alt="Logo">';
    }
}

// ----------------- Pre-escaped values for HEREDOC -----------------
$orgNameEsc       = h($orgName);
$orgAbbrEsc       = h($orgAbbr);
$syTextEsc        = h($syText);
$receiptNoEsc     = h($receiptNo);
$fullNameEsc      = h($fullName);
$payerIdEsc       = h($payerId);
$feeDescEsc       = h($feeDesc);
$ayTextEsc        = h($ayText);
$paidOnTextEsc    = h($paidOnText);
$methodLabelEsc   = h($methodLabel);
$statusLabelEsc   = h($statusLabel);
$paidAmountStrEsc = h($paidAmountStr);
$notesEsc         = h($notes);
$generatedTextEsc = h(date('F j, Y'));

// ----------------- HTML (table-based layout for mPDF) -----------------
$html = <<<HTML
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt #{$receiptNoEsc}</title>
  <style>
    @page {
      /* mPDF page format is set in PHP; here we only keep small margins */
      margin: 5mm;
    }
    * { box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      margin: 0;                 /* IMPORTANT: remove big margin to avoid pushing down */
      font-size: 13px;
      color: #222;
    }
    .receipt-wrapper {
      width: 100%;               /* fill the small page */
      margin: 0;
      border: 1px solid #ccc;
      padding: 12px 16px;        /* reduced padding */
    }

    /* HEADER TABLE */
    .header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;       /* smaller spacing */
      border-bottom: 1px solid #ddd;
      padding-bottom: 6px;
    }
    .header-table td {
      vertical-align: top;
      padding: 0;
    }
    .header-left {
      width: 65%;
    }
    .header-right {
      width: 35%;
      text-align: right;
    }

    .header-org-table {
      width: 100%;
      border-collapse: collapse;
    }
    .header-org-table td {
      vertical-align: top;
      padding: 0;
    }
    .logo-cell {
      width: 50px;
      text-align: left;
    }
    .org-logo {
      max-width: 45px;
      max-height: 45px;
      object-fit: contain;
      display: block;
    }
    .org-text-cell {
      padding-left: 6px;
    }
    .org-name {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
    }
    .org-sub {
      font-size: 10px;
      color: #666;
      margin-top: 2px;
      margin-bottom: 0;
      line-height: 1.3;
    }

    .receipt-title {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
    }
    .receipt-meta {
      font-size: 10px;
      color: #555;
      margin-top: 3px;
      line-height: 1.3;
    }

    .meta-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      margin-bottom: 6px;
    }
    .meta-table td {
      padding: 2px 0;
      vertical-align: top;
      font-size: 11px;
    }
    .meta-label {
      width: 120px;
      font-weight: 600;
    }
    .amount-box {
      margin-top: 10px;
      border-top: 1px dashed #ccc;
      padding-top: 8px;
      display: table;
      width: 100%;
    }
    .amount-label {
      font-size: 12px;
      font-weight: 600;
      display: table-cell;
      vertical-align: middle;
    }
    .amount-value {
      font-size: 15px;
      font-weight: 700;
      display: table-cell;
      text-align: right;
      vertical-align: middle;
    }

    .footer-note {
      margin-top: 12px;
      font-size: 10px;
      color: #666;
      text-align: center;
    }

    /* SIGNATURE AREA */
    .sign-table {
      width: 100%;
      margin-top: 20px;
      border-collapse: collapse;
    }
    .sign-table td {
      text-align: center;
      vertical-align: bottom;
      padding-top: 6px;
    }
    .sign-line {
      width: 160px;
      margin: 0 auto 4px auto;
      font-size: 13px;
      letter-spacing: 1px;
      font-family: "Courier New", monospace;
    }
    .sign-label {
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="receipt-wrapper">
    <!-- HEADER -->
    <table class="header-table">
      <tr>
        <td class="header-left">
          <table class="header-org-table">
            <tr>
              <td class="logo-cell">
                {$orgLogoHtml}
              </td>
              <td class="org-text-cell">
                <p class="org-name">{$orgNameEsc}</p>
                <p class="org-sub">
                  {$orgAbbrEsc}<br/>
                  School Year: {$syTextEsc}
                </p>
              </td>
            </tr>
          </table>
        </td>
        <td class="header-right">
          <div class="receipt-title">OFFICIAL RECEIPT</div>
          <div class="receipt-meta">
            No.: {$receiptNoEsc}<br/>
            Generated: {$generatedTextEsc}
          </div>
        </td>
      </tr>
    </table>

    <!-- META INFO -->
    <table class="meta-table">
      <tr>
        <td class="meta-label">Student Name:</td>
        <td>{$fullNameEsc}</td>
      </tr>
      <tr>
        <td class="meta-label">Student ID:</td>
        <td>{$payerIdEsc}</td>
      </tr>
      <tr>
        <td class="meta-label">Organization Fee:</td>
        <td>{$feeDescEsc}</td>
      </tr>
      <tr>
        <td class="meta-label">Academic Term:</td>
        <td>{$ayTextEsc}</td>
      </tr>
      <tr>
        <td class="meta-label">Date Paid:</td>
        <td>{$paidOnTextEsc}</td>
      </tr>
      <tr>
        <td class="meta-label">Payment Method:</td>
        <td>{$methodLabelEsc}</td>
      </tr>
      <tr>
        <td class="meta-label">Status:</td>
        <td>{$statusLabelEsc}</td>
      </tr>
    </table>

    <!-- AMOUNT -->
    <div class="amount-box">
      <div class="amount-label">Amount Paid</div>
      <div class="amount-value">{$paidAmountStrEsc}</div>
    </div>
HTML;

if ($notes !== '') {
    $html .= <<<HTML
    <div style="margin-top:6px;font-size:10px;color:#555;">
      <strong>Notes:</strong> {$notesEsc}
    </div>
HTML;
}

$html .= <<<HTML

    <!-- SIGNATURE -->
    <table class="sign-table">
      <tr>
        <td>
          <div class="sign-line">__________________________</div>
          <div class="sign-label">Authorized Signature</div>
        </td>
      </tr>
    </table>

    <div class="footer-note">
      This is a system-generated receipt. No signature is required if printed from the official portal.
    </div>
  </div>
</body>
</html>
HTML;

// ----------------- mPDF output (small receipt size) -----------------
$mpdf = new Mpdf([
    // Small receipt-like page; height enough for one page
    'format'        => [140, 110], // width x height in mm (adjust if needed)
    'margin_top'    => 5,
    'margin_right'  => 5,
    'margin_bottom' => 5,
    'margin_left'   => 5,
    'tempDir'       => __DIR__ . '/../tmp',
    'margin_header' => 0,
    'margin_footer' => 0,
]);

$mpdf->WriteHTML($html);
$downloadName = 'OrgFeeReceipt_' . preg_replace('/[^0-9A-Za-z_-]+/', '_', $receiptNo) . '.pdf';
$mpdf->Output($downloadName, 'I');
exit;
