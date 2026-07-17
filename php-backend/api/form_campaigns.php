<?php
/**
 * Form-linked email / WhatsApp campaigns (marketing + communications templates).
 */
require_once __DIR__ . '/communications_org.php';

/** @return array<string,mixed> */
function formCampaignParseConfig(array $meta): array
{
    $raw = $meta['campaign'] ?? [];
    if (!is_array($raw)) {
        return [];
    }
    return $raw;
}

function formCampaignUserOrgId(PDO $db, array $tokenData): string
{
    $fromToken = trim((string) ($tokenData['org_id'] ?? ''));
    if ($fromToken !== '') {
        return $fromToken;
    }
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    if ($userId === '') {
        return '';
    }
    try {
        $st = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
        $st->execute([$userId]);
        $org = $st->fetchColumn();
        return is_string($org) ? trim($org) : '';
    } catch (Throwable $e) {
        return '';
    }
}

function formCampaignEffectiveOrgId(PDO $db, array $tokenData, array $formRow): string
{
    $formOrgId = trim((string) ($formRow['org_id'] ?? ''));
    if ($formOrgId !== '') {
        return $formOrgId;
    }
    $userOrgId = formCampaignUserOrgId($db, $tokenData);
    if ($userOrgId !== '') {
        return $userOrgId;
    }
    $resolved = resolveCreatorOrgId($db, $tokenData);
    return $resolved !== null ? trim((string) $resolved) : '';
}

/** @return array<int,string> */
function formCampaignCommTemplateOrgIds(PDO $db, array $tokenData, array $formRow): array
{
    $orgIds = [];
    $add = static function (string $id) use (&$orgIds): void {
        $id = trim($id);
        if ($id !== '' && !in_array($id, $orgIds, true)) {
            $orgIds[] = $id;
        }
    };

    $add((string) ($formRow['org_id'] ?? ''));
    $add(formCampaignUserOrgId($db, $tokenData));
    $resolved = resolveCreatorOrgId($db, $tokenData);
    if ($resolved !== null) {
        $add((string) $resolved);
    }

    try {
        $st = $db->query('SELECT DISTINCT org_id FROM org_whatsapp_config WHERE is_active = 1');
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $oid) {
            $add((string) $oid);
        }
    } catch (Throwable $e) {
    }

    return $orgIds;
}

/** @return array<int,array<string,mixed>> */
function formCampaignFetchCommWhatsappTemplates(PDO $db, array $tokenData, array $formRow): array
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $whatsapp = [];
    $seen = [];

    try {
        if ($role === 'super_admin') {
            $st = $db->query(
                "SELECT t.id, t.name, t.body, t.language, t.status, t.provider_template_id, o.name AS org_name
                 FROM whatsapp_message_templates t
                 LEFT JOIN organizations o ON o.id = t.org_id
                 WHERE t.status = 'approved'
                 ORDER BY t.name ASC
                 LIMIT 200",
            );
        } else {
            $orgIds = formCampaignCommTemplateOrgIds($db, $tokenData, $formRow);
            if ($orgIds === []) {
                return [];
            }
            $placeholders = implode(',', array_fill(0, count($orgIds), '?'));
            $st = $db->prepare(
                "SELECT t.id, t.name, t.body, t.language, t.status, t.provider_template_id, o.name AS org_name
                 FROM whatsapp_message_templates t
                 LEFT JOIN organizations o ON o.id = t.org_id
                 WHERE t.org_id IN ($placeholders) AND t.status = 'approved'
                 ORDER BY t.name ASC
                 LIMIT 200",
            );
            $st->execute($orgIds);
        }
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $id = (string) ($row['id'] ?? '');
            if ($id === '' || isset($seen[$id])) {
                continue;
            }
            $seen[$id] = true;
            $label = (string) ($row['name'] ?? '');
            $orgName = trim((string) ($row['org_name'] ?? ''));
            if ($orgName !== '') {
                $label .= ' (' . $orgName . ')';
            }
            $whatsapp[] = [
                'id' => $id,
                'name' => $label,
                'subject' => $row['provider_template_id'] ?: $row['name'],
                'source' => 'communications',
                'channel' => 'whatsapp',
                'language' => $row['language'] ?? 'en',
            ];
        }
    } catch (Throwable $e) {
    }

    return $whatsapp;
}

