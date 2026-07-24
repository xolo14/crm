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
        if ($providerId !== '') {
            $dup = $db->prepare('SELECT id FROM comm_whatsapp_messages WHERE provider_message_id = ? LIMIT 1');
            $dup->execute([$providerId]);
            if ($dup->fetchColumn()) {
                return null;
            }
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
                $providerId !== '' ? $providerId : null,
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
}
