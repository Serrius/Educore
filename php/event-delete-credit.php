<?php
require __DIR__.'/event-expenses-util.php';
require_auth(['admin','super-admin','treasurer']);
$pdo = db();
$id = (int)($_POST['id'] ?? 0);
if ($id <= 0) jerr(422,'Invalid id.');
$pdo->prepare("DELETE FROM event_credits WHERE id=?")->execute([$id]);
jok();
