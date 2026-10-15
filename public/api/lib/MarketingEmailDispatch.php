<?php
// Direct HTTP access blocked (nginx may ignore .htaccess)
if (PHP_SAPI !== 'cli' && isset($_SERVER['SCRIPT_FILENAME']) && @realpath((string)$_SERVER['SCRIPT_FILENAME']) === @realpath(__FILE__)) { http_response_code(403); header('Content-Type: text/plain; charset=UTF-8'); echo 'Forbidden'; exit; }
/**
 * Marketing email campaign dispatch: <<placeholders>>, per-recipient schedule, org mailbox.
 */

/** Turn encoded / split placeholder delimiters into literal << >>. */
function marketingUnescapePlaceholderDelimiters(string $text): string
{
    $prev = '';
    for ($i = 0; $i < 3 && $text !== $prev; $i++) {
        $prev = $text;
        $text = str_ireplace(
            ['&amp;lt;&amp;lt;', '&amp;gt;&amp;gt;'],
            ['&lt;&lt;', '&gt;&gt;'],
            $text
        );
        $text = str_ireplace(
            ['&lt;&lt;', '&#60;&#60;', '&#060;&#060;', '&#x3c;&#x3c;', '%3C%3C'],
            '<<',
            $text
        );
        $text = str_ireplace(
            ['&gt;&gt;', '&#62;&#62;', '&#062;&#062;', '&#x3e;&#x3e;', '%3E%3E'],
            '>>',
            $text
        );
        $text = str_ireplace(['&lt;<', '&#60;<'], '<<', $text);
        $text = str_ireplace(['>&gt;', '>&#62;'], '>>', $text);
    }
    $text = str_replace(["\u{200B}", "\u{200C}", "\u{200D}", "\u{FEFF}"], '', $text);
    $text = str_replace(['＜', '＞'], ['<', '>'], $text);
    return $text;
}

function marketingPlaceholderKeyFromInner(string $inner): ?string
{
    $inner = html_entity_decode($inner, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $inner = strip_tags($inner);
    $inner = str_replace(["\u{200B}", "\u{200C}", "\u{200D}", "\u{FEFF}", "\u{00A0}"], ['', '', '', '', ' '], $inner);
    $inner = trim(preg_replace('/\s+/', '', $inner) ?? $inner);
    if ($inner === '' || !preg_match('/^[A-Za-z][A-Za-z0-9_]*$/', $inner)) {
        return null;
    }
    return $inner;
}

function marketingExtractAnglePlaceholders(string ...$texts): array
{
    $seen = [];
    $out = [];
    foreach ($texts as $text) {
        if (!is_string($text) || $text === '') {
            continue;
        }
        $scan = marketingUnescapePlaceholderDelimiters($text);
        if (!preg_match_all('/<<((?:(?!>>).)*)>>/s', $scan, $m)) {
            continue;
        }
        foreach ($m[1] as $inner) {
            $key = marketingPlaceholderKeyFromInner((string) $inner);
            if ($key === null) {
                continue;
            }
            $lk = strtolower($key);
            if ($lk === '' || isset($seen[$lk])) {
                continue;
            }
            $seen[$lk] = true;
            $out[] = $key;
        }
    }
    return $out;
}

/**
 * @param array<string, mixed> $values
 */
function marketingFillAnglePlaceholders(string $text, array $values): string
{
    $map = [];
    foreach ($values as $k => $v) {
        $lk = strtolower(trim((string) $k));
        if ($lk === '') {
            continue;
        }
        $map[$lk] = (string) $v;
    }
    $text = marketingUnescapePlaceholderDelimiters($text);
    $filled = preg_replace_callback(
        '/<<((?:(?!>>).)*)>>/s',
        static function (array $m) use ($map) {
            $key = marketingPlaceholderKeyFromInner((string) ($m[1] ?? ''));
            if ($key === null) {
                return (string) ($m[0] ?? '');
            }
            $lk = strtolower($key);
            if (!array_key_exists($lk, $map)) {
                return (string) ($m[0] ?? '');
            }
            return htmlspecialchars($map[$lk], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        },
        $text
    );
    return is_string($filled) ? $filled : $text;
}

function marketingParseScheduleAt(?string $raw): ?string
{
    $raw = trim((string) $raw);
    if ($raw === '') {
        return null;
    }
    $raw = str_replace('T', ' ', $raw);
    if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $raw)) {
        $raw .= ':00';
    }
    try {
        $dt = new DateTimeImmutable($raw);
        return $dt->format('Y-m-d H:i:s');
    } catch (Throwable $e) {
        return null;
    }
}

function marketingScheduleIsDue(?string $mysqlDatetime, int $graceSeconds = 30): bool
{
    if ($mysqlDatetime === null || trim($mysqlDatetime) === '') {
        return true;
    }
    try {
        $when = new DateTimeImmutable($mysqlDatetime);
        $now = new DateTimeImmutable('now');
        return $when->getTimestamp() <= ($now->getTimestamp() + $graceSeconds);
    } catch (Throwable $e) {
        return true;
    }
}