/** @return array<int,array<string,mixed>> */
function formCampaignFetchMarketingDrafts(PDO $db, array $tokenData, string $channel, string $orgId): array
{
    $userId = (string) ($tokenData['user_id'] ?? '');
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $table = $channel === 'email' ? 'email_drafts' : 'whatsapp_drafts';
    $ownerOnly = ($role === 'marketing');
    $rows = [];

    if ($ownerOnly) {
        $where = 'created_by = ?';
        $params = [$userId];
        if ($orgId !== '') {
            $where .= ' AND (org_id = ? OR org_id IS NULL)';
            $params[] = $orgId;
        }
    } elseif ($orgId !== '') {
        $where = 'org_id = ? OR org_id IS NULL';
        $params = [$orgId];
    } else {
        $where = 'created_by = ?';
        $params = [$userId];
    }

    $select = $channel === 'email'
        ? "SELECT id, name, subject, status, updated_at FROM {$table} WHERE ({$where}) ORDER BY updated_at DESC LIMIT 200"
        : "SELECT id, name, subject, body, status, updated_at FROM {$table} WHERE ({$where}) ORDER BY updated_at DESC LIMIT 200";
    $st = $db->prepare($select);
    $st->execute($params);
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $rows[] = [
            'id' => $row['id'],
            'name' => $row['name'] ?: ($row['subject'] ?? 'Draft'),
            'subject' => $row['subject'] ?? '',
            'source' => 'marketing',
            'channel' => $channel,
        ];
    }

    return $rows;
}

function formCampaignCanManage(PDO $db, array $tokenData, array $formRow): bool
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));

    if ($role === 'super_admin') {
        return true;
    }

    $formOrgId = trim((string) ($formRow['org_id'] ?? ''));
    $userOrgId = formCampaignUserOrgId($db, $tokenData);

    if (in_array($role, ['admin', 'org'], true)) {
        return $formOrgId !== '' && $userOrgId !== '' && $formOrgId === $userOrgId;
    }

    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    $ownerId = trim((string) ($formRow['created_by'] ?? ''));
    if ($role !== 'marketing') {
        return false;
    }

    if ($userId !== '' && $ownerId !== '' && $userId === $ownerId) {
        return true;
    }

    return $formOrgId !== '' && $userOrgId !== '' && $formOrgId === $userOrgId;
}

function formCampaignN8nWebhook(string $type): ?string
{
    $envKey = $type === 'email' ? 'SYNCPIEDIA_N8N_EMAIL_WEBHOOK' : 'SYNCPIEDIA_N8N_WHATSAPP_WEBHOOK';
    $v = getenv($envKey);
    if ($v !== false && trim((string) $v) !== '') {
        return trim((string) $v);
    }
    $const = $type === 'email' ? 'N8N_EMAIL_WEBHOOK' : 'N8N_WHATSAPP_WEBHOOK';
    if (defined($const) && trim((string) constant($const)) !== '') {
        return trim((string) constant($const));
    }
    return null;
}

function formCampaignPersonalize(string $text, array $lead): string
{
    $name = trim((string) ($lead['name'] ?? $lead['full_name'] ?? ''));
    $email = trim((string) ($lead['email'] ?? ''));
    $phone = trim((string) ($lead['phone'] ?? ''));
    return str_replace(
        ['{{name}}', '{{email}}', '{{phone}}', '{{full_name}}'],
        [$name, $email, $phone, $name],
        $text,
    );
}

