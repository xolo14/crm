<?php
/**
 * Certificate type codes (always 2 letters) and issued IDs: AA-CS-XXXXXX
 * First two letters = org prefix (globally unique). Middle two = type. Last six = digits.
 */

const CERT_ALLOWED_TYPES = ['CC', 'ID', 'LR', 'IN', 'WS', 'CS', 'AI'];

function certLegacyTypeMap(): array {
    return [
        'ACH' => 'ID',
        'PRO' => 'LR',
        'INT' => 'IN',
    ];
}

function certNormalizeType($raw): string {
    $type = strtoupper(trim((string) $raw));
    $map = certLegacyTypeMap();
    if (isset($map[$type])) {
        $type = $map[$type];
    }
    if (preg_match('/^[A-Z]{2}$/', $type)) {
        return $type;
    }
    return 'CC';
}

function certBuiltinTypeOptions(): array {
    return [
        ['code' => 'CC', 'label' => 'Course Certificate', 'builtin' => true],
        ['code' => 'ID', 'label' => 'Industrial', 'builtin' => true],
        ['code' => 'LR', 'label' => 'Letter of Recommendation', 'builtin' => true],
        ['code' => 'IN', 'label' => 'Internship', 'builtin' => true],
        ['code' => 'WS', 'label' => 'Soft Skills', 'builtin' => true],
        ['code' => 'CS', 'label' => 'Cybersecurity', 'builtin' => true],
        ['code' => 'AI', 'label' => 'AICTE', 'builtin' => true],
    ];
}

function certEnsureTypesTable(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    try {
        $db->exec("
            CREATE TABLE IF NOT EXISTS certificate_types (
              id CHAR(36) NOT NULL,
              org_id CHAR(36) NOT NULL,
              code CHAR(2) NOT NULL,
              label VARCHAR(120) NOT NULL,
              created_by CHAR(36) DEFAULT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              UNIQUE KEY uq_cert_types_org_code (org_id, code)
            )
        ");
    } catch (Throwable $e) {
    }
    $done = true;
}

function certListTypeOptions(PDO $db, string $orgId): array {
    certEnsureTypesTable($db);
    $out = certBuiltinTypeOptions();
    $seen = [];
    foreach ($out as $row) {
        $seen[$row['code']] = true;
    }
    if ($orgId === '') {
        return $out;
    }
    try {
        $st = $db->prepare('SELECT code, label FROM certificate_types WHERE org_id = ? ORDER BY created_at ASC, code ASC');
        $st->execute([$orgId]);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $code = certNormalizeType($row['code'] ?? '');
            $label = trim((string) ($row['label'] ?? ''));
            if ($code === '' || isset($seen[$code])) {
                continue;
            }
            $seen[$code] = true;
            $out[] = [
                'code' => $code,
                'label' => $label !== '' ? $label : $code,
                'builtin' => false,
            ];
        }
    } catch (Throwable $e) {
    }
    return $out;
}

/**
 * @return array{ok:bool,type?:array,error?:string}
 */
function certAddOrgType(PDO $db, string $orgId, string $codeRaw, string $labelRaw, ?string $userId): array {
    if ($orgId === '') {
        return ['ok' => false, 'error' => 'Organization is required to add a certificate type.'];
    }
    $code = strtoupper(preg_replace('/[^A-Za-z]/', '', $codeRaw) ?? '');
    if (strlen($code) !== 2) {
        return ['ok' => false, 'error' => 'Type code must be exactly two letters (A–Z).'];
    }
    $label = trim($labelRaw);
    if ($label === '' || strlen($label) > 120) {
        return ['ok' => false, 'error' => 'Type name is required (max 120 characters).'];
    }
    foreach (certBuiltinTypeOptions() as $row) {
        if ($row['code'] === $code) {
            return ['ok' => false, 'error' => "{$code} is already a built-in certificate type."];
        }
    }
    certEnsureTypesTable($db);
    $id = function_exists('generateUUID') ? generateUUID() : bin2hex(random_bytes(16));
    try {
        $st = $db->prepare('INSERT INTO certificate_types (id, org_id, code, label, created_by) VALUES (?, ?, ?, ?, ?)');
        $st->execute([$id, $orgId, $code, $label, $userId]);
    } catch (Throwable $e) {
        if (function_exists('isMysqlDuplicateKey') && isMysqlDuplicateKey($e)) {
            return ['ok' => false, 'error' => "Type {$code} already exists in this organization."];
        }
        return ['ok' => false, 'error' => 'Could not save certificate type.'];
    }
    return ['ok' => true, 'type' => ['code' => $code, 'label' => $label, 'builtin' => false]];
}