/** Completed only when every row was sent. Partial when some were. Failed when none were. */
function marketingCampaignStatusFromCounts(int $sent, int $failed, int $pending, int $sending = 0): string
{
    $total = $sent + $failed + $pending + $sending;
    if ($total > 0 && $sent === $total) {
        return 'completed';
    }
    if ($sending > 0) {
        return 'sending';
    }
    if ($sent === 0 && $failed === 0 && $pending > 0) {
        return 'scheduled';
    }
    if ($sent > 0) {
        return 'partial';
    }
    return 'failed';
}

/**
 * Recount each campaign from its email log.
 * A row is sent only when status is sent and sent_at is a real time.
 *
 * @param array<int, array<string, mixed>> $rows
 */
function marketingApplyEmailCampaignLogStatus(PDO $db, array &$rows): void
{
    if ($rows === []) {
        return;
    }
    marketingEnsureEmailDispatchSchema($db);
    $ids = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $id = trim((string) ($row['id'] ?? ''));
        if ($id !== '') {
            $ids[] = $id;
        }
    }
    if ($ids === []) {
        return;
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    try {
        $agg = $db->prepare(
            "SELECT campaign_id,
                COUNT(*) AS total_count,
                SUM(CASE WHEN status = 'sent' AND sent_at IS NOT NULL AND sent_at > '1970-01-02 00:00:00' THEN 1 ELSE 0 END) AS sent_count,
                SUM(CASE WHEN status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at > NOW() THEN 1 ELSE 0 END) AS pending_count,
                SUM(CASE WHEN status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= NOW()) THEN 1 ELSE 0 END) AS sending_count
             FROM email_sends
             WHERE campaign_id IN ($placeholders)
             GROUP BY campaign_id"
        );
        $agg->execute($ids);
    } catch (Throwable $e) {
        error_log('[marketingApplyEmailCampaignLogStatus] ' . $e->getMessage());
        return;
    }
    $byId = [];
    foreach ($agg->fetchAll(PDO::FETCH_ASSOC) as $c) {
        if (!is_array($c)) {
            continue;
        }
        $byId[(string) ($c['campaign_id'] ?? '')] = $c;
    }
    foreach ($rows as &$row) {
        if (!is_array($row)) {
            continue;
        }
        $id = trim((string) ($row['id'] ?? ''));
        $c = $byId[$id] ?? null;
        $total = is_array($c) ? (int) ($c['total_count'] ?? 0) : 0;
        $sent = is_array($c) ? (int) ($c['sent_count'] ?? 0) : 0;
        $pending = is_array($c) ? (int) ($c['pending_count'] ?? 0) : 0;
        $sending = is_array($c) ? (int) ($c['sending_count'] ?? 0) : 0;
        $failed = max(0, $total - $sent - $pending - $sending);
        $row['sent_count'] = $sent;
        $row['failed_count'] = $failed;
        $row['pending_count'] = $pending + $sending;
        if ($total > 0) {
            $row['recipient_count'] = $total;
        }
        $row['status'] = $total === 0 ? 'failed' : marketingCampaignStatusFromCounts($sent, $failed, $pending, $sending);
    }
    unset($row);
}

function marketingEnsureEmailDispatchSchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $add = static function (PDO $db, string $table, string $column, string $sql) {
        if (function_exists('syncpediaColumnExists') && syncpediaColumnExists($db, $table, $column)) {
            return;
        }
        try {
            $db->exec($sql);
        } catch (Throwable $e) {
            /* already exists / older engine */
        }
    };
    $add($db, 'email_campaigns', 'smtp_account_id', 'ALTER TABLE email_campaigns ADD COLUMN smtp_account_id CHAR(36) DEFAULT NULL');
    $add($db, 'email_campaigns', 'scheduled_at', 'ALTER TABLE email_campaigns ADD COLUMN scheduled_at DATETIME DEFAULT NULL');
    $add($db, 'email_sends', 'scheduled_at', 'ALTER TABLE email_sends ADD COLUMN scheduled_at DATETIME DEFAULT NULL');
    $add($db, 'email_sends', 'sent_subject', 'ALTER TABLE email_sends ADD COLUMN sent_subject VARCHAR(500) DEFAULT NULL');
    $add($db, 'email_sends', 'sent_html', 'ALTER TABLE email_sends ADD COLUMN sent_html LONGTEXT DEFAULT NULL');
    $add($db, 'email_sends', 'values_json', 'ALTER TABLE email_sends ADD COLUMN values_json TEXT DEFAULT NULL');
    $add($db, 'email_sends', 'smtp_account_id', 'ALTER TABLE email_sends ADD COLUMN smtp_account_id CHAR(36) DEFAULT NULL');
    $add($db, 'email_drafts', 'attachment_path', 'ALTER TABLE email_drafts ADD COLUMN attachment_path VARCHAR(500) DEFAULT NULL');
    $add($db, 'email_drafts', 'attachment_name', 'ALTER TABLE email_drafts ADD COLUMN attachment_name VARCHAR(255) DEFAULT NULL');
    try {
        $db->exec('CREATE INDEX idx_es_pending_due ON email_sends (status, scheduled_at)');
    } catch (Throwable $e) {
        /* ignore */
    }
    $done = true;
}

