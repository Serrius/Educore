<?php
// php/export-records-pdf.php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Mpdf\Mpdf;
use Mpdf\HTMLParserMode;

// --- 1. Read incoming POST data from JS ---

$title   = isset($_POST['title'])   ? trim((string)$_POST['title'])   : 'Report';
$content = isset($_POST['content']) ? (string)$_POST['content']       : '';
$type    = isset($_POST['type'])    ? trim((string)$_POST['type'])    : '';

// Basic guard
if ($content === '') {
    http_response_code(400);
    echo 'No content provided for PDF.';
    exit;
}

// --- 2. Build mPDF instance with proper margins (for letterhead) ---

$mpdf = new Mpdf([
    'format'        => 'A4',
    'margin_left'   => 20,  // mm
    'margin_right'  => 20,
    'margin_top'    => 60,  // reserve space for header image
    'margin_bottom' => 40,  // reserve space for footer image
    'margin_header' => 0,
    'margin_footer' => 0,
    'tempDir'       => __DIR__ . '/../tmp', // make sure this exists / is writable
]);

// --- 3. Define header & footer images (your split PNGs) ---

$headerPath = realpath(__DIR__ . '/../assets/templates/letterhead-header.png');
$footerPath = realpath(__DIR__ . '/../assets/templates/letterhead-footer.png');

$headerHtml = '';
$footerHtml = '';

if ($headerPath && is_file($headerPath)) {
    // Use full file path so mPDF can load it
    $headerHtml = '
        <div style="text-align:center;">
          <img src="' . $headerPath . '" style="width:100%; height:auto;" />
        </div>
    ';
}

if ($footerPath && is_file($footerPath)) {
    $footerHtml = '
        <div style="text-align:center;">
          <img src="' . $footerPath . '" style="width:100%; height:auto;" />
        </div>
    ';
}

// Attach header/footer to every page
if ($headerHtml !== '') {
    $mpdf->SetHTMLHeader($headerHtml);
}
if ($footerHtml !== '') {
    $mpdf->SetHTMLFooter($footerHtml);
}

// --- 4. Base stylesheet for the records reports ---
// This matches the HTML structure produced by records.js

$stylesheet = <<<CSS
body {
  font-family: Arial, sans-serif;
  font-size: 11pt;
  color: #222;
}

/* Generic report header */
.report-header {
  text-align: center;
  margin-bottom: 16px;
}
.report-header h2 {
  margin: 0 0 4px 0;
  font-size: 16pt;
  text-transform: uppercase;
  letter-spacing: 0.5pt;
}
.report-meta {
  font-size: 9pt;
  color: #555;
}
.report-meta div {
  margin: 2px 0;
}

/* Section titles */
.section-title {
  margin-top: 12pt;
  margin-bottom: 6pt;
  font-size: 11pt;
  font-weight: bold;
  text-transform: uppercase;
}

/* Tables */
.summary-table,
.records-table,
.expenses-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 12pt;
}

.summary-table th,
.summary-table td,
.records-table th,
.records-table td,
.expenses-table th,
.expenses-table td {
  border: 0.2mm solid #999;
  padding: 3pt 4pt;
  vertical-align: top;
  font-size: 9pt;
}

.summary-table th,
.records-table th,
.expenses-table th {
  background: #f2f2f2;
  font-weight: bold;
}

.records-table td.amount-cell,
.expenses-table td.amount-cell {
  text-align: right;
  white-space: nowrap;
}

.text-end {
  text-align: right;
}

.no-data {
  font-style: italic;
  color: #777;
  margin-top: 4pt;
}

/* Footer note */
.footer-note {
  margin-top: 12pt;
  font-size: 8pt;
  color: #666;
  text-align: right;
}

/* Event meta block (event expenses) */
.event-meta {
  width: 100%;
  margin: 6pt 0 8pt;
  font-size: 9pt;
}
.event-meta .col {
  width: 50%;
}
.event-meta div {
  margin-bottom: 2pt;
}

/* Simple alert styles for balances */
.alert {
  padding: 4pt 6pt;
  border-radius: 2pt;
  font-size: 9pt;
}
.alert-success {
  border: 0.2mm solid #2e7d32;
  background-color: #e8f5e9;
}
.alert-danger {
  border: 0.2mm solid #c62828;
  background-color: #ffebee;
}

/* Heading-like text (used in some summaries) */
.h5 {
  font-size: 11pt;
  margin: 0;
}

/* Prevent rows from being split across pages */
table tbody tr {
  page-break-inside: avoid;
}

/* Repeat table headers on each page when possible */
table thead {
  display: table-header-group;
}
CSS;

// --- 5. Render PDF ---

$mpdf->SetTitle($title);
$mpdf->WriteHTML($stylesheet, HTMLParserMode::HEADER_CSS);
$mpdf->WriteHTML($content,   HTMLParserMode::HTML_BODY);

// Output: inline (view in browser tab)
$filename = preg_replace('/[^A-Za-z0-9_\-]+/', '_', $title) . '.pdf';
$mpdf->Output($filename, \Mpdf\Output\Destination::INLINE);