/** @return array<int,array<string,mixed>> */
function formCampaignFetchAllSubmissions(PDO $db, array $formRow): array
{
    ensureLeadsSourceColumnVarchar($db);
    ensureLeadsResumeColumn($db);
    ensureHrLeadsTableExists($db);

    $slug = trim((string) ($formRow['slug'] ?? ''));
    if ($slug === '') {
        return [];
    }
    $sourceKey = 'form_' . $slug;
    $formOrgId = trim((string) ($formRow['org_id'] ?? ''));
    $destination = publicFormLeadDestination($formRow) ?? 'form_leads';

    if ($destination === 'hr_leads') {
        $sql = 'SELECT hl.id, hl.full_name AS name, hl.phone, hl.email, hl.status, hl.source
                FROM hr_leads hl
                WHERE hl.source = ? AND (hl.deleted_at IS NULL)';
        $params = [$sourceKey];
        if ($formOrgId !== '') {
            $sql .= ' AND hl.org_id = ?';
            $params[] = $formOrgId;
        }
        $sql .= ' ORDER BY hl.created_at DESC LIMIT 5000';
        $st = $db->prepare($sql);
        $st->execute($params);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
        return is_array($rows) ? $rows : [];
    }

    $sql = 'SELECT l.id, l.name, l.email, l.phone, l.status, l.source
            FROM leads l
            WHERE l.source = ?';
    $params = [$sourceKey];
    if ($formOrgId !== '') {
        $sql .= ' AND l.org_id = ?';
        $params[] = $formOrgId;
    }
    $sql .= ' ORDER BY l.created_at DESC LIMIT 5000';
    $st = $db->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    return is_array($rows) ? $rows : [];
}

/** @return array{email: array<int,array<string,mixed>>, whatsapp: array<int,array<string,mixed>>} */
function formCampaignListTemplates(PDO $db, array $tokenData, array $formRow): array
{
    $orgId = formCampaignEffectiveOrgId($db, $tokenData, $formRow);
    $email = formCampaignFetchMarketingDrafts($db, $tokenData, 'email', $orgId);
    $whatsapp = formCampaignFetchMarketingDrafts($db, $tokenData, 'whatsapp', $orgId);
    $whatsapp = array_merge($whatsapp, formCampaignFetchCommWhatsappTemplates($db, $tokenData, $formRow));

    return ['email' => $email, 'whatsapp' => $whatsapp];
}

function formCampaignMergeIntoMeta(array $meta, array $campaignInput): array
{
    $existing = formCampaignParseConfig($meta);
    $allowed = [
        'assign_email', 'assign_whatsapp', 'email_source', 'email_template_id',
        'whatsapp_source', 'whatsapp_template_id', 'auto_send_email', 'auto_send_whatsapp',
    ];
    foreach ($allowed as $key) {
        if (array_key_exists($key, $campaignInput)) {
            $existing[$key] = $campaignInput[$key];
        }
    }
    $meta['campaign'] = $existing;
    return $meta;
}

/** Load email draft for form campaign — org-scoped for admins, owner-scoped for marketing. */
function formCampaignLoadEmailDraft(PDO $db, array $tokenData, array $formRow, string $templateId): ?array
{
    $st = $db->prepare('SELECT * FROM email_drafts WHERE id = ? LIMIT 1');
    $st->execute([$templateId]);
    $draft = $st->fetch(PDO::FETCH_ASSOC);
    if (!$draft) {
        return null;
    }

    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = (string) ($tokenData['user_id'] ?? '');
    $orgId = formCampaignEffectiveOrgId($db, $tokenData, $formRow);
    $draftOrg = trim((string) ($draft['org_id'] ?? ''));
    $ownerId = trim((string) ($draft['created_by'] ?? ''));

    if ($role === 'marketing') {
        if ($ownerId === '' || $ownerId !== $userId) {
            return null;
        }
        if ($orgId !== '' && $draftOrg !== '' && $draftOrg !== $orgId) {
            return null;
        }
        return $draft;
    }

    if ($role === 'super_admin') {
        return $draft;
    }

    if (in_array($role, ['admin', 'org'], true)) {
        if ($orgId !== '' && $draftOrg !== '' && $draftOrg !== $orgId) {
            return null;
        }
        return $draft;
    }

    if ($ownerId !== '' && $ownerId === $userId) {
        return $draft;
    }

    return null;
}