function certNormalizePrefix($raw): ?string {
    $prefix = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $raw) ?? '');
    if (strlen($prefix) !== 2) {
        return null;
    }
    return $prefix;
}

function certEnsureOrgPrefixColumn(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    try {
        if (!syncpediaColumnExists($db, 'organizations', 'cert_prefix')) {
            $db->exec('ALTER TABLE organizations ADD COLUMN cert_prefix CHAR(2) DEFAULT NULL');
        }
        try {
            $db->exec('CREATE UNIQUE INDEX uq_org_cert_prefix ON organizations (cert_prefix)');
        } catch (Throwable $e) {
            // Index already exists, or engine does not support IF NOT EXISTS.
        }
    } catch (Throwable $e) {
    }
    $done = true;
}

function certEnsureTypeColumns(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    foreach (['certificate_templates', 'issued_certificates'] as $table) {
        try {
            $db->exec("ALTER TABLE `{$table}` MODIFY COLUMN `cert_type` VARCHAR(8) NOT NULL DEFAULT 'CC'");
        } catch (Throwable $e) {
        }
        try {
            $db->exec("UPDATE `{$table}` SET cert_type = 'ID' WHERE cert_type = 'ACH'");
            $db->exec("UPDATE `{$table}` SET cert_type = 'LR' WHERE cert_type = 'PRO'");
            $db->exec("UPDATE `{$table}` SET cert_type = 'IN' WHERE cert_type = 'INT'");
        } catch (Throwable $e) {
        }
    }
    try {
        $db->exec('ALTER TABLE issued_certificates MODIFY COLUMN id VARCHAR(80) NOT NULL');
    } catch (Throwable $e) {
    }
    $done = true;
}

function certGetOrgPrefix(PDO $db, string $orgId): ?string {
    certEnsureOrgPrefixColumn($db);
    if ($orgId === '') {
        return null;
    }
    $st = $db->prepare('SELECT cert_prefix FROM organizations WHERE id = ? LIMIT 1');
    $st->execute([$orgId]);
    $raw = $st->fetchColumn();
    return certNormalizePrefix($raw === false ? '' : (string) $raw);
}

function certSuggestPrefix(PDO $db, string $orgId): string {
    $st = $db->prepare('SELECT name, slug FROM organizations WHERE id = ? LIMIT 1');
    $st->execute([$orgId]);
    $row = $st->fetch(PDO::FETCH_ASSOC) ?: [];
    $slug = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($row['slug'] ?? '')) ?? '');
    $name = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($row['name'] ?? '')) ?? '');
    $base = strlen($slug) >= 2 ? substr($slug, 0, 2) : (strlen($name) >= 2 ? substr($name, 0, 2) : 'OR');
    if (certPrefixIsFree($db, $base, $orgId)) {
        return $base;
    }
    $letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for ($i = 0; $i < 26; $i++) {
        for ($j = 0; $j < 26; $j++) {
            $try = $letters[$i] . $letters[$j];
            if (certPrefixIsFree($db, $try, $orgId)) {
                return $try;
            }
        }
    }
    return $base;
}

