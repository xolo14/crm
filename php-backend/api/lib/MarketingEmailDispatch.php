<?php
/**
 * Marketing email campaign dispatch: <<placeholders>>, per-recipient schedule, org mailbox.
 */

function marketingExtractAnglePlaceholders(string ...$texts): array
{
    $seen = [];
    $out = [];
    foreach ($texts as $text) {
        if (!is_string($text) || $text === '') {
            continue;
        }
        if (preg_match_all('/<<\s*([a-zA-Z0-9_]+)\s*>>/', $text, $m)) {
            foreach ($m[1] as $key) {
                $lk = strtolower((string) $key);
                if ($lk === '' || isset($seen[$lk])) {
                    continue;
                }
                $seen[$lk] = true;
                $out[] = (string) $key;
            }
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
        $map[strtolower((string) $k)] = (string) $v;
    }
    $filled = preg_replace_callback(
        '/<<\s*([a-zA-Z0-9_]+)\s*>>/',
        static function (array $m) use ($map) {
            $lk = strtolower((string) ($m[1] ?? ''));
            return array_key_exists($lk, $map) ? $map[$lk] : (string) ($m[0] ?? '');
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

/**
 * @return array{ok:bool,error?:string,from?:string}
 */
function marketingSendOneCampaignEmail(
    string $orgId,
    string $smtpAccountId,
    string $to,
    string $subject,
    string $html,
    string $fromName = ''
): array {
    if (function_exists('syncpediaSetMailContext')) {
        syncpediaSetMailContext($orgId !== '' ? $orgId : null, 'marketing_campaigns');
    }
    if (function_exists('syncpediaSetPreferredSmtpAccountId')) {
        syncpediaSetPreferredSmtpAccountId($smtpAccountId !== '' ? $smtpAccountId : null);
    }
    $fromAddr = function_exists('syncpediaSupportMailAddress') ? syncpediaSupportMailAddress() : 'support@syncpedia.in';
    $name = $fromName !== '' ? $fromName : 'Syncpedia';
    if (!function_exists('syncpediaSendHtmlEmailViaSmtp')) {
        return ['ok' => false, 'error' => 'Mail transport unavailable'];
    }
    return syncpediaSendHtmlEmailViaSmtp($to, $subject, $html, $fromAddr, $name);
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
        $rows[] = [
            'email' => $email,
            'values' => $values,
            'scheduled_at' => $when,
            'subject' => marketingFillAnglePlaceholders($subjectTpl, $values),
            'html' => marketingFillAnglePlaceholders($htmlTpl, $values),
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
    $firstError = null;
    $fromName = $mailbox['from_name'] !== '' ? $mailbox['from_name'] : ($mailbox['label'] !== '' ? $mailbox['label'] : 'Syncpedia');

    foreach ($rows as $r) {
        $id = generateUUID();
        $due = marketingScheduleIsDue($r['scheduled_at']);
        if (!$due) {
            $pending++;
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
            continue;
        }

        $res = marketingSendOneCampaignEmail($orgId, $mailbox['id'], $r['email'], $r['subject'], $r['html'], $fromName);
        $ok = !empty($res['ok']);
        if ($ok) {
            $sent++;
        } else {
            $failed++;
            if ($firstError === null) {
                $firstError = trim((string) ($res['error'] ?? 'SMTP send failed'));
            }
        }
        if ($hasSendExtra) {
            $sendStmt->execute([
                $id,
                $campaignId,
                $r['email'],
                $ok ? 'sent' : 'failed',
                $ok ? null : ($res['error'] ?? 'Send failed'),
                $r['scheduled_at'],
                $r['subject'],
                $r['html'],
                json_encode($r['values'], JSON_UNESCAPED_UNICODE),
                $mailbox['id'],
                $ok ? date('Y-m-d H:i:s') : null,
            ]);
        } else {
            $sendStmt->execute([
                $id,
                $campaignId,
                $r['email'],
                $ok ? 'sent' : 'failed',
                $ok ? null : ($res['error'] ?? 'Send failed'),
            ]);
        }
    }

    $finalStatus = $pending > 0 ? 'scheduled' : (($sent === 0 && $failed > 0) ? 'failed' : 'completed');
    $db->prepare('UPDATE email_campaigns SET sent_count = ?, failed_count = ?, pending_count = ?, status = ? WHERE id = ?')
        ->execute([$sent, $failed, $pending, $finalStatus, $campaignId]);

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

    $ok = $sent > 0 || $pending > 0;
    $msgParts = [];
    if ($sent > 0) {
        $msgParts[] = "Sent {$sent}";
    }
    if ($pending > 0) {
        $msgParts[] = "{$pending} scheduled";
    }
    if ($failed > 0) {
        $msgParts[] = "{$failed} failed";
    }

    return [
        'ok' => $ok,
        'campaign_id' => $campaignId,
        'sent' => $sent,
        'failed' => $failed,
        'pending' => $pending,
        'error' => $ok ? null : ($firstError ?: 'No emails were sent. Configure Email Setup for your organization.'),
        'message' => $ok ? implode(', ', $msgParts) : ($firstError ?: 'Send failed'),
    ];
}

/**
 * @return array{scanned:int,sent:int,failed:int,skipped:int}
 */
function marketingProcessDueEmailSends(PDO $db, int $limit = 80): array
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
            "SELECT es.*, ec.org_id AS campaign_org_id, ec.smtp_account_id AS campaign_smtp
             FROM email_sends es
             INNER JOIN email_campaigns ec ON ec.id = es.campaign_id
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
            $out['skipped']++;
            continue;
        }
        $mailbox = marketingLoadOrgMailbox($db, $orgId, $smtpId);
        $fromName = $mailbox ? ($mailbox['from_name'] ?: $mailbox['label']) : 'Syncpedia';
        $accountId = $mailbox['id'] ?? $smtpId;
        $res = marketingSendOneCampaignEmail($orgId, $accountId, $to, $subject !== '' ? $subject : 'Campaign', $html, $fromName);
        $ok = !empty($res['ok']);
        try {
            $upd->execute([
                $ok ? 'sent' : 'failed',
                $ok ? null : ($res['error'] ?? 'Send failed'),
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
                    SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count
                 FROM email_sends WHERE campaign_id = ?"
            );
            $agg->execute([$cid]);
            $c = $agg->fetch(PDO::FETCH_ASSOC) ?: [];
            $sentC = (int) ($c['sent_count'] ?? 0);
            $failC = (int) ($c['failed_count'] ?? 0);
            $pendC = (int) ($c['pending_count'] ?? 0);
            $stt = $pendC > 0 ? 'scheduled' : (($sentC === 0 && $failC > 0) ? 'failed' : 'completed');
            $db->prepare('UPDATE email_campaigns SET sent_count = ?, failed_count = ?, pending_count = ?, status = ? WHERE id = ?')
                ->execute([$sentC, $failC, $pendC, $stt, $cid]);
        } catch (Throwable $e) {
            error_log('[marketingProcessDueEmailSends] campaign: ' . $e->getMessage());
        }
    }

    return $out;
}