/** @return array{ok:bool,sent?:int,skipped?:int,failed?:int,error?:string,campaign_id?:string} */
function formCampaignSendEmail(PDO $db, array $tokenData, array $formRow, string $source, string $templateId, array $recipients, string $userId): array
{
    if ($source !== 'marketing') {
        return ['ok' => false, 'error' => 'Email templates are available from Marketing drafts only'];
    }
    $draft = formCampaignLoadEmailDraft($db, $tokenData, $formRow, $templateId);
    if (!$draft) {
        return ['ok' => false, 'error' => 'Email template not found or not accessible for this form'];
    }

    $orgId = formCampaignEffectiveOrgId($db, $tokenData, $formRow);
    $campaignId = generateUUID();
    $valid = [];
    foreach ($recipients as $row) {
        $email = trim((string) ($row['email'] ?? ''));
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $valid[] = $row;
        }
    }
    if ($valid === []) {
        return ['ok' => false, 'error' => 'No recipients with valid email addresses'];
    }

    $db->prepare('INSERT INTO email_campaigns (id, subject, draft_id, recipient_count, pending_count, sent_count, failed_count, status, created_by, org_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
        ->execute([
            $campaignId,
            $draft['subject'] ?? $draft['name'] ?? 'Form campaign',
            $draft['id'],
            count($valid),
            0,
            0,
            0,
            'sending',
            $userId,
            $orgId !== '' ? $orgId : null,
        ]);

    $sendStmt = $db->prepare('INSERT INTO email_sends (id, campaign_id, recipient_email, status, error_message) VALUES (?,?,?,?,?)');
    $sent = 0;
    $failed = 0;
    $firstError = null;
    $fromAddr = 'support@syncpedia.in';
    $fromName = trim((string) ($formRow['name'] ?? 'Syncpedia'));
    $subject = (string) ($draft['subject'] ?? 'Message from Syncpedia');
    $html = (string) ($draft['html_body'] ?? '');
    syncpediaSetMailContext($orgId !== '' ? $orgId : null, 'form_campaigns');
    if ($html === '') {
        $html = '<p>' . nl2br(htmlspecialchars((string) ($draft['plain_text'] ?? ''), ENT_QUOTES, 'UTF-8')) . '</p>';
    }

    foreach ($valid as $lead) {
        $email = trim((string) $lead['email']);
        $body = formCampaignPersonalize($html, $lead);
        $subj = formCampaignPersonalize($subject, $lead);
        $res = syncpediaSendHtmlEmailViaSmtp($email, $subj, $body, $fromAddr, $fromName);
        $status = $res['ok'] ? 'sent' : 'failed';
        if ($res['ok']) {
            $sent++;
        } else {
            $failed++;
            if ($firstError === null) {
                $firstError = trim((string) ($res['error'] ?? 'SMTP send failed'));
            }
        }
        $sendStmt->execute([generateUUID(), $campaignId, $email, $status, $res['error'] ?? null]);
    }

    $pending = max(0, count($valid) - $sent - $failed);
    $db->prepare('UPDATE email_campaigns SET sent_count = ?, failed_count = ?, pending_count = ?, status = ? WHERE id = ?')
        ->execute([$sent, $failed, $pending, $failed > 0 && $sent === 0 ? 'failed' : 'completed', $campaignId]);

    $webhook = formCampaignN8nWebhook('email');
    if ($webhook !== null) {
        $emails = array_values(array_map(static fn ($r) => trim((string) $r['email']), $valid));
        formCampaignPostWebhook($webhook, [
            'campaign_id' => $campaignId,
            'subject' => $subject,
            'html_body' => $html,
            'recipients' => $emails,
            'form_id' => $formRow['id'] ?? null,
        ]);
    }

    return [
        'ok' => $sent > 0,
        'sent' => $sent,
        'failed' => $failed,
        'skipped' => 0,
        'campaign_id' => $campaignId,
        'error' => $sent === 0 ? ($firstError ?: 'No emails were accepted by SMTP') : null,
    ];
}

