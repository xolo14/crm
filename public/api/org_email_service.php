<?php
declare(strict_types=1);

/** Tenant SMTP context for the current request. */
function syncpediaSetMailContext(?string $orgId, string $category = 'default'): void
{
    $GLOBALS['syncpedia_mail_org_id'] = $orgId !== null ? trim($orgId) : '';
    $GLOBALS['syncpedia_mail_category'] = preg_match('/^[a-z][a-z0-9_]{0,49}$/', $category)
        ? $category
        : 'default';
}

function syncpediaSetMailCategory(string $category): void
{
    syncpediaSetMailContext(
        trim((string) ($GLOBALS['syncpedia_mail_org_id'] ?? '')) ?: null,
        $category,
    );
}

/** @return list<array{key:string,label:string}> */
function syncpediaMailCategories(): array
{
    return [
        ['key' => 'default', 'label' => 'Default / other transactional mail'],
        ['key' => 'offer_letters', 'label' => 'Offer letters'],
        ['key' => 'certificates', 'label' => 'Certificates'],
        ['key' => 'member_welcome', 'label' => 'Member welcome and credentials'],
        ['key' => 'password_reset', 'label' => 'Password reset OTP'],
        ['key' => 'payment_links', 'label' => 'Payment links and reminders'],
        ['key' => 'payment_receipts', 'label' => 'Payment receipts and invoices'],
        ['key' => 'payslips', 'label' => 'Payslips'],
        ['key' => 'form_links', 'label' => 'Form links'],
        ['key' => 'form_campaigns', 'label' => 'Form email campaigns'],
        ['key' => 'marketing_campaigns', 'label' => 'Marketing email campaigns'],
        ['key' => 'hr_updates', 'label' => 'HR and fresher updates'],
        ['key' => 'notifications', 'label' => 'Email notifications'],
    ];
}

