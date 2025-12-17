<?php
require __DIR__.'/event-expenses-util.php';
[$actor] = require_auth(['admin','super-admin','treasurer']);

$in = read_json();
$event_id = (int)($in['event_id'] ?? 0);
$date = trim($in['date'] ?? '');
$source = trim($in['source'] ?? '');
$amount = (float)($in['amount'] ?? 0);
$notes  = trim($in['notes'] ?? '');

if ($event_id <= 0 || $date === '' || $source === '' || $amount <= 0) {
  jerr(422,'Missing/invalid fields: event_id, date, source, amount.');
}

$pdo = db();
$chk = $pdo->prepare("SELECT id FROM event_events WHERE id=?");
$chk->execute([$event_id]);
if (!$chk->fetch()) jerr(404,'Event not found.');

$ins = $pdo->prepare("INSERT INTO event_credits (event_id,credit_date,source,notes,amount,recorded_by)
                      VALUES (:eid,:dt,:src,:notes,:amt,:rb)");
$ins->execute([
  ':eid'=>$event_id, ':dt'=>$date, ':src'=>$source, ':notes'=>$notes, ':amt'=>$amount, ':rb'=>$actor
]);

$id = (int)$pdo->lastInsertId();
$row = $pdo->prepare("SELECT * FROM event_credits WHERE id=?");
$row->execute([$id]);
jok(['credit'=>$row->fetch()]);