/**
 * @return array{id:string,email:string,from_name:string,label:string,slot:int}|null
 */
function marketingLoadOrgMailbox(PDO $db, string $orgId, string $accountId): ?array
{
    if ($orgId === '' || $accountId === '') {
        return null;
    }
    if (function_exists('syncpediaEnsureOrgEmailSchema')) {
        syncpediaEnsureOrgEmailSchema($db);
    }
    $st = $db->prepare(
        'SELECT id, slot, label, email, from_name FROM org_smtp_accounts
         WHERE org_id = ? AND id = ? AND is_active = 1 LIMIT 1'
    );
    $st->execute([$orgId, $accountId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return null;
    }
    $email = strtolower(trim((string) ($row['email'] ?? '')));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return null;
    }
    return [
        'id' => (string) ($row['id'] ?? ''),
        'email' => $email,
        'from_name' => trim((string) ($row['from_name'] ?? '')),
        'label' => trim((string) ($row['label'] ?? '')),
        'slot' => (int) ($row['slot'] ?? 0),
    ];
}

function marketingEmailDraftPdfMaxBytes(): int
{
    return 50 * 1024 * 1024;
}

function marketingEmailDraftPdfName(string $original): string
{
    $base = basename(str_replace('\\', '/', $original));
    $base = preg_replace('/[^A-Za-z0-9._ -]/', '_', $base) ?? '';
    $base = trim((string) $base, '. ');
    if ($base === '' || strtolower(substr($base, -4)) !== '.pdf') {
        $base = ($base !== '' ? preg_replace('/\.pdf$/i', '', $base) : 'attachment') . '.pdf';
    }
    if (strlen($base) > 180) {
        $base = substr($base, 0, 176) . '.pdf';
    }
    return $base;
}

function marketingRemoveEmailDraftAttachmentFile(?string $rel): void
{
    $rel = trim((string) $rel);
    if ($rel === '' || strpos($rel, '..') !== false || strpos($rel, '/uploads/email_drafts/') !== 0) {
        return;
    }
    if (!function_exists('peaklyyResolveUploadFsPath')) {
        return;
    }
    $fs = peaklyyResolveUploadFsPath($rel);
    if ($fs !== null && is_file($fs)) {
        @unlink($fs);
    }
}

/**
 * @param array<string, mixed> $file
 * @return array{ok:bool,path?:string,name?:string,error?:string}
 */
function marketingSaveEmailDraftPdf(array $file, string $draftId): array
{
    if (!preg_match('/^[0-9a-fA-F-]{36}$/', $draftId)) {
        return ['ok' => false, 'error' => 'Invalid draft'];
    }
    $err = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
    if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
        return ['ok' => false, 'error' => 'PDF must be 50 MB or smaller.'];
    }
    if ($err === UPLOAD_ERR_NO_FILE) {
        return ['ok' => false, 'error' => 'Choose a PDF to attach.'];
    }
    if ($err !== UPLOAD_ERR_OK) {
        return ['ok' => false, 'error' => 'PDF upload failed.'];
    }
    $tmp = (string) ($file['tmp_name'] ?? '');
    if ($tmp === '' || !is_uploaded_file($tmp)) {
        return ['ok' => false, 'error' => 'Invalid PDF upload.'];
    }
    $size = (int) ($file['size'] ?? 0);
    if ($size <= 0 || $size > marketingEmailDraftPdfMaxBytes()) {
        return ['ok' => false, 'error' => 'PDF must be 50 MB or smaller.'];
    }
    $display = marketingEmailDraftPdfName((string) ($file['name'] ?? 'attachment.pdf'));
    if (strtolower(substr($display, -4)) !== '.pdf') {
        return ['ok' => false, 'error' => 'Attachment must be a PDF.'];
    }
    $mime = '';
    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = (string) ($finfo->file($tmp) ?: '');
    }
    if ($mime !== '' && !in_array($mime, ['application/pdf', 'application/x-pdf'], true)) {
        return ['ok' => false, 'error' => 'Attachment must be a PDF.'];
    }
    $head = '';
    $fh = fopen($tmp, 'rb');
    if ($fh) {
        $head = (string) fread($fh, 5);
        fclose($fh);
    }
    if ($head !== '%PDF-') {
        return ['ok' => false, 'error' => 'Attachment must be a PDF.'];
    }
    $uploadParent = dirname(__DIR__, 2) . '/uploads/email_drafts';
    if (!is_dir($uploadParent) && !mkdir($uploadParent, 0755, true) && !is_dir($uploadParent)) {
        return ['ok' => false, 'error' => 'Cannot store the PDF.'];
    }
    $baseDir = realpath($uploadParent);
    if ($baseDir === false) {
        return ['ok' => false, 'error' => 'Cannot store the PDF.'];
    }
    $destFs = $baseDir . DIRECTORY_SEPARATOR . $draftId . '.pdf';
    $stageFs = $destFs . '.uploading';
    if (is_file($stageFs)) {
        @unlink($stageFs);
    }
    if (!move_uploaded_file($tmp, $stageFs)) {
        return ['ok' => false, 'error' => 'Could not save the PDF.'];
    }
    if (is_file($destFs)) {
        @unlink($destFs);
    }
    if (!rename($stageFs, $destFs)) {
        @unlink($stageFs);
        return ['ok' => false, 'error' => 'Could not save the PDF.'];
    }
    return [
        'ok' => true,
        'path' => '/uploads/email_drafts/' . $draftId . '.pdf',
        'name' => $display,
    ];
}