function syncpediaEnsureOrgEmailSchema(PDO $db): void
{
    static $done = false;
    if ($done) return;
    if (!syncpediaDbIsMysql($db)) {
        $db->exec("CREATE TABLE IF NOT EXISTS org_smtp_accounts (
            id VARCHAR(36) PRIMARY KEY,
            org_id VARCHAR(36) NOT NULL,
            slot SMALLINT NOT NULL,
            label VARCHAR(100) NOT NULL,
            email VARCHAR(255) NOT NULL,
            from_name VARCHAR(150) NOT NULL DEFAULT '',
            secret_ciphertext TEXT NOT NULL,
            secret_nonce VARCHAR(64) NOT NULL,
            secret_tag VARCHAR(64) NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            last_tested_at TIMESTAMP NULL,
            last_test_status VARCHAR(20) NULL,
            last_error VARCHAR(500) NULL,
            created_by VARCHAR(36) NULL,
            updated_by VARCHAR(36) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (org_id, slot),
            UNIQUE (org_id, email)
        )");
        $db->exec("CREATE INDEX IF NOT EXISTS idx_org_smtp_active ON org_smtp_accounts (org_id, is_active)");
        $db->exec("CREATE TABLE IF NOT EXISTS org_email_routes (
            id VARCHAR(36) PRIMARY KEY,
            org_id VARCHAR(36) NOT NULL,
            category VARCHAR(50) NOT NULL,
            smtp_account_id VARCHAR(36) NOT NULL,
            updated_by VARCHAR(36) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (org_id, category)
        )");
        $db->exec("CREATE INDEX IF NOT EXISTS idx_org_email_route_account ON org_email_routes (org_id, smtp_account_id)");
        $done = true;
        return;
    }
    $db->exec("CREATE TABLE IF NOT EXISTS org_smtp_accounts (
        id CHAR(36) NOT NULL PRIMARY KEY,
        org_id CHAR(36) NOT NULL,
        slot TINYINT UNSIGNED NOT NULL,
        label VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        from_name VARCHAR(150) NOT NULL DEFAULT '',
        secret_ciphertext TEXT NOT NULL,
        secret_nonce VARCHAR(64) NOT NULL,
        secret_tag VARCHAR(64) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        last_tested_at DATETIME NULL,
        last_test_status VARCHAR(20) NULL,
        last_error VARCHAR(500) NULL,
        created_by CHAR(36) NULL,
        updated_by CHAR(36) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_org_smtp_slot (org_id, slot),
        UNIQUE KEY uq_org_smtp_email (org_id, email),
        KEY idx_org_smtp_active (org_id, is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $db->exec("CREATE TABLE IF NOT EXISTS org_email_routes (
        id CHAR(36) NOT NULL PRIMARY KEY,
        org_id CHAR(36) NOT NULL,
        category VARCHAR(50) NOT NULL,
        smtp_account_id CHAR(36) NOT NULL,
        updated_by CHAR(36) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_org_email_route (org_id, category),
        KEY idx_org_email_route_account (org_id, smtp_account_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $done = true;
}

function syncpediaOrgSmtpKey(): string
{
    $raw = defined('SMTP_CREDENTIAL_KEY_V1') ? trim((string) SMTP_CREDENTIAL_KEY_V1) : '';
    if ($raw !== '') {
        $decoded = base64_decode($raw, true);
        if (is_string($decoded) && strlen($decoded) === 32) return $decoded;
    }
    // Backward-compatible deployment fallback. A dedicated key remains recommended.
    return hash('sha256', 'syncpedia-org-smtp-v1|' . (defined('JWT_SECRET') ? (string) JWT_SECRET : ''), true);
}

/** @return array{ciphertext:string,nonce:string,tag:string} */
function syncpediaEncryptOrgSmtpSecret(string $secret, string $orgId, string $accountId): array
{
    $nonce = random_bytes(12);
    $tag = '';
    $cipher = openssl_encrypt(
        $secret,
        'aes-256-gcm',
        syncpediaOrgSmtpKey(),
        OPENSSL_RAW_DATA,
        $nonce,
        $tag,
        "org-smtp:v1|{$orgId}|{$accountId}",
        16,
    );
    if (!is_string($cipher)) throw new RuntimeException('Could not encrypt SMTP credential');
    return [
        'ciphertext' => base64_encode($cipher),
        'nonce' => base64_encode($nonce),
        'tag' => base64_encode($tag),
    ];
}

function syncpediaDecryptOrgSmtpSecret(array $row): string
{
    $cipher = base64_decode((string) ($row['secret_ciphertext'] ?? ''), true);
    $nonce = base64_decode((string) ($row['secret_nonce'] ?? ''), true);
    $tag = base64_decode((string) ($row['secret_tag'] ?? ''), true);
    if (!is_string($cipher) || !is_string($nonce) || !is_string($tag)) {
        throw new RuntimeException('Stored SMTP credential is invalid');
    }
    $plain = openssl_decrypt(
        $cipher,
        'aes-256-gcm',
        syncpediaOrgSmtpKey(),
        OPENSSL_RAW_DATA,
        $nonce,
        $tag,
        "org-smtp:v1|" . (string) $row['org_id'] . '|' . (string) $row['id'],
    );
    if (!is_string($plain) || $plain === '') throw new RuntimeException('Could not decrypt SMTP credential');
    return $plain;
}

function syncpediaOrganizationSlug(PDO $db, string $orgId): string
{
    $st = $db->prepare('SELECT LOWER(TRIM(slug)) FROM organizations WHERE id = ? LIMIT 1');
    $st->execute([$orgId]);
    return trim((string) ($st->fetchColumn() ?: ''));
}

/**
 * Resolve tenant SMTP. Org account routes take priority; global SMTP is allowed
 * only for the Syncpedia organization.
 *
 * @return array{ok:bool,tenant?:bool,user?:string,pass?:string,from_name?:string,profiles?:array,error?:string}
 */
function syncpediaResolveTenantSmtp(string $preferredGlobalAccount = 'support'): array
{
    $orgId = trim((string) ($GLOBALS['syncpedia_mail_org_id'] ?? ''));
    if ($orgId === '') {
        return ['ok' => false, 'error' => 'Email not configured for your organization'];
    }
    try {
        $db = syncpediaCreatePdo();
        syncpediaEnsureOrgEmailSchema($db);
        $category = trim((string) ($GLOBALS['syncpedia_mail_category'] ?? 'default')) ?: 'default';
        $st = $db->prepare(
            "SELECT a.* FROM org_email_routes r
             INNER JOIN org_smtp_accounts a
                ON a.id = r.smtp_account_id AND a.org_id = r.org_id
             WHERE r.org_id = ? AND r.category IN (?, 'default') AND a.is_active = 1
             ORDER BY CASE WHEN r.category = ? THEN 0 ELSE 1 END
             LIMIT 1",
        );
        $st->execute([$orgId, $category, $category]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            $emailOne = $db->prepare(
                'SELECT * FROM org_smtp_accounts WHERE org_id = ? AND slot = 1 AND is_active = 1 LIMIT 1',
            );
            $emailOne->execute([$orgId]);
            $row = $emailOne->fetch(PDO::FETCH_ASSOC);
        }
        if (is_array($row)) {
            return [
                'ok' => true,
                'tenant' => true,
                'user' => strtolower(trim((string) $row['email'])),
                'pass' => syncpediaDecryptOrgSmtpSecret($row),
                'from_name' => trim((string) ($row['from_name'] ?? '')),
                'profiles' => [['host' => 'smtp.gmail.com', 'port' => 587, 'enc' => 'tls']],
            ];
        }

        if (syncpediaOrganizationSlug($db, $orgId) !== 'syncpedia') {
            return ['ok' => false, 'error' => 'Email not configured for your organization'];
        }
        $creds = syncpediaSmtpCredentialsForAccount($preferredGlobalAccount);
        if ($creds === null) {
            $other = $preferredGlobalAccount === 'hr' ? 'support' : 'hr';
            $creds = syncpediaSmtpCredentialsForAccount($other);
        }
        if ($creds === null || !syncpediaSmtpEnabled()) {
            return ['ok' => false, 'error' => syncpediaSmtpNotReadyReason()];
        }
        return [
            'ok' => true,
            'tenant' => false,
            'user' => $creds['user'],
            'pass' => $creds['pass'],
            'from_name' => '',
            'profiles' => syncpediaSmtpTransportProfiles(),
        ];
    } catch (Throwable $e) {
        error_log('[org-smtp] resolve: ' . $e->getMessage());
        return ['ok' => false, 'error' => 'Email not configured for your organization'];
    }
}
