<?php
declare(strict_types=1);

/**
 * Per-organization Razorpay credentials (Key ID / Secret / Webhook Secret).
 * Secrets are AES-256-GCM encrypted at rest (same key material pattern as org SMTP).
 */

function syncpediaEnsureOrgRazorpaySchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    if (function_exists('syncpediaDbIsMysql') && !syncpediaDbIsMysql($db)) {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS org_razorpay_config (
                org_id VARCHAR(36) PRIMARY KEY,
                key_id VARCHAR(80) NOT NULL DEFAULT '',
                key_secret_ciphertext TEXT,
                key_secret_nonce VARCHAR(64),
                key_secret_tag VARCHAR(64),
                webhook_secret_ciphertext TEXT,
                webhook_secret_nonce VARCHAR(64),
                webhook_secret_tag VARCHAR(64),
                mode VARCHAR(16) NOT NULL DEFAULT 'live',
                is_active SMALLINT NOT NULL DEFAULT 1,
                updated_by VARCHAR(36),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )",
        );
    } else {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS org_razorpay_config (
                org_id CHAR(36) NOT NULL,
                key_id VARCHAR(80) NOT NULL DEFAULT '',
                key_secret_ciphertext TEXT NULL,
                key_secret_nonce VARCHAR(64) NULL,
                key_secret_tag VARCHAR(64) NULL,
                webhook_secret_ciphertext TEXT NULL,
                webhook_secret_nonce VARCHAR(64) NULL,
                webhook_secret_tag VARCHAR(64) NULL,
                mode VARCHAR(16) NOT NULL DEFAULT 'live',
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                updated_by CHAR(36) NULL,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (org_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        );
    }
    $done = true;
}

function syncpediaOrgRazorpayKey(): string
{
    $raw = defined('SMTP_CREDENTIAL_KEY_V1') ? trim((string) SMTP_CREDENTIAL_KEY_V1) : '';
    if ($raw !== '') {
        $decoded = base64_decode($raw, true);
        if (is_string($decoded) && strlen($decoded) === 32) {
            return $decoded;
        }
    }
    return hash('sha256', 'syncpedia-org-razorpay-v1|' . (defined('JWT_SECRET') ? (string) JWT_SECRET : ''), true);
}

/** @return array{ciphertext:string,nonce:string,tag:string} */
function syncpediaEncryptOrgRazorpaySecret(string $secret, string $orgId, string $field): array
{
    $nonce = random_bytes(12);
    $tag = '';
    $cipher = openssl_encrypt(
        $secret,
        'aes-256-gcm',
        syncpediaOrgRazorpayKey(),
        OPENSSL_RAW_DATA,
        $nonce,
        $tag,
        "org-rzp:v1|{$orgId}|{$field}",
        16,
    );
    if (!is_string($cipher)) {
        throw new RuntimeException('Could not encrypt Razorpay credential');
    }
    return [
        'ciphertext' => base64_encode($cipher),
        'nonce' => base64_encode($nonce),
        'tag' => base64_encode($tag),
    ];
}

function syncpediaDecryptOrgRazorpaySecret(array $row, string $field): string
{
    $prefix = $field === 'webhook' ? 'webhook_secret_' : 'key_secret_';
    $cipher = base64_decode((string) ($row[$prefix . 'ciphertext'] ?? ''), true);
    $nonce = base64_decode((string) ($row[$prefix . 'nonce'] ?? ''), true);
    $tag = base64_decode((string) ($row[$prefix . 'tag'] ?? ''), true);
    if (!is_string($cipher) || !is_string($nonce) || !is_string($tag) || $cipher === '') {
        throw new RuntimeException('Stored Razorpay credential is invalid');
    }
    $plain = openssl_decrypt(
        $cipher,
        'aes-256-gcm',
        syncpediaOrgRazorpayKey(),
        OPENSSL_RAW_DATA,
        $nonce,
        $tag,
        'org-rzp:v1|' . (string) $row['org_id'] . '|' . $field,
    );
    if (!is_string($plain) || $plain === '') {
        throw new RuntimeException('Could not decrypt Razorpay credential');
    }
    return $plain;
}

/**
 * @return array{key_id:string,key_secret:string,webhook_secret:string,mode:string}|null
 */
function syncpediaLoadOrgRazorpayCredentials(PDO $db, string $orgId): ?array
{
    $orgId = trim($orgId);
    if ($orgId === '') {
        return null;
    }
    syncpediaEnsureOrgRazorpaySchema($db);
    $st = $db->prepare('SELECT * FROM org_razorpay_config WHERE org_id = ? AND is_active = 1 LIMIT 1');
    $st->execute([$orgId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return null;
    }
    $keyId = trim((string) ($row['key_id'] ?? ''));
    if ($keyId === '' || !str_starts_with($keyId, 'rzp_')) {
        return null;
    }
    try {
        $keySecret = syncpediaDecryptOrgRazorpaySecret($row, 'key');
    } catch (Throwable $e) {
        error_log('[org-rzp] key decrypt failed for org ' . $orgId . ': ' . $e->getMessage());
        return null;
    }
    $webhookSecret = '';
    if (!empty($row['webhook_secret_ciphertext'])) {
        try {
            $webhookSecret = syncpediaDecryptOrgRazorpaySecret($row, 'webhook');
        } catch (Throwable $e) {
            error_log('[org-rzp] webhook decrypt failed for org ' . $orgId . ': ' . $e->getMessage());
        }
    }
    return [
        'key_id' => $keyId,
        'key_secret' => $keySecret,
        'webhook_secret' => $webhookSecret,
        'mode' => trim((string) ($row['mode'] ?? 'live')) ?: 'live',
    ];
}

/** Public status for Settings UI (never returns secrets). */
function syncpediaOrgRazorpayPublicStatus(PDO $db, string $orgId): array
{
    syncpediaEnsureOrgRazorpaySchema($db);
    $st = $db->prepare('SELECT * FROM org_razorpay_config WHERE org_id = ? LIMIT 1');
    $st->execute([$orgId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return [
            'configured' => false,
            'key_id' => '',
            'key_id_masked' => '',
            'key_secret_set' => false,
            'webhook_secret_set' => false,
            'mode' => 'live',
            'is_active' => false,
            'updated_at' => null,
        ];
    }
    $keyId = trim((string) ($row['key_id'] ?? ''));
    $masked = '';
    if ($keyId !== '') {
        $masked = strlen($keyId) > 10
            ? (substr($keyId, 0, 8) . str_repeat('•', max(4, strlen($keyId) - 12)) . substr($keyId, -4))
            : $keyId;
    }
    $keySet = trim((string) ($row['key_secret_ciphertext'] ?? '')) !== '';
    $whSet = trim((string) ($row['webhook_secret_ciphertext'] ?? '')) !== '';
    return [
        'configured' => $keyId !== '' && $keySet && (int) ($row['is_active'] ?? 0) === 1,
        'key_id' => $keyId,
        'key_id_masked' => $masked,
        'key_secret_set' => $keySet,
        'webhook_secret_set' => $whSet,
        'mode' => trim((string) ($row['mode'] ?? 'live')) ?: 'live',
        'is_active' => (int) ($row['is_active'] ?? 0) === 1,
        'updated_at' => $row['updated_at'] ?? null,
    ];
}