/** @return array{ok:bool,sent?:int,skipped?:int,failed?:int,error?:string,campaign_id?:string} */
function formCampaignSendWhatsapp(PDO $db, array $tokenData, array $formRow, string $source, string $templateId, array $recipients, string $userId): array
{
    $orgId = formCampaignEffectiveOrgId($db, $tokenData, $formRow);

    $valid = [];
    foreach ($recipients as $row) {
        $phone = preg_replace('/\s+/', '', trim((string) ($row['phone'] ?? '')));
        if ($phone !== '' && strlen(preg_replace('/\D+/', '', $phone) ?? '') >= 10) {
            $row['phone'] = $phone;
            $valid[] = $row;
        }
    }
    if ($valid === []) {
        return ['ok' => false, 'error' => 'No recipients with valid phone numbers'];
    }

    if ($source === 'communications') {
        $tst = $db->prepare("SELECT * FROM whatsapp_message_templates WHERE id = ? AND status = 'approved' LIMIT 1");
        $tst->execute([$templateId]);
        $template = $tst->fetch(PDO::FETCH_ASSOC);
        if (!$template) {
            return ['ok' => false, 'error' => 'WhatsApp template not found or not approved'];
        }
        $templateOrgId = trim((string) ($template['org_id'] ?? ''));
        $sendOrgId = $orgId !== '' ? $orgId : $templateOrgId;
        if ($templateOrgId !== '' && $sendOrgId !== '' && $templateOrgId !== $sendOrgId) {
            $sendOrgId = $templateOrgId;
        }
        if ($sendOrgId === '') {
            return ['ok' => false, 'error' => 'Organization is required for WhatsApp campaigns'];
        }
        $sent = 0;
        $failed = 0;
        foreach ($valid as $lead) {
            $name = trim((string) ($lead['name'] ?? ''));
            $vars = $name !== '' ? [$name] : [];
            $send = commSendViaOrgProvider($db, $sendOrgId, (string) $lead['phone'], $template, $vars, null);
            if ($send['ok']) {
                $sent++;
            } else {
                $failed++;
            }
        }
        return ['ok' => $sent > 0 || $failed === 0, 'sent' => $sent, 'failed' => $failed, 'skipped' => 0];
    }

    $st = $db->prepare('SELECT * FROM whatsapp_drafts WHERE id = ? LIMIT 1');
    $st->execute([$templateId]);
    $draft = $st->fetch(PDO::FETCH_ASSOC);
    if (!$draft) {
        return ['ok' => false, 'error' => 'WhatsApp template not found'];
    }
    if ($orgId === '') {
        $orgId = trim((string) ($draft['org_id'] ?? ''));
    }
    if ($orgId === '') {
        return ['ok' => false, 'error' => 'Organization is required for WhatsApp campaigns'];
    }

    $campaignId = generateUUID();
    $db->prepare('INSERT INTO whatsapp_campaigns (id, subject, draft_id, recipient_count, pending_count, sent_count, failed_count, status, created_by, org_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
        ->execute([
            $campaignId,
            $draft['subject'] ?? $draft['name'] ?? 'Form campaign',
            $draft['id'],
            count($valid),
            count($valid),
            0,
            0,
            'sending',
            $userId,
            $orgId,
        ]);

    $sendStmt = $db->prepare('INSERT INTO whatsapp_sends (id, campaign_id, recipient_phone, status) VALUES (?,?,?,?)');
    $phones = [];
    foreach ($valid as $lead) {
        $phones[] = (string) $lead['phone'];
        $sendStmt->execute([generateUUID(), $campaignId, $lead['phone'], 'pending']);
    }

    $webhook = formCampaignN8nWebhook('whatsapp');
    if ($webhook !== null) {
        formCampaignPostWebhook($webhook, [
            'campaign_id' => $campaignId,
            'subject' => $draft['subject'] ?? '',
            'body' => $draft['body'] ?? '',
            'recipients' => $phones,
            'form_id' => $formRow['id'] ?? null,
        ]);
        $db->prepare('UPDATE whatsapp_campaigns SET status = ?, pending_count = ? WHERE id = ?')
            ->execute(['sending', count($phones), $campaignId]);
    }

    return [
        'ok' => true,
        'sent' => $webhook !== null ? count($phones) : 0,
        'failed' => 0,
        'skipped' => 0,
        'campaign_id' => $campaignId,
        'message' => $webhook !== null ? 'WhatsApp campaign queued' : 'Recipients recorded — configure N8N_WHATSAPP_WEBHOOK for delivery',
    ];
}

/** @param array<string,mixed> $payload */
function formCampaignPostWebhook(string $url, array $payload): void
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
    ]);
    curl_exec($ch);
    curl_close($ch);
}