/**
 * @param array<string, mixed> $draft
 * @return list<array{path?:string,name?:string,missing?:bool}>
 */
function marketingEmailDraftAttachments(array $draft): array
{
    $path = trim((string) ($draft['attachment_path'] ?? ''));
    if ($path === '') {
        return [];
    }
    $name = marketingEmailDraftPdfName((string) ($draft['attachment_name'] ?? 'attachment.pdf'));
    if (strpos($path, '..') !== false || strpos($path, '/uploads/email_drafts/') !== 0) {
        return [['missing' => true, 'name' => $name]];
    }
    $fs = function_exists('peaklyyResolveUploadFsPath') ? peaklyyResolveUploadFsPath($path) : null;
    if ($fs === null) {
        return [['missing' => true, 'name' => $name]];
    }
    return [['path' => $fs, 'name' => $name]];
}

/**
 * @param list<array{path?:string,name?:string,missing?:bool}> $attachments
 * @return array{ok:bool,error?:string,from?:string}
 */
function marketingSendOneCampaignEmail(
    string $orgId,
    string $smtpAccountId,
    string $to,
    string $subject,
    string $html,
    string $fromName = '',
    array $attachments = []
): array {
    foreach ($attachments as $file) {
        if (!empty($file['missing'])) {
            return ['ok' => false, 'error' => 'The PDF attached to this draft is missing, so this message was not sent.'];
        }
    }
    if (function_exists('syncpediaSetMailContext')) {
        syncpediaSetMailContext($orgId !== '' ? $orgId : null, 'marketing_campaigns');
    }
    if (function_exists('syncpediaSetPreferredSmtpAccountId')) {
        syncpediaSetPreferredSmtpAccountId($smtpAccountId !== '' ? $smtpAccountId : null);
    }
    $fromAddr = function_exists('syncpediaSupportMailAddress') ? syncpediaSupportMailAddress() : 'support@syncpedia.in';
    $name = $fromName !== '' ? $fromName : 'Syncpedia';
    if (!function_exists('syncpediaSendHtmlEmailViaSmtpWithOptions')) {
        $transport = dirname(__DIR__) . '/mail_transport.php';
        if (is_file($transport)) {
            require_once $transport;
        }
    }
    if (!function_exists('syncpediaSendHtmlEmailViaSmtpWithOptions')) {
        return ['ok' => false, 'error' => 'Mail transport unavailable'];
    }
    return syncpediaSendHtmlEmailViaSmtpWithOptions($to, $subject, $html, $fromAddr, $name, '', '', $attachments);
}

/**
 * @param array<int, mixed> $recipientsIn
 * @return array{ok:bool,campaign_id?:string,sent:int,failed:int,pending:int,error?:string,message?:string}
 */
