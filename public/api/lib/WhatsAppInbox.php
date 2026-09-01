<?php
/**
 * WhatsApp conversation inbox — threads, messages, lead linking.
 */
class WhatsAppInbox
{
    /** Safe preview truncate when mbstring is unavailable on the host. */
    public static function previewText(string $text, int $max = 200): string
    {
        if ($max < 1) {
            return '';
        }
        if (function_exists('mb_substr')) {
            return (string) mb_substr($text, 0, $max);
        }
        return substr($text, 0, $max);
    }

    public static function ensureTables(PDO $db): void
    {
        static $done = false;
        if ($done) {
            return;
        }
        $candidates = [
            __DIR__ . '/../../migrations/wa_inbox_2026_07_02.sql',
            __DIR__ . '/../../../php-backend/migrations/wa_inbox_2026_07_02.sql',
        ];
        foreach ($candidates as $path) {
            if (!is_readable($path)) {
                continue;
            }
            $sql = file_get_contents($path);
            foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
                if ($stmt === '' || stripos($stmt, 'CREATE TABLE') === false) {
                    continue;
                }
                try {
                    $db->exec($stmt);
                } catch (Throwable $e) {
                }
            }
            break;
        }
        self::ensureMessageColumns($db);
        self::ensureConversationOwnershipColumns($db);
        self::ensureStatusOrphanTable($db);
        $done = true;
    }

    /** Parking table for status webhooks that arrive before the outbound message row exists. */
    private static function ensureStatusOrphanTable(PDO $db): void
    {
        try {
            $db->exec(
                "CREATE TABLE IF NOT EXISTS wa_status_orphans (
                    wamid VARCHAR(128) NOT NULL PRIMARY KEY,
                    status VARCHAR(20) NOT NULL,
                    ts DATETIME NULL DEFAULT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            );
        } catch (Throwable $e) {
        }
    }

    private static function ensureConversationOwnershipColumns(PDO $db): void
    {
        try {
            $db->exec(
                "CREATE TABLE IF NOT EXISTS wa_conversations (
                    id CHAR(36) NOT NULL PRIMARY KEY,
                    org_id CHAR(36) NOT NULL,
                    lead_id CHAR(36) DEFAULT NULL,
                    contact_phone VARCHAR(20) NOT NULL,
                    contact_name VARCHAR(255) DEFAULT NULL,
                    waba_id VARCHAR(64) DEFAULT NULL,
                    phone_number_id VARCHAR(64) DEFAULT NULL,
                    started_by CHAR(36) DEFAULT NULL,
                    assigned_to CHAR(36) DEFAULT NULL,
                    assigned_by CHAR(36) DEFAULT NULL,
                    assigned_at TIMESTAMP NULL DEFAULT NULL,
                    last_message_at TIMESTAMP NULL DEFAULT NULL,
                    last_message_preview VARCHAR(255) DEFAULT NULL,
                    unread_count INT NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_wa_conv_org_phone (org_id, contact_phone),
                    KEY idx_wa_conv_org_last (org_id, last_message_at),
                    KEY idx_wa_conv_started (org_id, started_by),
                    KEY idx_wa_conv_assigned (org_id, assigned_to)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
            );
        } catch (Throwable $e) {
        }

        $cols = [
            'started_by' => 'CHAR(36) DEFAULT NULL',
            'assigned_to' => 'CHAR(36) DEFAULT NULL',
            'assigned_by' => 'CHAR(36) DEFAULT NULL',
            'assigned_at' => 'TIMESTAMP NULL DEFAULT NULL',
            'window_open' => 'TINYINT(1) NOT NULL DEFAULT 0',
            'window_expires_at' => 'DATETIME NULL DEFAULT NULL',
        ];
        foreach ($cols as $name => $def) {
            if (function_exists('syncpediaColumnExists') && syncpediaColumnExists($db, 'wa_conversations', $name)) {
                continue;
            }
            try {
                $db->exec("ALTER TABLE wa_conversations ADD COLUMN `{$name}` {$def}");
            } catch (Throwable $e) {
            }
        }
        try {
            $db->exec('CREATE INDEX idx_wa_conv_started ON wa_conversations (org_id, started_by)');
        } catch (Throwable $e) {
        }
        try {
            $db->exec('CREATE INDEX idx_wa_conv_assigned ON wa_conversations (org_id, assigned_to)');
        } catch (Throwable $e) {
        }
        try {
            $db->exec('CREATE INDEX idx_wa_conv_window ON wa_conversations (window_open, window_expires_at)');
        } catch (Throwable $e) {
        }
    }

    /** Open/refresh the Meta 24h customer-care window after an inbound customer message. */
    public static function openCustomerCareWindow(PDO $db, string $conversationId, ?string $fromTs = null): void
    {
        if ($conversationId === '') {
            return;
        }
        $base = $fromTs && strtotime($fromTs) ? strtotime($fromTs) : time();
        $expires = date('Y-m-d H:i:s', $base + 86400);
        try {
            $db->prepare(
                'UPDATE wa_conversations
                 SET window_open = 1, window_expires_at = ?, updated_at = NOW()
                 WHERE id = ?',
            )->execute([$expires, $conversationId]);
        } catch (Throwable $e) {
        }
    }

    /** Close expired windows (also run from cron every ~5 minutes). */
    public static function closeExpiredWindows(PDO $db): int
    {
        try {
            $st = $db->prepare(
                'UPDATE wa_conversations
                 SET window_open = 0, updated_at = NOW()
                 WHERE window_open = 1
                   AND window_expires_at IS NOT NULL
                   AND window_expires_at < NOW()',
            );
            $st->execute();
            return (int) $st->rowCount();
        } catch (Throwable $e) {
            return 0;
        }
    }

    /** True if free-text session messages are allowed for this conversation row. */
    public static function isWindowOpen(array $conversation): bool
    {
        if (!(int) ($conversation['window_open'] ?? 0)) {
            return false;
        }
        $exp = trim((string) ($conversation['window_expires_at'] ?? ''));
        if ($exp === '') {
            return true;
        }
        $ts = strtotime($exp);
        return $ts === false || $ts > time();
    }

    /**
     * When a user sends outbound on a thread: claim started_by if empty.
     * Does not overwrite an existing started_by (keeps first owner).
     */
    public static function touchOutboundOwnership(PDO $db, string $conversationId, string $userId): void
    {
        if ($conversationId === '' || $userId === '') {
            return;
        }
        try {
            $db->prepare(
                'UPDATE wa_conversations
                 SET started_by = COALESCE(started_by, ?),
                     updated_at = NOW()
                 WHERE id = ?',
            )->execute([$userId, $conversationId]);
        } catch (Throwable $e) {
        }
    }

    public static function assignConversation(
        PDO $db,
        string $conversationId,
        ?string $assigneeUserId,
        string $assignedBy,
    ): bool {
        if ($conversationId === '') {
            return false;
        }
        $st = $db->prepare(
            'UPDATE wa_conversations
             SET assigned_to = ?, assigned_by = ?, assigned_at = NOW(), updated_at = NOW()
             WHERE id = ?',
        );
        $st->execute([$assigneeUserId, $assignedBy, $conversationId]);
        // Confirm the row exists (rowCount can be 0 when values unchanged).
        $chk = $db->prepare('SELECT id FROM wa_conversations WHERE id = ? LIMIT 1');
        $chk->execute([$conversationId]);
        return (bool) $chk->fetch(PDO::FETCH_ASSOC);
    }

    /** Roles that see every chat in the org (managers / admins). */
    public static function isOrgWideInboxRole(string $role): bool
    {
        $r = strtolower(trim($role));
        return in_array($r, ['super_admin', 'admin', 'org', 'manager'], true);
    }

    /** Field roles that only see chats they started or were assigned. */
    public static function isFieldInboxRole(string $role): bool
    {
        $r = strtolower(trim($role));
        if ($r === 'sales_representative' || $r === 'sales_rep' || $r === 'marketing') {
            return true;
        }
        return str_starts_with($r, 'marketing');
    }

    /**
     * Assignable teammates for managers: sales reps + digital marketing in the org.
     * @return list<array<string,mixed>>
     */
    public static function listAssignableMembers(PDO $db, string $orgId): array
    {
        $st = $db->prepare(
            "SELECT id, full_name, email, role
             FROM users
             WHERE org_id = ? AND is_active = 1
               AND (
                 LOWER(TRIM(role)) IN ('sales_representative', 'sales_rep', 'marketing')
                 OR LOWER(TRIM(role)) LIKE 'marketing%'
               )
             ORDER BY full_name ASC",
        );
        $st->execute([$orgId]);
        return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * @return list<array<string,mixed>>
     */
    public static function listConversationsForUser(
        PDO $db,
        string $orgId,
        string $userId,
        string $role,
        int $limit = 50,
    ): array {
        self::ensureTables($db);
        $limit = min(100, max(10, $limit));
        $wide = self::isOrgWideInboxRole($role);

        $sql = "SELECT c.*,
                       su.full_name AS started_by_name,
                       au.full_name AS assigned_to_name,
                       abu.full_name AS assigned_by_name
                FROM wa_conversations c
                LEFT JOIN users su ON su.id = c.started_by
                LEFT JOIN users au ON au.id = c.assigned_to
                LEFT JOIN users abu ON abu.id = c.assigned_by
                WHERE c.org_id = ?";
        $params = [$orgId];

        if (!$wide) {
            $sql .= ' AND (c.started_by = ? OR c.assigned_to = ?)';
            $params[] = $userId;
            $params[] = $userId;
        }

        $sql .= ' ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC LIMIT ' . (int) $limit;
        $st = $db->prepare($sql);
        $st->execute($params);
        return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    public static function userCanAccessConversation(
        PDO $db,
        array $conversation,
        string $userId,
        string $role,
    ): bool {
        if (self::isOrgWideInboxRole($role)) {
            return true;
        }
        $started = (string) ($conversation['started_by'] ?? '');
        $assigned = (string) ($conversation['assigned_to'] ?? '');
        return $started === $userId || $assigned === $userId;
    }

    private static function ensureMessageColumns(PDO $db): void
    {
        $cols = [
            'direction' => "VARCHAR(10) NOT NULL DEFAULT 'outbound'",
            'sender_phone' => 'VARCHAR(20) DEFAULT NULL',
            'message_type' => "VARCHAR(20) DEFAULT 'text'",
            'media_url' => 'VARCHAR(500) DEFAULT NULL',
            'conversation_id' => 'CHAR(36) DEFAULT NULL',
            'meta_timestamp' => 'TIMESTAMP NULL DEFAULT NULL',
        ];
        foreach ($cols as $name => $def) {
            if (function_exists('syncpediaColumnExists') && syncpediaColumnExists($db, 'comm_whatsapp_messages', $name)) {
                continue;
            }
            try {
                $db->exec("ALTER TABLE comm_whatsapp_messages ADD COLUMN `{$name}` {$def}");
            } catch (Throwable $e) {
            }
        }
        try {
            $db->exec('ALTER TABLE comm_whatsapp_messages MODIFY COLUMN user_id CHAR(36) NULL');
        } catch (Throwable $e) {
        }
        try {
            $db->exec('CREATE UNIQUE INDEX uq_wa_msg_provider_id ON comm_whatsapp_messages (provider_message_id)');
        } catch (Throwable $e) {
            // Index may already exist or column allow multiple NULLs — ignore.
        }
    }

    public static function normalizePhone(string $phone): string
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        $digits = ltrim($digits, '0');
        if ($digits === '') {
            return '';
        }
        if (strlen($digits) === 10) {
            return '91' . $digits;
        }
        return $digits;
    }

    /**
     * Return $leadId only if it still exists in leads; otherwise null.
     * When a conversation id is given and the lead is gone, clear the stale FK on the conversation.
     */
    public static function resolveValidLeadId(PDO $db, ?string $leadId, ?string $conversationId = null): ?string
    {
        $leadId = $leadId !== null ? trim($leadId) : '';
        if ($leadId === '') {
            return null;
        }
        try {
            $st = $db->prepare('SELECT id FROM leads WHERE id = ? LIMIT 1');
            $st->execute([$leadId]);
            if ($st->fetchColumn()) {
                return $leadId;
            }
        } catch (Throwable $e) {
            return null;
        }
        if ($conversationId !== null && trim($conversationId) !== '') {
            try {
                $db->prepare('UPDATE wa_conversations SET lead_id = NULL WHERE id = ? AND lead_id = ?')
                    ->execute([trim($conversationId), $leadId]);
            } catch (Throwable $e) {
                // Best-effort cleanup; message insert must still proceed with null lead_id.
            }
        }
        return null;
    }

    public static function findOrCreateConversation(
        PDO $db,
        string $orgId,
        string $contactPhone,
        ?string $contactName,
        ?string $wabaId,
        ?string $phoneNumberId,
    ): ?array {
        self::ensureTables($db);
        $phone = self::normalizePhone($contactPhone);
        if ($phone === '') {
            return null;
        }

        $st = $db->prepare('SELECT * FROM wa_conversations WHERE org_id = ? AND contact_phone = ? LIMIT 1');
        $st->execute([$orgId, $phone]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (is_array($row)) {
            if ($contactName && trim($contactName) !== '' && empty($row['contact_name'])) {
                $db->prepare('UPDATE wa_conversations SET contact_name = ? WHERE id = ?')->execute([trim($contactName), $row['id']]);
                $row['contact_name'] = trim($contactName);
            }
            $staleLead = isset($row['lead_id']) ? trim((string) $row['lead_id']) : '';
            if ($staleLead !== '') {
                $valid = self::resolveValidLeadId($db, $staleLead, (string) ($row['id'] ?? ''));
                if ($valid === null) {
                    $row['lead_id'] = null;
                }
            }
            return $row;
        }

        $leadId = self::findOrCreateLeadForPhone($db, $orgId, $phone, $contactName);
        $id = generateUUID();
        try {
            $db->prepare(
                'INSERT INTO wa_conversations (id, org_id, lead_id, contact_phone, contact_name, waba_id, phone_number_id, last_message_at, unread_count)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 0)',
            )->execute([
                $id,
                $orgId,
                $leadId,
                $phone,
                $contactName ? trim($contactName) : null,
                $wabaId,
                $phoneNumberId,
            ]);
        } catch (PDOException $e) {
            // Concurrent first message lost the race on UNIQUE(org_id, contact_phone) — reuse the winner's row.
            $sqlState = (string) ($e->errorInfo[0] ?? $e->getCode());
            if ($sqlState !== '23000' && $sqlState !== '23505') {
                throw $e;
            }
        }
        $st->execute([$orgId, $phone]);
        return $st->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public static function findOrCreateLeadForPhone(PDO $db, string $orgId, string $phone, ?string $name): ?string
    {
        $phone = self::normalizePhone($phone);
        if ($phone === '') {
            return null;
        }
        $local = strlen($phone) > 10 ? substr($phone, -10) : $phone;

        $exact = $db->prepare(
            "SELECT id FROM leads
             WHERE org_id = ?
               AND REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') = ?
             ORDER BY created_at DESC LIMIT 1",
        );
        $exact->execute([$orgId, $phone]);
        $existing = $exact->fetchColumn();
        if ($existing) {
            return (string) $existing;
        }

        $st = $db->prepare(
            "SELECT id FROM leads
             WHERE org_id = ?
               AND (
                 REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ?
                 OR REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ?
               )
             ORDER BY created_at DESC LIMIT 1",
        );
        $st->execute([$orgId, '%' . $local, $phone . '%']);
        $existing = $st->fetchColumn();
        if ($existing) {
            return (string) $existing;
        }

        $leadName = ($name && trim($name) !== '') ? trim($name) : ('WhatsApp ' . $local);
        $id = generateUUID();
        try {
            $db->prepare(
                "INSERT INTO leads (id, name, email, phone, source, status, org_id, created_at, updated_at)
                 VALUES (?, ?, NULL, ?, 'whatsapp_inbound', 'new', ?, NOW(), NOW())",
            )->execute([$id, $leadName, '+' . $phone, $orgId]);
            return $id;
        } catch (Throwable $e) {
            error_log('[WhatsAppInbox] lead create failed: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * @param array<string,mixed> $msg Meta messages[] item
     */
    public static function storeInboundMessage(
        PDO $db,
        string $orgId,
        array $conversation,
        array $msg,
        ?string $contactName,
        ?string $businessDisplayPhone = null,
    ): ?string {
        self::ensureTables($db);
        $providerId = (string) ($msg['id'] ?? '');
        if ($providerId === '') {
            // Meta almost always sends an id; without one we cannot dedupe retries.
            // Fingerprint so duplicate deliveries do not inflate unread_count.
            $fromTmp = (string) ($msg['from'] ?? '');
            $typeTmp = (string) ($msg['type'] ?? 'text');
            $bodyTmp = (string) ($msg['text']['body'] ?? '');
            $tsTmp = (string) ($msg['timestamp'] ?? '');
            $providerId = 'fp:' . substr(hash('sha256', $orgId . '|' . $fromTmp . '|' . $typeTmp . '|' . $bodyTmp . '|' . $tsTmp), 0, 40);
        }
        $dup = $db->prepare('SELECT id FROM comm_whatsapp_messages WHERE provider_message_id = ? LIMIT 1');
        $dup->execute([$providerId]);
        if ($dup->fetchColumn()) {
            return null;
        }

        $from = (string) ($msg['from'] ?? '');
        $customerPhone = self::normalizePhone($from);
        $businessPhone = $businessDisplayPhone !== null && $businessDisplayPhone !== ''
            ? self::normalizePhone($businessDisplayPhone)
            : '';
        $type = (string) ($msg['type'] ?? 'text');
        $body = '';
        $mediaUrl = null;

        if ($type === 'text') {
            $body = (string) ($msg['text']['body'] ?? '');
        } elseif (in_array($type, ['image', 'document', 'audio', 'video', 'sticker'], true)) {
            $media = $msg[$type] ?? [];
            $mediaId = is_array($media) ? (string) ($media['id'] ?? '') : '';
            $caption = is_array($media) ? (string) ($media['caption'] ?? '') : '';
            $body = $caption !== '' ? $caption : '[' . $type . ']';
            $mediaUrl = $mediaId !== '' ? 'meta-media:' . $mediaId : null;
        } else {
            $body = '[' . $type . ' message]';
        }

        $ts = isset($msg['timestamp']) ? date('Y-m-d H:i:s', (int) $msg['timestamp']) : date('Y-m-d H:i:s');
        $id = generateUUID();
        $convId = (string) ($conversation['id'] ?? '');
        $leadId = self::resolveValidLeadId(
            $db,
            isset($conversation['lead_id']) ? (string) $conversation['lead_id'] : null,
            $convId !== '' ? $convId : null,
        );

        try {
            $db->prepare(
                'INSERT INTO comm_whatsapp_messages
             (id, org_id, user_id, recipient_phone, sender_phone, recipient_name, message_body, message_type, media_url,
              status, provider_message_id, lead_id, direction, conversation_id, meta_timestamp, sent_at)
             VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            )->execute([
                $id,
                $orgId,
                $businessPhone !== '' ? $businessPhone : $customerPhone,
                $customerPhone,
                $contactName,
                $body,
                $type,
                $mediaUrl,
                'received',
                $providerId,
                $leadId,
                'inbound',
                $convId !== '' ? $convId : null,
                $ts,
                $ts,
            ]);
        } catch (Throwable $e) {
            // Concurrent Meta retry under UNIQUE(provider_message_id)
            if ($providerId !== '' && (stripos($e->getMessage(), 'Duplicate') !== false || stripos($e->getMessage(), 'unique') !== false)) {
                return null;
            }
            throw $e;
        }

        $preview = self::previewText($body, 200);
        $db->prepare(
            'UPDATE wa_conversations SET last_message_at = ?, last_message_preview = ?, unread_count = unread_count + 1, updated_at = NOW() WHERE id = ?',
        )->execute([$ts, $preview, $convId]);
        self::openCustomerCareWindow($db, $convId, $ts);

        return $id;
    }

    public static function logWebhook(
        PDO $db,
        string $eventType,
        ?string $orgId,
        ?string $providerMessageId,
        ?string $contactPhone,
        ?string $status,
        ?string $error,
        ?array $payload,
    ): void {
        self::ensureTables($db);
        try {
            $db->prepare(
                'INSERT INTO wa_webhook_logs (id, org_id, event_type, provider_message_id, contact_phone, status, error_message, payload_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            )->execute([
                generateUUID(),
                $orgId,
                $eventType,
                $providerMessageId,
                $contactPhone,
                $status,
                $error,
                $payload !== null ? json_encode($payload, JSON_UNESCAPED_UNICODE) : null,
            ]);
        } catch (Throwable $e) {
            error_log('[wa_webhook] log failed: ' . $e->getMessage());
        }
    }

    /**
     * Record an outbound automation/campaign send into the inbox so admins can review it.
     * Dedupes by provider_message_id when present.
     *
     * @return string|null message id
     */
    public static function recordOutboundAutomation(
        PDO $db,
        string $orgId,
        string $phone,
        string $body,
        ?string $userId = null,
        ?string $templateId = null,
        ?string $providerMessageId = null,
        string $status = 'sent',
        ?string $recipientName = null,
        ?string $errorMessage = null,
        ?string $wabaId = null,
        ?string $phoneNumberId = null,
    ): ?string {
        self::ensureTables($db);
        $normalized = self::normalizePhone($phone);
        if ($orgId === '' || $normalized === '') {
            return null;
        }

        $wamid = $providerMessageId !== null ? trim($providerMessageId) : '';
        if ($wamid !== '') {
            $dup = $db->prepare('SELECT id FROM comm_whatsapp_messages WHERE provider_message_id = ? LIMIT 1');
            $dup->execute([$wamid]);
            $existingId = $dup->fetchColumn();
            if ($existingId) {
                $conv = self::findOrCreateConversation($db, $orgId, $normalized, $recipientName, $wabaId, $phoneNumberId);
                if ($conv) {
                    $db->prepare(
                        'UPDATE comm_whatsapp_messages
                         SET conversation_id = COALESCE(conversation_id, ?), status = ?, error_message = COALESCE(?, error_message)
                         WHERE id = ?',
                    )->execute([(string) $conv['id'], $status, $errorMessage, (string) $existingId]);
                    if ($userId) {
                        self::touchOutboundOwnership($db, (string) $conv['id'], $userId);
                    }
                }
                return (string) $existingId;
            }
        }

        $conv = self::findOrCreateConversation($db, $orgId, $normalized, $recipientName, $wabaId, $phoneNumberId);
        if (!$conv) {
            return null;
        }
        $convId = (string) $conv['id'];
        $leadId = self::resolveValidLeadId(
            $db,
            isset($conv['lead_id']) ? (string) $conv['lead_id'] : null,
            $convId,
        );
        $msgId = generateUUID();
        $now = date('Y-m-d H:i:s');
        $previewBody = $body !== '' ? $body : '[WhatsApp template]';

        try {
            $db->prepare(
                'INSERT INTO comm_whatsapp_messages
                 (id, org_id, user_id, virtual_number_id, template_id, recipient_phone, recipient_name, variables,
                  message_body, message_type, status, provider_message_id, error_message, lead_id, direction, conversation_id, sent_at)
                 VALUES (?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )->execute([
                $msgId,
                $orgId,
                $userId,
                $templateId,
                $normalized,
                $recipientName,
                '[]',
                $previewBody,
                'template',
                $status,
                $wamid !== '' ? $wamid : null,
                $errorMessage,
                $leadId,
                'outbound',
                $convId,
                $status === 'failed' ? null : $now,
            ]);
        } catch (Throwable $e) {
            if ($wamid !== '' && (stripos($e->getMessage(), 'Duplicate') !== false || stripos($e->getMessage(), 'unique') !== false)) {
                return null;
            }
            error_log('[WhatsAppInbox] recordOutboundAutomation: ' . $e->getMessage());
            return null;
        }

        if ($userId) {
            self::touchOutboundOwnership($db, $convId, $userId);
        }
        if ($status !== 'failed') {
            $db->prepare(
                'UPDATE wa_conversations SET last_message_at = ?, last_message_preview = ?, updated_at = NOW() WHERE id = ?',
            )->execute([$now, self::previewText($previewBody, 200), $convId]);
        }

        return $msgId;
    }

    /**
     * Link existing CRM WhatsApp rows (and campaign sends) into wa_conversations for an org.
     * @return array{conversations:int,messages_linked:int,campaign_imports:int}
     */
    public static function backfillInboxForOrg(PDO $db, string $orgId, int $limit = 2000): array
    {
        self::ensureTables($db);
        $out = ['conversations' => 0, 'messages_linked' => 0, 'campaign_imports' => 0];
        if ($orgId === '') {
            return $out;
        }

        $wabaId = null;
        $phoneNumberId = null;
        try {
            if (function_exists('commLoadOrgConfig')) {
                $cfg = commLoadOrgConfig($db, $orgId);
                $wabaId = isset($cfg['waba_id']) ? (string) $cfg['waba_id'] : null;
                $phoneNumberId = isset($cfg['phone_number_id']) ? (string) $cfg['phone_number_id'] : null;
            }
        } catch (Throwable $ignored) {
        }

        $limit = max(100, min(5000, $limit));

        // 1) Attach orphan outbound/inbound messages to conversations
        try {
            $st = $db->prepare(
                "SELECT id, recipient_phone, sender_phone, recipient_name, message_body, direction, status, sent_at, created_at, user_id, provider_message_id
                 FROM comm_whatsapp_messages
                 WHERE org_id = ?
                   AND (conversation_id IS NULL OR conversation_id = '')
                 ORDER BY created_at DESC
                 LIMIT {$limit}",
            );
            $st->execute([$orgId]);
            $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
            $seenPhones = [];
            foreach ($rows as $row) {
                $dir = strtolower((string) ($row['direction'] ?? 'outbound'));
                $phone = $dir === 'inbound'
                    ? self::normalizePhone((string) ($row['sender_phone'] ?? $row['recipient_phone'] ?? ''))
                    : self::normalizePhone((string) ($row['recipient_phone'] ?? ''));
                if ($phone === '') {
                    continue;
                }
                $conv = self::findOrCreateConversation(
                    $db,
                    $orgId,
                    $phone,
                    isset($row['recipient_name']) ? (string) $row['recipient_name'] : null,
                    $wabaId,
                    $phoneNumberId,
                );
                if (!$conv) {
                    continue;
                }
                if (!isset($seenPhones[$phone])) {
                    $seenPhones[$phone] = true;
                    $out['conversations']++;
                }
                $db->prepare('UPDATE comm_whatsapp_messages SET conversation_id = ? WHERE id = ? AND (conversation_id IS NULL OR conversation_id = \'\')')
                    ->execute([(string) $conv['id'], (string) $row['id']]);
                $out['messages_linked']++;
                $uid = trim((string) ($row['user_id'] ?? ''));
                if ($uid !== '') {
                    self::touchOutboundOwnership($db, (string) $conv['id'], $uid);
                }
                $ts = (string) ($row['sent_at'] ?? $row['created_at'] ?? '');
                $preview = self::previewText((string) ($row['message_body'] ?? ''), 200);
                if ($ts !== '' && $preview !== '') {
                    try {
                        $db->prepare(
                            'UPDATE wa_conversations
                             SET last_message_at = CASE
                                   WHEN last_message_at IS NULL OR last_message_at < ? THEN ?
                                   ELSE last_message_at
                                 END,
                                 last_message_preview = CASE
                                   WHEN last_message_at IS NULL OR last_message_at <= ? THEN ?
                                   ELSE last_message_preview
                                 END,
                                 updated_at = NOW()
                             WHERE id = ?',
                        )->execute([$ts, $ts, $ts, $preview, (string) $conv['id']]);
                    } catch (Throwable $ignored) {
                    }
                }
            }
        } catch (Throwable $e) {
            error_log('[WhatsAppInbox] backfill messages: ' . $e->getMessage());
        }

        // 2) Import marketing/form campaign sends that never hit the inbox
        try {
            $st = $db->prepare(
                "SELECT ws.id, ws.recipient_phone, ws.status, ws.error_message, ws.created_at, wc.created_by, wc.subject, wc.org_id
                 FROM whatsapp_sends ws
                 INNER JOIN whatsapp_campaigns wc ON wc.id = ws.campaign_id
                 WHERE wc.org_id = ?
                   AND ws.status IN ('sent', 'delivered', 'read', 'failed', 'pending')
                 ORDER BY ws.created_at DESC
                 LIMIT {$limit}",
            );
            $st->execute([$orgId]);
            foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                $phone = self::normalizePhone((string) ($row['recipient_phone'] ?? ''));
                if ($phone === '') {
                    continue;
                }
                // Skip if we already have a message for this phone on that day with same campaign subject preview
                $subject = trim((string) ($row['subject'] ?? 'Campaign'));
                $body = '[Automation] ' . ($subject !== '' ? $subject : 'WhatsApp campaign');
                $fingerprint = 'campaign-send:' . (string) $row['id'];
                $dup = $db->prepare('SELECT id FROM comm_whatsapp_messages WHERE provider_message_id = ? LIMIT 1');
                $dup->execute([$fingerprint]);
                if ($dup->fetchColumn()) {
                    continue;
                }
                $status = strtolower((string) ($row['status'] ?? 'sent'));
                if ($status === 'pending') {
                    $status = 'queued';
                }
                if (!in_array($status, ['sent', 'delivered', 'read', 'failed', 'queued'], true)) {
                    $status = 'sent';
                }
                $id = self::recordOutboundAutomation(
                    $db,
                    $orgId,
                    $phone,
                    $body,
                    trim((string) ($row['created_by'] ?? '')) ?: null,
                    null,
                    $fingerprint,
                    $status === 'queued' ? 'sent' : $status,
                    null,
                    isset($row['error_message']) ? (string) $row['error_message'] : null,
                    $wabaId,
                    $phoneNumberId,
                );
                if ($id) {
                    $out['campaign_imports']++;
                }
            }
        } catch (Throwable $e) {
            error_log('[WhatsAppInbox] backfill campaigns: ' . $e->getMessage());
        }

        return $out;
    }

    /**
     * Ingest Meta coexistence / onboarding history webhook chunks into the inbox.
     * @param array<string,mixed> $value change.value payload
     * @return int messages stored
     */
    public static function ingestHistoryWebhook(PDO $db, string $orgId, array $value): int
    {
        self::ensureTables($db);
        if ($orgId === '') {
            return 0;
        }
        $phoneNumberId = (string) ($value['metadata']['phone_number_id'] ?? '');
        $displayPhone = (string) ($value['metadata']['display_phone_number'] ?? '');
        $wabaId = null;
        $stored = 0;

        $historyBlocks = $value['history'] ?? [];
        if (!is_array($historyBlocks)) {
            return 0;
        }

        foreach ($historyBlocks as $block) {
            if (!is_array($block)) {
                continue;
            }
            // Declined / error payloads have no threads
            if (!empty($block['errors']) && empty($block['threads'])) {
                self::logWebhook($db, 'history_error', $orgId, null, null, 'error', json_encode($block['errors']), $block);
                continue;
            }
            foreach ($block['threads'] ?? [] as $thread) {
                if (!is_array($thread)) {
                    continue;
                }
                $contactPhone = (string) ($thread['id'] ?? '');
                if ($contactPhone === '') {
                    continue;
                }
                $conv = self::findOrCreateConversation($db, $orgId, $contactPhone, null, $wabaId, $phoneNumberId !== '' ? $phoneNumberId : null);
                if (!$conv) {
                    continue;
                }
                foreach ($thread['messages'] ?? [] as $msg) {
                    if (!is_array($msg)) {
                        continue;
                    }
                    $from = (string) ($msg['from'] ?? '');
                    $normalizedFrom = self::normalizePhone($from);
                    $normalizedContact = self::normalizePhone($contactPhone);
                    $normalizedBiz = self::normalizePhone($displayPhone);
                    $isOutbound = $normalizedFrom !== '' && $normalizedBiz !== '' && $normalizedFrom === $normalizedBiz;
                    if (!$isOutbound && $normalizedFrom !== '' && $normalizedContact !== '' && $normalizedFrom !== $normalizedContact) {
                        // from is business phone in some payloads
                        $isOutbound = true;
                    }
                    if ($isOutbound) {
                        $type = (string) ($msg['type'] ?? 'text');
                        $body = '';
                        if ($type === 'text') {
                            $body = (string) ($msg['text']['body'] ?? '');
                        } else {
                            $body = '[' . $type . ' message]';
                        }
                        $wamid = (string) ($msg['id'] ?? '');
                        $histStatus = strtolower((string) ($msg['history_context']['status'] ?? 'sent'));
                        if (!in_array($histStatus, ['sent', 'delivered', 'read', 'failed'], true)) {
                            $histStatus = 'sent';
                        }
                        $id = self::recordOutboundAutomation(
                            $db,
                            $orgId,
                            $contactPhone,
                            $body !== '' ? $body : '[WhatsApp message]',
                            null,
                            null,
                            $wamid !== '' ? $wamid : null,
                            $histStatus,
                            null,
                            null,
                            $wabaId,
                            $phoneNumberId !== '' ? $phoneNumberId : null,
                        );
                        if ($id) {
                            $stored++;
                        }
                    } else {
                        $id = self::storeInboundMessage($db, $orgId, $conv, $msg, null, $displayPhone);
                        if ($id) {
                            $stored++;
                        }
                    }
                }
            }
        }

        return $stored;
    }
}