/** @return array{ok:bool,results?:array<string,mixed>,error?:string} */
function formCampaignSendBulk(PDO $db, array $tokenData, array $formRow, string $channel, string $source, string $templateId): array
{
    if (!formCampaignCanManage($db, $tokenData, $formRow)) {
        return ['ok' => false, 'error' => 'Forbidden — super admin, org admin, or marketing users with access to this form can send campaigns'];
    }
    $userId = (string) ($tokenData['user_id'] ?? '');
    $recipients = formCampaignFetchAllSubmissions($db, $formRow);
    if ($recipients === []) {
        return ['ok' => false, 'error' => 'No submissions found for this form'];
    }
    if ($channel === 'email') {
        return formCampaignSendEmail($db, $tokenData, $formRow, $source, $templateId, $recipients, $userId);
    }
    if ($channel === 'whatsapp') {
        return formCampaignSendWhatsapp($db, $tokenData, $formRow, $source, $templateId, $recipients, $userId);
    }
    return ['ok' => false, 'error' => 'Invalid channel'];
}

/** @param array<string,mixed> $lead */
function formCampaignAutoSendForNewLead(PDO $db, array $formRow, array $lead): void
{
    $rawMeta = $formRow['meta_json'] ?? null;
    if (is_string($rawMeta)) {
        $meta = json_decode($rawMeta, true);
        $meta = is_array($meta) ? $meta : [];
    } elseif (is_array($rawMeta)) {
        $meta = $rawMeta;
    } else {
        $meta = [];
    }
    $cfg = formCampaignParseConfig($meta);
    if ($cfg === []) {
        return;
    }
    $ownerId = trim((string) ($formRow['created_by'] ?? ''));
    if ($ownerId === '') {
        return;
    }
    $tokenShim = ['user_id' => $ownerId, 'role' => 'marketing'];

    if (!empty($cfg['auto_send_email']) && !empty($cfg['email_template_id'])) {
        $source = (string) ($cfg['email_source'] ?? 'marketing');
        $tid = (string) $cfg['email_template_id'];
        if ($tid !== '') {
            formCampaignSendEmail($db, $tokenShim, $formRow, $source, $tid, [$lead], $ownerId);
        }
    }
    if (!empty($cfg['auto_send_whatsapp']) && !empty($cfg['whatsapp_template_id'])) {
        $source = (string) ($cfg['whatsapp_source'] ?? 'marketing');
        $tid = (string) $cfg['whatsapp_template_id'];
        if ($tid !== '') {
            formCampaignSendWhatsapp($db, $tokenShim, $formRow, $source, $tid, [$lead], $ownerId);
        }
    }
}

/** @return array{ok:bool,results?:array<string,mixed>,error?:string} */
function formCampaignSendAssignedOnPublish(PDO $db, array $tokenData, array $formRow, array $cfg): array
{
    $results = [];
    if (!empty($cfg['assign_email']) && !empty($cfg['email_template_id'])) {
        $results['email'] = formCampaignSendBulk(
            $db,
            $tokenData,
            $formRow,
            'email',
            (string) ($cfg['email_source'] ?? 'marketing'),
            (string) $cfg['email_template_id'],
        );
    }
    if (!empty($cfg['assign_whatsapp']) && !empty($cfg['whatsapp_template_id'])) {
        $results['whatsapp'] = formCampaignSendWhatsapp(
            $db,
            $tokenData,
            $formRow,
            (string) ($cfg['whatsapp_source'] ?? 'marketing'),
            (string) $cfg['whatsapp_template_id'],
            formCampaignFetchAllSubmissions($db, $formRow),
            (string) ($tokenData['user_id'] ?? ''),
        );
        if (empty($results['whatsapp']['ok']) && !empty($cfg['assign_email'])) {
            // keep email result
        } elseif (empty($cfg['assign_email'])) {
            return $results['whatsapp'] + ['results' => $results];
        }
    }
    if ($results === []) {
        return ['ok' => true, 'results' => [], 'message' => 'No campaigns assigned'];
    }
    $ok = true;
    foreach ($results as $r) {
        if (empty($r['ok'])) {
            $ok = false;
        }
    }
    return ['ok' => $ok, 'results' => $results];
}