function marketingDispatchEmailCampaign(
    PDO $db,
    array $tokenData,
    string $userId,
    string $draftId,
    array $recipientsIn,
    string $smtpAccountId,
    ?string $campaignScheduledAt
): array {
    marketingEnsureEmailDispatchSchema($db);

    $draft = marketingAssertRowInScope($db, 'email_drafts', $draftId, $tokenData);
    $orgId = trim((string) ($draft['org_id'] ?? ''));
    if ($orgId === '') {
        return ['ok' => false, 'sent' => 0, 'failed' => 0, 'pending' => 0, 'error' => 'This draft is not linked to an organization.'];
    }

    $mailbox = marketingLoadOrgMailbox($db, $orgId, $smtpAccountId);
    if ($mailbox === null) {
        return ['ok' => false, 'sent' => 0, 'failed' => 0, 'pending' => 0, 'error' => 'Choose a mailbox from Email Setup (organization emails).'];
    }

    $subjectTpl = (string) ($draft['subject'] ?? $draft['name'] ?? 'Campaign');
    $htmlTpl = (string) ($draft['html_body'] ?? '');
    if ($htmlTpl === '') {
        $htmlTpl = '<p>' . nl2br(htmlspecialchars((string) ($draft['plain_text'] ?? ''), ENT_QUOTES, 'UTF-8')) . '</p>';
    }
    $tokens = marketingExtractAnglePlaceholders($subjectTpl, $htmlTpl);

    $rows = [];
    $seen = [];
    foreach ($recipientsIn as $item) {
        $email = '';
        $values = [];
        $rowSchedule = null;
        if (is_array($item)) {
            $email = trim((string) ($item['recipient_email'] ?? $item['email'] ?? ''));
            $vals = $item['values'] ?? $item['placeholders'] ?? [];
            if (is_array($vals)) {
                foreach ($vals as $k => $v) {
                    $values[(string) $k] = trim((string) $v);
                }
            }
            $rowSchedule = marketingParseScheduleAt(
                (string) ($item['scheduled_at'] ?? $item['schedule'] ?? '')
            );
        } else {
            $email = trim((string) $item);
        }
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            continue;
        }
        $lk = strtolower($email);
        if (isset($seen[$lk])) {
            continue;
        }
        $seen[$lk] = true;
        foreach ($tokens as $tok) {
            $hit = null;
            foreach ($values as $k => $v) {
                if (strcasecmp((string) $k, $tok) === 0) {
                    $hit = $v;
                    break;
                }
            }
            if ($hit === null || trim((string) $hit) === '') {
                return [
                    'ok' => false,
                    'sent' => 0,
                    'failed' => 0,
                    'pending' => 0,
                    'error' => 'Fill <<' . $tok . '>> for ' . $email . ' before sending.',
                ];
            }
            $values[$tok] = (string) $hit;
        }
        $when = $rowSchedule ?: $campaignScheduledAt;
        $filledSubject = marketingFillAnglePlaceholders($subjectTpl, $values);
        $filledHtml = marketingFillAnglePlaceholders($htmlTpl, $values);
        $leftover = marketingExtractAnglePlaceholders($filledSubject, $filledHtml);
        if ($leftover !== []) {
            return [
                'ok' => false,
                'sent' => 0,
                'failed' => 0,
                'pending' => 0,
                'error' => 'Could not replace <<' . $leftover[0] . '>> for ' . $email . '. Enter that value in Send Campaign and try again.',
            ];
        }
        $rows[] = [
            'email' => $email,
            'values' => $values,
            'scheduled_at' => $when,
            'subject' => $filledSubject,
            'html' => $filledHtml,
        ];
    }
    if ($rows === []) {
        return ['ok' => false, 'sent' => 0, 'failed' => 0, 'pending' => 0, 'error' => 'No valid recipient emails'];
    }

    $campaignId = generateUUID();
    $pendingGuess = 0;
    foreach ($rows as $r) {
        if (!marketingScheduleIsDue($r['scheduled_at'])) {
            $pendingGuess++;
        }
    }
    $status = $pendingGuess === count($rows) ? 'scheduled' : ($pendingGuess > 0 ? 'sending' : 'sending');

    $hasSmtpCol = !function_exists('syncpediaColumnExists') || syncpediaColumnExists($db, 'email_campaigns', 'smtp_account_id');
    $hasSchedCol = !function_exists('syncpediaColumnExists') || syncpediaColumnExists($db, 'email_campaigns', 'scheduled_at');
    if ($hasSmtpCol && $hasSchedCol) {
        $db->prepare(
            'INSERT INTO email_campaigns (id, subject, draft_id, recipient_count, pending_count, sent_count, failed_count, status, created_by, org_id, smtp_account_id, scheduled_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
        )->execute([
            $campaignId,
            $subjectTpl,
            $draftId,
            count($rows),
            count($rows),
            0,
            0,
            $status,
            $userId,
            $orgId,
            $mailbox['id'],
            $campaignScheduledAt,
        ]);
    } else {
        $db->prepare(
            'INSERT INTO email_campaigns (id, subject, draft_id, recipient_count, pending_count, sent_count, failed_count, status, created_by, org_id)
             VALUES (?,?,?,?,?,?,?,?,?,?)'
        )->execute([
            $campaignId,
            $subjectTpl,
            $draftId,
            count($rows),
            count($rows),
            0,
            0,
            $status,
            $userId,
            $orgId,
        ]);
    }

    $hasSendExtra = !function_exists('syncpediaColumnExists')
        || (syncpediaColumnExists($db, 'email_sends', 'scheduled_at')
            && syncpediaColumnExists($db, 'email_sends', 'sent_html'));
    if ($hasSendExtra) {
        $sendStmt = $db->prepare(
            'INSERT INTO email_sends (id, campaign_id, recipient_email, status, error_message, scheduled_at, sent_subject, sent_html, values_json, smtp_account_id, sent_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)'
        );
    } else {
        $sendStmt = $db->prepare(
            'INSERT INTO email_sends (id, campaign_id, recipient_email, status, error_message) VALUES (?,?,?,?,?)'
        );
    }

    $sent = 0;
    $failed = 0;
    $pending = 0;
    $queuedNow = 0;
    $firstError = null;

    foreach ($rows as $r) {
        $id = generateUUID();
        $due = marketingScheduleIsDue($r['scheduled_at']);
        if ($due) {
            $queuedNow++;
        } else {
            $pending++;
        }
        if ($hasSendExtra) {
            $sendStmt->execute([
                $id,
                $campaignId,
                $r['email'],
                'pending',
                null,
                $r['scheduled_at'],
                $r['subject'],
                $r['html'],
                json_encode($r['values'], JSON_UNESCAPED_UNICODE),
                $mailbox['id'],
                null,
            ]);
        } else {
            $sendStmt->execute([$id, $campaignId, $r['email'], 'pending', null]);
        }
    }

    $finalStatus = $queuedNow > 0 ? 'sending' : marketingCampaignStatusFromCounts($sent, $failed, $pending, 0);
    $db->prepare('UPDATE email_campaigns SET sent_count = ?, failed_count = ?, pending_count = ?, status = ? WHERE id = ?')
        ->execute([$sent, $failed, $queuedNow + $pending, $finalStatus, $campaignId]);

    if ($sent >= 2) {
        syncpediaNotifyOrgAdminsOfBulkKind(
            $db,
            (string) $userId,
            $orgId !== '' ? $orgId : null,
            'marketing_email',
            (int) $sent
        );
    }
    if ($sent === 0 && $failed > 0 && $pending === 0) {
        $today = (new DateTimeImmutable('now'))->format('Y-m-d');
        syncpediaNotifyOrgAdminsOps(
            $db,
            $orgId !== '' ? $orgId : null,
            'Email SMTP failed',
            'Bulk email campaign sent 0 messages. Check Email Setup / SMTP.',
            '/settings',
            '/settings#smtp-fail-' . $today,
            (string) $userId
        );
    }

    $waiting = $queuedNow + $pending;
    $ok = $waiting > 0;
    $msgParts = [];
    if ($queuedNow > 0) {
        $msgParts[] = "Sending {$queuedNow}";
    }
    if ($pending > 0) {
        $msgParts[] = "{$pending} scheduled";
    }

    return [
        'ok' => $ok,
        'campaign_id' => $campaignId,
        'sent' => $sent,
        'failed' => $failed,
        'pending' => $waiting,
        'queued_now' => $queuedNow,
        'error' => $ok ? null : ($firstError ?: 'No emails were queued.'),
        'message' => $ok
            ? (implode(', ', $msgParts) . ($queuedNow > 0 ? '. You can leave this page; they go out about every 3 seconds.' : ''))
            : ($firstError ?: 'Send failed'),
    ];
}