function certPrefixIsFree(PDO $db, string $prefix, string $exceptOrgId = ''): bool {
    certEnsureOrgPrefixColumn($db);
    $sql = 'SELECT id FROM organizations WHERE UPPER(TRIM(cert_prefix)) = ?';
    $params = [$prefix];
    if ($exceptOrgId !== '') {
        $sql .= ' AND id <> ?';
        $params[] = $exceptOrgId;
    }
    $sql .= ' LIMIT 1';
    $st = $db->prepare($sql);
    $st->execute($params);
    return !$st->fetch();
}

/**
 * Claim or keep a 2-letter prefix for this org. Globally unique across organizations.
 * @return array{ok:bool,prefix?:string,error?:string}
 */
function certClaimOrgPrefix(PDO $db, string $orgId, string $wanted): array {
    $prefix = certNormalizePrefix($wanted);
    if ($prefix === null) {
        return ['ok' => false, 'error' => 'Certificate prefix must be exactly two letters (A–Z).'];
    }
    if ($orgId === '') {
        return ['ok' => false, 'error' => 'Organization is required to set a certificate prefix.'];
    }
    certEnsureOrgPrefixColumn($db);

    $current = certGetOrgPrefix($db, $orgId);
    if ($current === $prefix) {
        return ['ok' => true, 'prefix' => $prefix];
    }
    if (!certPrefixIsFree($db, $prefix, $orgId)) {
        return ['ok' => false, 'error' => "Prefix {$prefix} is already used by another organization."];
    }
    try {
        $upd = $db->prepare('UPDATE organizations SET cert_prefix = ? WHERE id = ?');
        $upd->execute([$prefix, $orgId]);
        return ['ok' => true, 'prefix' => $prefix];
    } catch (Throwable $e) {
        if (function_exists('isMysqlDuplicateKey') && isMysqlDuplicateKey($e)) {
            return ['ok' => false, 'error' => "Prefix {$prefix} is already used by another organization."];
        }
        return ['ok' => false, 'error' => 'Could not save certificate prefix.'];
    }
}

function certIssuedIdPattern(): string {
    return '/^[A-Z]{2}-[A-Z]{2}-\d{6}$/';
}

function certIsValidIssuedId(string $id, ?string $prefix = null, ?string $type = null): bool {
    $id = strtoupper(trim($id));
    if (!preg_match(certIssuedIdPattern(), $id)) {
        return false;
    }
    $parts = explode('-', $id);
    if ($prefix !== null && $parts[0] !== $prefix) {
        return false;
    }
    if ($type !== null && $parts[1] !== $type) {
        return false;
    }
    return true;
}

function certIssuedIdExists(PDO $db, string $id): bool {
    try {
        $st = $db->prepare('SELECT id FROM issued_certificates WHERE id = ? LIMIT 1');
        $st->execute([$id]);
        if ($st->fetch()) {
            return true;
        }
    } catch (Throwable $e) {
    }
    try {
        $st = $db->prepare('SELECT sync_id FROM certificate_issue_artifacts WHERE sync_id = ? LIMIT 1');
        $st->execute([$id]);
        if ($st->fetch()) {
            return true;
        }
    } catch (Throwable $e) {
    }
    return false;
}

function certGenerateIssuedId(PDO $db, string $prefix, string $type): string {
    $prefix = certNormalizePrefix($prefix) ?: 'OR';
    $type = certNormalizeType($type);
    for ($i = 0; $i < 40; $i++) {
        $digits = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $id = $prefix . '-' . $type . '-' . $digits;
        if (!certIssuedIdExists($db, $id)) {
            return $id;
        }
    }
    throw new RuntimeException('Could not allocate a unique certificate number.');
}

/**
 * Accept a client-proposed ID if it matches prefix+type and is free; otherwise allocate one.
 */
function certResolveIssuedId(PDO $db, string $proposed, string $prefix, string $type): string {
    $proposed = strtoupper(trim($proposed));
    if ($proposed !== '' && certIsValidIssuedId($proposed, $prefix, $type) && !certIssuedIdExists($db, $proposed)) {
        return $proposed;
    }
    return certGenerateIssuedId($db, $prefix, $type);
}