/** Finish the HTTP response, then send due campaign mail without the 120 second page limit. */
function marketingEchoJsonAndContinue(array $data, int $status = 200): void
{
    ignore_user_abort(true);
    @set_time_limit(0);
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    header('Connection: close');
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        $json = '{"ok":true}';
    }
    header('Content-Length: ' . strlen($json));
    echo $json;
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } else {
        @flush();
    }
}

/**
 * @return array{scanned:int,sent:int,failed:int,skipped:int}
 */
function marketingProcessDueEmailSends(PDO $db, int $limit = 200): array
{
    $out = ['scanned' => 0, 'sent' => 0, 'failed' => 0, 'skipped' => 0];
    $lock = $db->query("SELECT GET_LOCK('syncpedia_mkt_email', 0)");
    $gotLock = 0;
    if ($lock) {
        $gotLock = (int) $lock->fetchColumn();
        $lock->closeCursor();
    }
    if ($gotLock !== 1) {
        return $out;
    }
    try {
        return marketingProcessDueEmailSendsLocked($db, $limit);
    } finally {
        $rel = $db->query("SELECT RELEASE_LOCK('syncpedia_mkt_email')");
        if ($rel) {
            $rel->fetchColumn();
            $rel->closeCursor();
        }
    }
}

/**
 * @return array{scanned:int,sent:int,failed:int,skipped:int}
 */
function marketingProcessDueEmailSendsLocked(PDO $db, int $limit = 200): array
{
    $out = ['scanned' => 0, 'sent' => 0, 'failed' => 0, 'skipped' => 0];
    marketingEnsureEmailDispatchSchema($db);
    if (!function_exists('syncpediaColumnExists') || !syncpediaColumnExists($db, 'email_sends', 'scheduled_at')) {
        return $out;
    }
    require_once __DIR__ . '/../org_email_service.php';
    require_once __DIR__ . '/../mail_transport.php';

    try {
        $st = $db->query(
            "SELECT es.*, ec.org_id AS campaign_org_id, ec.smtp_account_id AS campaign_smtp,
                    ed.attachment_path AS draft_attachment_path, ed.attachment_name AS draft_attachment_name
             FROM email_sends es
             INNER JOIN email_campaigns ec ON ec.id = es.campaign_id
             LEFT JOIN email_drafts ed ON ed.id = ec.draft_id
             WHERE es.status = 'pending'
               AND (es.scheduled_at IS NULL OR es.scheduled_at <= NOW())
             ORDER BY es.scheduled_at ASC
             LIMIT " . max(1, (int) $limit)
        );
        $rows = $st ? $st->fetchAll(PDO::FETCH_ASSOC) : [];
    } catch (Throwable $e) {
        error_log('[marketingProcessDueEmailSends] list: ' . $e->getMessage());
        return $out;
    }

    $upd = $db->prepare('UPDATE email_sends SET status = ?, error_message = ?, sent_at = ? WHERE id = ?');
    $touchedCampaigns = [];

    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $out['scanned']++;
        $id = trim((string) ($row['id'] ?? ''));
        $to = trim((string) ($row['recipient_email'] ?? ''));
        $orgId = trim((string) ($row['campaign_org_id'] ?? ''));
        $smtpId = trim((string) ($row['smtp_account_id'] ?? $row['campaign_smtp'] ?? ''));
        $subject = (string) ($row['sent_subject'] ?? '');
        $html = (string) ($row['sent_html'] ?? '');
        if ($id === '' || $to === '' || $html === '') {
            $reason = $to === ''
                ? 'Recipient email is missing, so this message was not sent.'
                : ($html === ''
                    ? 'No email body was saved for this recipient, so it was not sent.'
                    : 'This send row is incomplete, so it was not sent.');
            if ($id !== '') {
                try {
                    $upd->execute(['failed', $reason, null, $id]);
                } catch (Throwable $e) {
                    error_log('[marketingProcessDueEmailSends] update: ' . $e->getMessage());
                }
                $out['failed']++;
                $cid = trim((string) ($row['campaign_id'] ?? ''));
                if ($cid !== '') {
                    $touchedCampaigns[$cid] = true;
                }
            }
            $out['skipped']++;
            continue;
        }
        $mailbox = marketingLoadOrgMailbox($db, $orgId, $smtpId);
        if ($mailbox === null) {
            try {
                $upd->execute([
                    'failed',
                    'The mailbox for this campaign is missing or inactive. Check Email Setup.',
                    null,
                    $id,
                ]);
            } catch (Throwable $e) {
                error_log('[marketingProcessDueEmailSends] update: ' . $e->getMessage());
            }
            $out['failed']++;
            $cid = trim((string) ($row['campaign_id'] ?? ''));
            if ($cid !== '') {
                $touchedCampaigns[$cid] = true;
            }
            continue;
        }
        $fromName = $mailbox['from_name'] !== '' ? $mailbox['from_name'] : ($mailbox['label'] !== '' ? $mailbox['label'] : 'Syncpedia');
        $accountId = $mailbox['id'];
        $res = marketingSendOneCampaignEmail(
            $orgId,
            $accountId,
            $to,
            $subject !== '' ? $subject : 'Campaign',
            $html,
            $fromName,
            marketingEmailDraftAttachments([
                'attachment_path' => $row['draft_attachment_path'] ?? '',
                'attachment_name' => $row['draft_attachment_name'] ?? '',
            ])
        );
        $ok = !empty($res['ok']);
        try {
            $upd->execute([
                $ok ? 'sent' : 'failed',
                $ok ? null : (trim((string) ($res['error'] ?? '')) ?: 'Send failed. The mail server did not accept this message.'),
                $ok ? date('Y-m-d H:i:s') : null,
                $id,
            ]);
        } catch (Throwable $e) {
            error_log('[marketingProcessDueEmailSends] update: ' . $e->getMessage());
        }
        if ($ok) {
            $out['sent']++;
        } else {
            $out['failed']++;
        }
        $cid = trim((string) ($row['campaign_id'] ?? ''));
        if ($cid !== '') {
            $touchedCampaigns[$cid] = true;
        }
    }

    foreach (array_keys($touchedCampaigns) as $cid) {
        try {
            $agg = $db->prepare(
                "SELECT
                    COUNT(*) AS total_count,
                    SUM(CASE WHEN status = 'sent' AND sent_at IS NOT NULL AND sent_at > '1970-01-02 00:00:00' THEN 1 ELSE 0 END) AS sent_count,
                    SUM(CASE WHEN status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at > NOW() THEN 1 ELSE 0 END) AS pending_count,
                    SUM(CASE WHEN status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= NOW()) THEN 1 ELSE 0 END) AS sending_count
                 FROM email_sends WHERE campaign_id = ?"
            );
            $agg->execute([$cid]);
            $c = $agg->fetch(PDO::FETCH_ASSOC) ?: [];
            $sentC = (int) ($c['sent_count'] ?? 0);
            $pendC = (int) ($c['pending_count'] ?? 0);
            $sendC = (int) ($c['sending_count'] ?? 0);
            $failC = max(0, (int) ($c['total_count'] ?? 0) - $sentC - $pendC - $sendC);
            $stt = marketingCampaignStatusFromCounts($sentC, $failC, $pendC, $sendC);
            $db->prepare('UPDATE email_campaigns SET sent_count = ?, failed_count = ?, pending_count = ?, status = ? WHERE id = ?')
                ->execute([$sentC, $failC, $pendC + $sendC, $stt, $cid]);
        } catch (Throwable $e) {
            error_log('[marketingProcessDueEmailSends] campaign: ' . $e->getMessage());
        }
    }

    return $out;
}

/** How many campaign rows are waiting to send right now. */
function marketingCountDueEmailSends(PDO $db): int
{
    try {
        $q = $db->query(
            "SELECT COUNT(*) FROM email_sends
             WHERE status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= NOW())"
        );
        if (!$q) {
            return 0;
        }
        $n = (int) $q->fetchColumn();
        $q->closeCursor();
        return $n;
    } catch (Throwable $e) {
        error_log('[marketingCountDueEmailSends] ' . $e->getMessage());
        return 0;
    }
}

/**
 * Send due campaign mail one message at a time, 3 seconds apart.
 * Holds the send lock for the whole drain so a second worker exits immediately.
 *
 * @return array{scanned:int,sent:int,failed:int,skipped:int}
 */
function marketingDrainDueEmailCampaigns(PDO $db): array
{
    @set_time_limit(0);
    ignore_user_abort(true);
    $totals = ['scanned' => 0, 'sent' => 0, 'failed' => 0, 'skipped' => 0];
    $lock = $db->query("SELECT GET_LOCK('syncpedia_mkt_email', 0)");
    $gotLock = 0;
    if ($lock) {
        $gotLock = (int) $lock->fetchColumn();
        $lock->closeCursor();
    }
    if ($gotLock !== 1) {
        return $totals;
    }
    try {
        while (true) {
            $batch = marketingProcessDueEmailSendsLocked($db, 1);
            $totals['scanned'] += (int) ($batch['scanned'] ?? 0);
            $totals['sent'] += (int) ($batch['sent'] ?? 0);
            $totals['failed'] += (int) ($batch['failed'] ?? 0);
            $totals['skipped'] += (int) ($batch['skipped'] ?? 0);
            if ((int) ($batch['scanned'] ?? 0) < 1) {
                break;
            }
            if (marketingCountDueEmailSends($db) < 1) {
                break;
            }
            sleep(3);
        }
    } finally {
        $rel = $db->query("SELECT RELEASE_LOCK('syncpedia_mkt_email')");
        if ($rel) {
            $rel->fetchColumn();
            $rel->closeCursor();
        }
    }
    return $totals;
}

/** Start the slow sender in a separate PHP process. Returns false when that is not possible. */
function marketingKickEmailCampaignWorker(): bool
{
    if (!function_exists('exec')) {
        return false;
    }
    $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
    if (in_array('exec', $disabled, true)) {
        return false;
    }
    $script = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'cron_email_campaigns.php';
    if (!is_file($script)) {
        return false;
    }
    $php = 'php';
    $bin = defined('PHP_BINARY') ? (string) PHP_BINARY : '';
    $base = $bin !== '' ? strtolower(basename($bin)) : '';
    if ($bin !== '' && strpos($base, 'php-fpm') === false && strpos($base, 'php-cgi') === false) {
        $php = $bin;
    }
    $cmd = escapeshellarg($php) . ' ' . escapeshellarg($script);
    if (DIRECTORY_SEPARATOR === '\\') {
        $handle = @popen('start /B "" ' . $cmd . ' > NUL 2>&1', 'r');
        if (is_resource($handle)) {
            pclose($handle);
        }
        return true;
    }
    exec('nohup ' . $cmd . ' > /dev/null 2>&1 < /dev/null &');
    return true;
}

/**
 * Put failed rows for one campaign back on the queue. Messages that already
 * have a send time stay sent.
 *
 * @return array{ok:bool,queued:int,error:?string,message?:string}
 */
function marketingRetryFailedEmailCampaign(PDO $db, string $campaignId): array
{
    $campaignId = trim($campaignId);
    if ($campaignId === '') {
        return ['ok' => false, 'queued' => 0, 'error' => 'campaign_id required'];
    }
    marketingEnsureEmailDispatchSchema($db);
    $failedSql = "campaign_id = ?
           AND (
             status = 'failed'
             OR (status = 'sent' AND (sent_at IS NULL OR sent_at <= '1970-01-02 00:00:00'))
           )";
    $count = $db->prepare('SELECT COUNT(*) FROM email_sends WHERE ' . $failedSql);
    $count->execute([$campaignId]);
    $queued = (int) $count->fetchColumn();
    $count->closeCursor();
    if ($queued < 1) {
        return ['ok' => false, 'queued' => 0, 'error' => 'No failed emails to retry.'];
    }
    $upd = $db->prepare(
        'UPDATE email_sends
         SET status = \'pending\', error_message = NULL, sent_at = NULL
         WHERE ' . $failedSql
    );
    $upd->execute([$campaignId]);

    try {
        $agg = $db->prepare(
            "SELECT
                COUNT(*) AS total_count,
                SUM(CASE WHEN status = 'sent' AND sent_at IS NOT NULL AND sent_at > '1970-01-02 00:00:00' THEN 1 ELSE 0 END) AS sent_count,
                SUM(CASE WHEN status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at > NOW() THEN 1 ELSE 0 END) AS pending_count,
                SUM(CASE WHEN status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= NOW()) THEN 1 ELSE 0 END) AS sending_count
             FROM email_sends WHERE campaign_id = ?"
        );
        $agg->execute([$campaignId]);
        $c = $agg->fetch(PDO::FETCH_ASSOC) ?: [];
        $sentC = (int) ($c['sent_count'] ?? 0);
        $pendC = (int) ($c['pending_count'] ?? 0);
        $sendC = (int) ($c['sending_count'] ?? 0);
        $failC = max(0, (int) ($c['total_count'] ?? 0) - $sentC - $pendC - $sendC);
        $stt = marketingCampaignStatusFromCounts($sentC, $failC, $pendC, $sendC);
        $db->prepare('UPDATE email_campaigns SET sent_count = ?, failed_count = ?, pending_count = ?, status = ? WHERE id = ?')
            ->execute([$sentC, $failC, $pendC + $sendC, $stt, $campaignId]);
    } catch (Throwable $e) {
        error_log('[marketingRetryFailedEmailCampaign] ' . $e->getMessage());
    }

    return [
        'ok' => true,
        'queued' => $queued,
        'error' => null,
        'message' => "Sending {$queued}. You can leave this page; they go out about every 3 seconds.",
    ];
}
