<?php
/**
 * Persist Razorpay payment links in PostgreSQL (payment_links table).
 */
require_once __DIR__ . '/document_storage.php';

function paymentLinksDb(): PDO
{
    return (new Database())->getConnection();
}

function paymentLinkEnsureSchema(PDO $db): void
{
    try {
        if (!syncpediaDbIsMysql($db)) {
            $db->exec(
                'CREATE TABLE IF NOT EXISTS payment_links (
                  id BIGSERIAL PRIMARY KEY,
                  org_id CHAR(36) DEFAULT NULL,
                  razorpay_payment_link_id VARCHAR(64) NOT NULL,
                  salesperson_id CHAR(36) NOT NULL,
                  salesperson_referral_code VARCHAR(50) NOT NULL DEFAULT \'\',
                  customer_name VARCHAR(200) NOT NULL,
                  customer_email VARCHAR(255) DEFAULT NULL,
                  customer_phone VARCHAR(30) DEFAULT NULL,
                  amount BIGINT NOT NULL,
                  currency VARCHAR(3) NOT NULL DEFAULT \'INR\',
                  description VARCHAR(500) DEFAULT NULL,
                  reference_id VARCHAR(100) DEFAULT NULL,
                  payment_type VARCHAR(20) NOT NULL DEFAULT \'full\',
                  accept_partial BOOLEAN NOT NULL DEFAULT FALSE,
                  first_min_partial_amount BIGINT DEFAULT NULL,
                  status VARCHAR(30) NOT NULL DEFAULT \'created\',
                  amount_paid BIGINT NOT NULL DEFAULT 0,
                  razorpay_short_url VARCHAR(500) NOT NULL DEFAULT \'\',
                  notify_email BOOLEAN NOT NULL DEFAULT FALSE,
                  notify_sms BOOLEAN NOT NULL DEFAULT FALSE,
                  expire_by TIMESTAMP DEFAULT NULL,
                  reminder_enable BOOLEAN NOT NULL DEFAULT FALSE,
                  notes JSON DEFAULT NULL,
                  invoice_number VARCHAR(64) DEFAULT NULL,
                  invoice_sent_at TIMESTAMP DEFAULT NULL,
                  invoice_sent_for_amount_paid BIGINT DEFAULT NULL,
                  invoice_pdf_path TEXT DEFAULT NULL,
                  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE (razorpay_payment_link_id)
                )',
            );
        }
    } catch (Throwable $e) {
        error_log('[payment_links] ensure table: ' . $e->getMessage());
    }

    try {
        if (!syncpediaColumnExists($db, 'payment_links', 'enrollment_applied_at')) {
            if (syncpediaDbIsMysql($db)) {
                $db->exec(
                    'ALTER TABLE payment_links ADD COLUMN enrollment_applied_at DATETIME DEFAULT NULL',
                );
            } else {
                $db->exec(
                    'ALTER TABLE payment_links ADD COLUMN enrollment_applied_at TIMESTAMP DEFAULT NULL',
                );
            }
        }
    } catch (Throwable $e) {
        // Column already exists.
    }

    try {
        if (!syncpediaColumnExists($db, 'payment_links', 'processed_payment_ids')) {
            if (syncpediaDbIsMysql($db)) {
                $db->exec("ALTER TABLE payment_links ADD COLUMN processed_payment_ids JSON DEFAULT NULL");
            } else {
                $db->exec('ALTER TABLE payment_links ADD COLUMN processed_payment_ids JSONB DEFAULT NULL');
            }
        }
    } catch (Throwable $e) {
        // Column already exists.
    }
}

/** Resolve tenant org for payment link storage (JWT + users table fallback). */
function paymentLinksResolveOrgId(array $tokenData): ?string
{
    if (function_exists('getOrgId')) {
        $orgId = getOrgId($tokenData);
        if (is_string($orgId) && trim($orgId) !== '') {
            return trim($orgId);
        }
    }
    $fromToken = trim((string) ($tokenData['org_id'] ?? ''));
    if ($fromToken !== '') {
        return $fromToken;
    }
    if (syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'super_admin') {
        try {
            $db = paymentLinksDb();
            $st = $db->query("SELECT id FROM organizations WHERE LOWER(TRIM(slug)) = 'syncpedia' LIMIT 1");
            $syncpediaOrgId = trim((string) ($st ? ($st->fetchColumn() ?: '') : ''));
            return $syncpediaOrgId !== '' ? $syncpediaOrgId : null;
        } catch (Throwable $e) {
            return null;
        }
    }
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    if ($userId === '') {
        return null;
    }
    try {
        $db = paymentLinksDb();
        $st = $db->prepare('SELECT org_id FROM users WHERE id = ? LIMIT 1');
        $st->execute([$userId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        $oid = trim((string) (is_array($row) ? ($row['org_id'] ?? '') : ''));
        return $oid !== '' ? $oid : null;
    } catch (Throwable $e) {
        error_log('[payment_links] resolve org_id: ' . $e->getMessage());
        return null;
    }
}

/** @return list<string> */
function paymentLinksOrgMemberIds(PDO $db, string $orgId): array
{
    if ($orgId === '') {
        return [];
    }
    try {
        $st = $db->prepare('SELECT id FROM users WHERE org_id = ?');
        $st->execute([$orgId]);
        $ids = [];
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (!is_array($row)) {
                continue;
            }
            $id = trim((string) ($row['id'] ?? ''));
            if ($id !== '') {
                $ids[] = $id;
            }
        }
        return $ids;
    } catch (Throwable $e) {
        error_log('[payment_links] org member ids: ' . $e->getMessage());
        return [];
    }
}

function paymentLinkMapRazorpayStatus(string $status, int $amountPaid, int $amount): string
{
    if ($amount > 0 && $amountPaid >= $amount) {
        return 'paid';
    }
    $s = strtolower(trim($status));
    if ($s === 'paid') {
        return 'paid';
    }
    if ($s === 'cancelled') {
        return 'cancelled';
    }
    if ($s === 'expired') {
        return 'expired';
    }
    if ($s === 'partially_paid' || ($amountPaid > 0 && $amountPaid < $amount)) {
        return 'partially_paid';
    }
    return 'created';
}

/** Rank used to prevent status downgrades on concurrent writes (paid always wins, terminal beats pending). */
function paymentLinkStatusRankSql(string $expr): string
{
    return "CASE {$expr}
        WHEN 'paid' THEN 5
        WHEN 'cancelled' THEN 4
        WHEN 'expired' THEN 4
        WHEN 'partially_paid' THEN 2
        WHEN 'created' THEN 1
        ELSE 0 END";
}

/**
 * @param array<string, mixed> $rzpLink
 * @param array<string, mixed> $reqBody
 * @param array<string, mixed> $tokenData
 */
function paymentLinkPersistOnCreate(
    array $rzpLink,
    array $reqBody,
    array $tokenData,
): ?array {
    $plinkId = trim((string) ($rzpLink['id'] ?? ''));
    if ($plinkId === '') {
        return null;
    }

    $db = paymentLinksDb();
    paymentLinkEnsureSchema($db);

    $notes = is_array($reqBody['notes'] ?? null) ? $reqBody['notes'] : [];
    $customer = is_array($reqBody['customer'] ?? null) ? $reqBody['customer'] : [];
    $custRzp = is_array($rzpLink['customer'] ?? null) ? $rzpLink['customer'] : [];

    $salespersonId = trim((string) ($notes['salesperson_id'] ?? $tokenData['user_id'] ?? ''));
    if ($salespersonId === '') {
        $salespersonId = 'unknown';
    }

    $amount = (int) ($rzpLink['amount'] ?? 0);
    $amountPaid = (int) ($rzpLink['amount_paid'] ?? 0);
    $status = paymentLinkMapRazorpayStatus(
        (string) ($rzpLink['status'] ?? 'created'),
        $amountPaid,
        $amount,
    );
    $acceptPartial = ($reqBody['accept_partial'] ?? false) === true;

    $expireBy = null;
    if (!empty($rzpLink['expire_by'])) {
        $expireBy = date('Y-m-d H:i:s', (int) $rzpLink['expire_by']);
    }

    $notesJson = json_encode($notes, JSON_UNESCAPED_UNICODE);
    if ($notesJson === false) {
        $notesJson = '{}';
    }

    $orgId = paymentLinksResolveOrgId($tokenData);

    $insertSql = 'INSERT INTO payment_links (
        org_id, razorpay_payment_link_id, salesperson_id, salesperson_referral_code,
        customer_name, customer_email, customer_phone, amount, currency, description,
        reference_id, payment_type, accept_partial, first_min_partial_amount, status,
        amount_paid, razorpay_short_url, notify_email, notify_sms, expire_by,
        reminder_enable, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';

    if (syncpediaDbIsMysql($db)) {
        $sql = $insertSql . '
        ON DUPLICATE KEY UPDATE
            org_id = COALESCE(VALUES(org_id), org_id),
            customer_name = VALUES(customer_name),
            customer_email = VALUES(customer_email),
            customer_phone = VALUES(customer_phone),
            amount = VALUES(amount),
            description = VALUES(description),
            reference_id = VALUES(reference_id),
            status = CASE WHEN ' . paymentLinkStatusRankSql('VALUES(status)')
                . ' >= ' . paymentLinkStatusRankSql('status') . '
                THEN VALUES(status) ELSE status END,
            amount_paid = GREATEST(COALESCE(amount_paid, 0), VALUES(amount_paid)),
            razorpay_short_url = VALUES(razorpay_short_url),
            notes = VALUES(notes),
            updated_at = CURRENT_TIMESTAMP';
    } else {
        $sql = $insertSql . '
        ON CONFLICT (razorpay_payment_link_id) DO UPDATE SET
            org_id = COALESCE(EXCLUDED.org_id, payment_links.org_id),
            customer_name = EXCLUDED.customer_name,
            customer_email = EXCLUDED.customer_email,
            customer_phone = EXCLUDED.customer_phone,
            amount = EXCLUDED.amount,
            description = EXCLUDED.description,
            reference_id = EXCLUDED.reference_id,
            status = CASE WHEN ' . paymentLinkStatusRankSql('EXCLUDED.status')
                . ' >= ' . paymentLinkStatusRankSql('payment_links.status') . '
                THEN EXCLUDED.status ELSE payment_links.status END,
            amount_paid = GREATEST(COALESCE(payment_links.amount_paid, 0), EXCLUDED.amount_paid),
            razorpay_short_url = EXCLUDED.razorpay_short_url,
            notes = EXCLUDED.notes,
            updated_at = CURRENT_TIMESTAMP';
    }

    $stmt = $db->prepare($sql);
    $stmt->execute([
        $orgId,
        $plinkId,
        $salespersonId,
        trim((string) ($notes['referral_code'] ?? $notes['crm_referral'] ?? '')),
        trim((string) ($custRzp['name'] ?? $customer['name'] ?? '')),
        trim((string) ($custRzp['email'] ?? $customer['email'] ?? '')) ?: null,
        trim((string) ($custRzp['contact'] ?? $customer['contact'] ?? '')) ?: null,
        $amount,
        (string) ($rzpLink['currency'] ?? 'INR'),
        trim((string) ($rzpLink['description'] ?? $reqBody['description'] ?? '')) ?: null,
        trim((string) ($rzpLink['reference_id'] ?? $reqBody['reference_id'] ?? '')) ?: null,
        $acceptPartial ? 'partial' : 'full',
        $acceptPartial ? 1 : 0,
        $acceptPartial && isset($reqBody['first_min_partial_amount'])
            ? (int) round((float) $reqBody['first_min_partial_amount'])
            : null,
        $status,
        $amountPaid,
        trim((string) ($rzpLink['short_url'] ?? '')),
        ($reqBody['notify']['email'] ?? false) === true ? 1 : 0,
        ($reqBody['notify']['sms'] ?? false) === true ? 1 : 0,
        $expireBy,
        ($reqBody['reminder_enable'] ?? false) === true ? 1 : 0,
        $notesJson,
    ]);

    return paymentLinkFindByRazorpayId($plinkId);
}

/**
 * @param array<string, mixed> $rzpLink
 * @param array<string, mixed>|null $paymentEntity
 */
function paymentLinkUpsertFromRazorpay(
    array $rzpLink,
    ?array $paymentEntity = null,
): ?array {
    $plinkId = trim((string) ($rzpLink['id'] ?? ''));
    if ($plinkId === '') {
        return null;
    }

    $db = paymentLinksDb();
    paymentLinkEnsureSchema($db);

    $existing = paymentLinkFindByRazorpayId($plinkId);
    $notes = is_array($rzpLink['notes'] ?? null) ? $rzpLink['notes'] : [];
    if ($existing && !empty($existing['notes'])) {
        $decoded = json_decode((string) $existing['notes'], true);
        if (is_array($decoded)) {
            $notes = array_merge($decoded, $notes);
        }
    }

    $salespersonId = trim((string) ($notes['salesperson_id'] ?? $existing['salesperson_id'] ?? 'unknown'));
    $cust = is_array($rzpLink['customer'] ?? null) ? $rzpLink['customer'] : [];

    $amount = (int) ($rzpLink['amount'] ?? 0);
    $incomingPaid = (int) ($rzpLink['amount_paid'] ?? 0);
    $existingPaid = $existing ? (int) ($existing['amount_paid'] ?? 0) : 0;
    // Never regress amount_paid from stale/out-of-order webhooks.
    $amountPaid = max($incomingPaid, $existingPaid);
    $status = paymentLinkMapRazorpayStatus(
        (string) ($rzpLink['status'] ?? 'created'),
        $amountPaid,
        $amount,
    );
    $rzpStatus = strtolower(trim((string) ($rzpLink['status'] ?? '')));
    if ($rzpStatus === 'paid' && $amount > 0 && $amountPaid < $amount) {
        $status = $amountPaid > 0 ? 'partially_paid' : 'created';
    }

    $expireBy = null;
    if (!empty($rzpLink['expire_by'])) {
        $expireBy = date('Y-m-d H:i:s', (int) $rzpLink['expire_by']);
    }

    $notesJson = json_encode($notes, JSON_UNESCAPED_UNICODE) ?: '{}';

    if ($existing) {
        $upd = $db->prepare(
            'UPDATE payment_links SET
                customer_name = ?, customer_email = ?, customer_phone = ?,
                amount = ?, description = ?, reference_id = ?,
                status = CASE WHEN ' . paymentLinkStatusRankSql('?')
                    . ' >= ' . paymentLinkStatusRankSql('status') . ' THEN ? ELSE status END,
                amount_paid = GREATEST(COALESCE(amount_paid, 0), ?), razorpay_short_url = ?, expire_by = ?, notes = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE razorpay_payment_link_id = ?',
        );
        $upd->execute([
            trim((string) ($cust['name'] ?? $existing['customer_name'] ?? '')),
            trim((string) ($cust['email'] ?? $existing['customer_email'] ?? '')) ?: null,
            trim((string) ($cust['contact'] ?? $existing['customer_phone'] ?? '')) ?: null,
            $amount,
            trim((string) ($rzpLink['description'] ?? $existing['description'] ?? '')) ?: null,
            trim((string) ($rzpLink['reference_id'] ?? $existing['reference_id'] ?? '')) ?: null,
            $status,
            $status,
            $amountPaid,
            trim((string) ($rzpLink['short_url'] ?? $existing['razorpay_short_url'] ?? '')),
            $expireBy,
            $notesJson,
            $plinkId,
        ]);
    } else {
        $ins = $db->prepare(
            'INSERT INTO payment_links (
                razorpay_payment_link_id, salesperson_id, salesperson_referral_code,
                customer_name, customer_email, customer_phone, amount, currency, description,
                reference_id, status, amount_paid, razorpay_short_url, expire_by, notes,
                accept_partial, payment_type
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        );
        $ins->execute([
            $plinkId,
            $salespersonId,
            trim((string) ($notes['referral_code'] ?? $notes['crm_referral'] ?? '')),
            trim((string) ($cust['name'] ?? '')),
            trim((string) ($cust['email'] ?? '')) ?: null,
            trim((string) ($cust['contact'] ?? '')) ?: null,
            $amount,
            (string) ($rzpLink['currency'] ?? 'INR'),
            trim((string) ($rzpLink['description'] ?? '')) ?: null,
            trim((string) ($rzpLink['reference_id'] ?? '')) ?: null,
            $status,
            $amountPaid,
            trim((string) ($rzpLink['short_url'] ?? '')),
            $expireBy,
            $notesJson,
            (($rzpLink['accept_partial'] ?? false) === true) ? 1 : 0,
            (($rzpLink['accept_partial'] ?? false) === true) ? 'partial' : 'full',
        ]);
    }

    return paymentLinkFindByRazorpayId($plinkId);
}

/**
 * List access scope for payment links (mirrors leads.php: manager = downline, admin/org = tenant, rep = self).
 *
 * @return array{mode: string, org_id: ?string, salesperson_ids: string[], org_member_ids: string[]}
 */
function paymentLinksBuildAccessScope(PDO $db, array $tokenData): array
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    $orgId = getOrgId($tokenData);
    $resolvedOrgId = is_string($orgId) && trim($orgId) !== '' ? trim($orgId) : null;

    if ($role === 'super_admin' && !$resolvedOrgId) {
        return ['mode' => 'all', 'org_id' => null, 'salesperson_ids' => [], 'org_member_ids' => []];
    }
    if (in_array($role, ['admin', 'org', 'finance'], true) || ($role === 'super_admin' && $resolvedOrgId)) {
        if ($resolvedOrgId === null) {
            return [
                'mode' => 'self',
                'org_id' => null,
                'salesperson_ids' => $userId !== '' ? [$userId] : [],
                'org_member_ids' => [],
            ];
        }
        return [
            'mode' => 'org',
            'org_id' => $resolvedOrgId,
            'salesperson_ids' => [],
            'org_member_ids' => paymentLinksOrgMemberIds($db, $resolvedOrgId),
        ];
    }
    if ($role === 'manager') {
        // Align with org-wide leads visibility for managers.
        if ($resolvedOrgId === null) {
            return [
                'mode' => 'self',
                'org_id' => null,
                'salesperson_ids' => $userId !== '' ? [$userId] : [],
                'org_member_ids' => [],
            ];
        }
        return [
            'mode' => 'org',
            'org_id' => $resolvedOrgId,
            'salesperson_ids' => [],
            'org_member_ids' => paymentLinksOrgMemberIds($db, $resolvedOrgId),
        ];
    }
    if ($role === 'sales_representative') {
        return [
            'mode' => 'self',
            'org_id' => $resolvedOrgId,
            'salesperson_ids' => $userId !== '' ? [$userId] : [],
            'org_member_ids' => [],
        ];
    }
    return [
        'mode' => 'self',
        'org_id' => $resolvedOrgId,
        'salesperson_ids' => $userId !== '' ? [$userId] : [],
        'org_member_ids' => [],
    ];
}

/**
 * @param array{mode: string, org_id: ?string, salesperson_ids: string[], org_member_ids?: string[]} $scope
 * @return array{sql: string, params: array}
 */
function paymentLinksCrmListScopeSql(array $scope): array
{
    $mode = (string) ($scope['mode'] ?? 'all');
    if ($mode === 'all') {
        return ['sql' => '', 'params' => []];
    }
    if ($mode === 'org' && !empty($scope['org_id'])) {
        $orgId = (string) $scope['org_id'];
        $memberIds = is_array($scope['org_member_ids'] ?? null) ? $scope['org_member_ids'] : [];
        if (empty($memberIds)) {
            return ['sql' => ' AND org_id = ?', 'params' => [$orgId]];
        }
        $in = implode(',', array_fill(0, count($memberIds), '?'));
        return [
            'sql' => " AND (org_id = ? OR ((org_id IS NULL OR org_id = '') AND salesperson_id IN ({$in})))",
            'params' => array_merge([$orgId], array_values($memberIds)),
        ];
    }
    if (in_array($mode, ['downline', 'self'], true) && !empty($scope['salesperson_ids'])) {
        $in = implode(',', array_fill(0, count($scope['salesperson_ids']), '?'));
        return ['sql' => " AND salesperson_id IN ({$in})", 'params' => array_values($scope['salesperson_ids'])];
    }
    return ['sql' => ' AND 1=0', 'params' => []];
}

/** @param list<string> $plinkIds @return array<string, array<string, mixed>> */
function paymentLinksCrmSalespersonMap(array $plinkIds): array
{
    if (empty($plinkIds)) {
        return [];
    }
    $db = paymentLinksDb();
    paymentLinkEnsureSchema($db);
    $placeholders = implode(',', array_fill(0, count($plinkIds), '?'));
    $st = $db->prepare(
        "SELECT razorpay_payment_link_id, salesperson_id, org_id FROM payment_links WHERE razorpay_payment_link_id IN ({$placeholders})",
    );
    $st->execute(array_values($plinkIds));
    $map = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
        if (!is_array($row)) {
            continue;
        }
        $id = trim((string) ($row['razorpay_payment_link_id'] ?? ''));
        if ($id !== '') {
            $map[$id] = $row;
        }
    }
    return $map;
}

/** @param array<string, mixed> $item @param array<string, array<string, mixed>> $crmMap */
function paymentLinksItemSalespersonId(array $item, array $crmMap): string
{
    $id = trim((string) ($item['id'] ?? ''));
    if ($id !== '' && isset($crmMap[$id])) {
        return trim((string) ($crmMap[$id]['salesperson_id'] ?? ''));
    }
    $notes = is_array($item['notes'] ?? null) ? $item['notes'] : [];
    return trim((string) ($notes['salesperson_id'] ?? ''));
}

/** @param array{mode: string, org_id: ?string, salesperson_ids: string[], org_member_ids?: string[]} $scope */
function paymentLinksItemBelongsToOrg(array $item, array $scope, array $crmMap): bool
{
    $memberIds = is_array($scope['org_member_ids'] ?? null) ? $scope['org_member_ids'] : [];
    if (empty($memberIds)) {
        return false;
    }
    $spId = paymentLinksItemSalespersonId($item, $crmMap);
    return $spId !== '' && in_array($spId, $memberIds, true);
}

/** @param array<string, mixed> $item @param array{mode: string, org_id: ?string, salesperson_ids: string[], org_member_ids?: string[]} $scope @param array<string, array<string, mixed>> $crmMap */
function paymentLinksItemAllowed(array $item, array $scope, array $crmMap): bool
{
    $mode = (string) ($scope['mode'] ?? 'all');
    if ($mode === 'all') {
        return true;
    }
    if (in_array($mode, ['downline', 'self'], true)) {
        $spId = paymentLinksItemSalespersonId($item, $crmMap);
        if ($spId === '') {
            return false;
        }
        return in_array($spId, $scope['salesperson_ids'] ?? [], true);
    }
    if ($mode === 'org' && !empty($scope['org_id'])) {
        $id = trim((string) ($item['id'] ?? ''));
        if ($id !== '' && isset($crmMap[$id])) {
            $rowOrg = trim((string) ($crmMap[$id]['org_id'] ?? ''));
            if ($rowOrg !== '' && $rowOrg !== (string) $scope['org_id']) {
                return false;
            }
            if ($rowOrg !== '') {
                return true;
            }
            return paymentLinksItemBelongsToOrg($item, $scope, $crmMap);
        }
        return paymentLinksItemBelongsToOrg($item, $scope, $crmMap);
    }
    return false;
}

/** Enforce payment-link access for cancel / remind / invoice when scope is restricted. */
function paymentLinksAssertItemAllowed(PDO $db, array $tokenData, string $plinkId): void
{
    $scope = paymentLinksBuildAccessScope($db, $tokenData);
    if (($scope['mode'] ?? 'all') === 'all') {
        return;
    }
    try {
        $item = razorpayFetchPaymentLink($plinkId);
    } catch (Throwable $e) {
        paymentLinksError($e->getMessage(), 500);
    }
    if (!is_array($item)) {
        paymentLinksError('Payment link not found', 404);
    }
    $crmMap = paymentLinksCrmSalespersonMap([$plinkId]);
    if (!paymentLinksItemAllowed($item, $scope, $crmMap)) {
        paymentLinksError('Forbidden', 403);
    }
}

/** @param list<mixed> $items @param array{mode: string, org_id: ?string, salesperson_ids: string[], org_member_ids?: string[]} $scope @return list<mixed> */
function paymentLinksApplyListScope(array $items, array $scope): array
{
    if (($scope['mode'] ?? 'all') === 'all') {
        return $items;
    }
    $ids = [];
    foreach ($items as $item) {
        if (is_array($item) && !empty($item['id'])) {
            $ids[] = (string) $item['id'];
        }
    }
    $crmMap = paymentLinksCrmSalespersonMap($ids);
    return array_values(array_filter($items, static function ($item) use ($scope, $crmMap) {
        return is_array($item) && paymentLinksItemAllowed($item, $scope, $crmMap);
    }));
}

/**
 * CRM rows for list merge (links stored locally that may be outside Razorpay page window).
 *
 * @param array{mode: string, org_id: ?string, salesperson_ids: string[]}|null $accessScope
 * @return list<array<string, mixed>>
 */
function paymentLinkListCrmRows(?int $fromUnix = null, ?int $toUnix = null, int $limit = 500, ?array $accessScope = null): array
{
    $db = paymentLinksDb();
    paymentLinkEnsureSchema($db);

    $sql = 'SELECT razorpay_payment_link_id, customer_name, customer_email, customer_phone,
                   amount, currency, amount_paid, status, description, reference_id,
                   razorpay_short_url, expire_by, notes, salesperson_id, created_at, updated_at
            FROM payment_links WHERE 1=1';
    $params = [];
    if ($accessScope !== null) {
        $scopeSql = paymentLinksCrmListScopeSql($accessScope);
        $sql .= $scopeSql['sql'];
        $params = array_merge($params, $scopeSql['params']);
    }
    if ($fromUnix !== null && $fromUnix > 0) {
        $sql .= ' AND created_at >= FROM_UNIXTIME(?)';
        $params[] = $fromUnix;
    }
    if ($toUnix !== null && $toUnix > 0) {
        $sql .= ' AND created_at <= FROM_UNIXTIME(?)';
        $params[] = $toUnix;
    }
    $sql .= ' ORDER BY created_at DESC LIMIT ' . max(1, min(1000, $limit));

    $st = $db->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    return is_array($rows) ? $rows : [];
}

/** @param array<string, mixed> $row */
function paymentLinkCrmRowToRazorpayShape(array $row): array
{
    $notes = [];
    if (!empty($row['notes'])) {
        $decoded = json_decode((string) $row['notes'], true);
        if (is_array($decoded)) {
            $notes = $decoded;
        }
    }
    $spId = trim((string) ($row['salesperson_id'] ?? ''));
    if ($spId !== '') {
        $notes['salesperson_id'] = $spId;
    }

    $createdAt = 0;
    if (!empty($row['created_at'])) {
        $ts = strtotime((string) $row['created_at']);
        if ($ts !== false) {
            $createdAt = $ts;
        }
    }

    $expireBy = null;
    if (!empty($row['expire_by'])) {
        $ts = strtotime((string) $row['expire_by']);
        if ($ts !== false) {
            $expireBy = $ts;
        }
    }

    $amount = (int) ($row['amount'] ?? 0);
    $amountPaid = (int) ($row['amount_paid'] ?? 0);
    $status = paymentLinkMapRazorpayStatus(
        (string) ($row['status'] ?? 'created'),
        $amountPaid,
        $amount,
    );

    return [
        'id' => (string) ($row['razorpay_payment_link_id'] ?? ''),
        'amount' => $amount,
        'amount_paid' => $amountPaid,
        'currency' => (string) ($row['currency'] ?? 'INR'),
        'description' => (string) ($row['description'] ?? ''),
        'status' => $status,
        'short_url' => (string) ($row['razorpay_short_url'] ?? ''),
        'created_at' => $createdAt,
        'expire_by' => $expireBy,
        'reference_id' => (string) ($row['reference_id'] ?? ''),
        'customer' => [
            'name' => (string) ($row['customer_name'] ?? ''),
            'email' => (string) ($row['customer_email'] ?? ''),
            'contact' => (string) ($row['customer_phone'] ?? ''),
        ],
        'notes' => $notes,
        'reminder_enable' => false,
    ];
}

function paymentLinkStatusRank(string $status): int
{
    static $ranks = [
        'paid' => 5,
        'partially_paid' => 4,
        'created' => 3,
        'expired' => 2,
        'cancelled' => 1,
    ];

    return $ranks[strtolower(trim($status))] ?? 0;
}

/**
 * Prefer the most advanced status and highest amount_paid between Razorpay and CRM.
 *
 * @param array<string, mixed> $item
 * @param array<string, mixed> $crmRow
 * @return array<string, mixed>
 */
function paymentLinkMergeRazorpayWithCrm(array $item, array $crmRow): array
{
    $crm = paymentLinkCrmRowToRazorpayShape($crmRow);
    $amount = (int) ($item['amount'] ?? $crm['amount'] ?? 0);
    $paid = max((int) ($item['amount_paid'] ?? 0), (int) ($crm['amount_paid'] ?? 0));
    $item['amount_paid'] = $paid;

    $rzpStatus = paymentLinkMapRazorpayStatus(
        (string) ($item['status'] ?? 'created'),
        $paid,
        $amount,
    );
    $crmStatus = (string) ($crm['status'] ?? 'created');
    $terminal = ['cancelled', 'expired'];
    if ($rzpStatus === 'paid' || $crmStatus === 'paid') {
        $picked = 'paid';
    } elseif (in_array($rzpStatus, $terminal, true) || in_array($crmStatus, $terminal, true)) {
        if (in_array($rzpStatus, $terminal, true) && in_array($crmStatus, $terminal, true)) {
            $picked = paymentLinkStatusRank($crmStatus) >= paymentLinkStatusRank($rzpStatus) ? $crmStatus : $rzpStatus;
        } elseif (in_array($rzpStatus, $terminal, true)) {
            $picked = $rzpStatus;
        } else {
            $picked = $crmStatus;
        }
    } elseif (in_array($rzpStatus, $terminal, true) && $crmStatus === 'created') {
        $picked = $rzpStatus;
    } elseif (in_array($crmStatus, $terminal, true) && $rzpStatus === 'created') {
        $picked = $crmStatus;
    } else {
        $picked = paymentLinkStatusRank($crmStatus) > paymentLinkStatusRank($rzpStatus)
            ? $crmStatus
            : $rzpStatus;
    }
    $item['status'] = paymentLinkMapRazorpayStatus($picked, $paid, $amount);

    $itemNotes = is_array($item['notes'] ?? null) ? $item['notes'] : [];
    $crmNotes = is_array($crm['notes'] ?? null) ? $crm['notes'] : [];
    $item['notes'] = array_merge($itemNotes, $crmNotes);

    if (trim((string) ($item['short_url'] ?? '')) === '' && !empty($crm['short_url'])) {
        $item['short_url'] = $crm['short_url'];
    }

    return $item;
}

/**
 * Re-fetch recent pending links from Razorpay so paid status appears without waiting on webhooks.
 *
 * @param array<int, mixed> $items
 */
function paymentLinksRefreshStalePending(array &$items, int $maxRefresh = 80): void
{
    $now = time();
    $refreshed = 0;

    foreach ($items as $idx => $item) {
        if ($refreshed >= $maxRefresh) {
            break;
        }
        if (!is_array($item)) {
            continue;
        }

        $status = strtolower(trim((string) ($item['status'] ?? '')));
        if (!in_array($status, ['created', 'partially_paid'], true)) {
            continue;
        }

        $createdAt = (int) ($item['created_at'] ?? 0);
        if ($createdAt > 0 && ($now - $createdAt) > 30 * 86400) {
            continue;
        }

        $id = trim((string) ($item['id'] ?? ''));
        if ($id === '') {
            continue;
        }

        try {
            $fresh = razorpayFetchPaymentLink($id);
            if (!is_array($fresh)) {
                continue;
            }
            $paid = (int) ($fresh['amount_paid'] ?? 0);
            $total = (int) ($fresh['amount'] ?? 0);
            $fresh['status'] = paymentLinkMapRazorpayStatus(
                (string) ($fresh['status'] ?? 'created'),
                $paid,
                $total,
            );
            $items[$idx] = $fresh;
            try {
                $row = paymentLinkUpsertFromRazorpay($fresh, null);
                if (is_array($row)) {
                    $paid = (int) ($fresh['amount_paid'] ?? 0);
                    $total = (int) ($fresh['amount'] ?? 0);
                    $newStatus = paymentLinkMapRazorpayStatus(
                        (string) ($fresh['status'] ?? 'created'),
                        $paid,
                        $total,
                    );
                    if ($paid > 0 && in_array($newStatus, ['paid', 'partially_paid'], true)) {
                        if (!function_exists('paymentLinkProcessPaymentSideEffects')) {
                            require_once __DIR__ . '/payment_link_fulfillment.php';
                        }
                        $eventType = $newStatus === 'paid'
                            ? 'payment_link.paid'
                            : 'payment_link.partially_paid';
                        paymentLinkProcessPaymentSideEffects($row, $fresh, null, $eventType);
                    }
                }
            } catch (Throwable $e) {
                error_log('[payment_links] refresh upsert: ' . $e->getMessage());
            }
            $refreshed++;
        } catch (Throwable $e) {
            error_log('[payment_links] refresh fetch ' . $id . ': ' . $e->getMessage());
        }
    }
}

/** Seconds a full Razorpay sync stays fresh; polls within this window are served from cache + DB. */
const PAYMENT_LINKS_SYNC_TTL = 180;

function paymentLinksSyncCachePath(array $filters): string
{
    $dir = dirname(__DIR__) . '/storage/payment_links_cache';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $key = md5(implode('|', [
        (string) ($filters['from'] ?? ''),
        (string) ($filters['to'] ?? ''),
        (string) ($filters['status'] ?? ''),
        (string) ($filters['skip'] ?? '0'),
    ]));
    return $dir . '/' . $key . '.json';
}

/** @return list<array<string, mixed>>|null Cached unscoped items, or null when absent/expired. */
function paymentLinksSyncCacheRead(string $file, int $ttl): ?array
{
    $raw = @file_get_contents($file);
    if (!is_string($raw) || $raw === '') {
        return null;
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded) || !isset($decoded['synced_at']) || !is_array($decoded['items'] ?? null)) {
        return null;
    }
    if ((time() - (int) $decoded['synced_at']) > $ttl) {
        return null;
    }
    return array_values($decoded['items']);
}

/**
 * Overlay current DB state (webhook/CRM updates) onto cached items, and append
 * CRM rows created after the cache was written. Rank-guarded merge means a
 * stale cached "created" never overrides a webhook-persisted "paid".
 *
 * @param list<mixed> $items
 * @return list<mixed>
 */
function paymentLinksOverlayCrmRows(array $items, ?int $from, ?int $to): array
{
    $crmById = [];
    try {
        foreach (paymentLinkListCrmRows($from, $to, 500, null) as $row) {
            $id = trim((string) ($row['razorpay_payment_link_id'] ?? ''));
            if ($id !== '') {
                $crmById[$id] = $row;
            }
        }
    } catch (Throwable $e) {
        error_log('[payment_links] CRM overlay: ' . $e->getMessage());
        return $items;
    }

    foreach ($items as $i => $item) {
        if (!is_array($item)) {
            continue;
        }
        $id = trim((string) ($item['id'] ?? ''));
        if ($id !== '' && isset($crmById[$id])) {
            $items[$i] = paymentLinkMergeRazorpayWithCrm($item, $crmById[$id]);
            unset($crmById[$id]);
        }
    }
    foreach ($crmById as $row) {
        $items[] = paymentLinkCrmRowToRazorpayShape($row);
    }
    return $items;
}

/**
 * Razorpay list + CRM rows (merged status) + live refresh for recent pending links.
 *
 * The full Razorpay sync (paginated list + per-pending refresh + fulfillment) runs
 * at most once per PAYMENT_LINKS_SYNC_TTL per filter window; requests inside the
 * window are served from the cached sync overlaid with fresh DB rows, so webhook
 * status changes still appear on the next poll without any outbound HTTP.
 * Pass filters['force'] to bypass the cache (manual refresh button).
 *
 * @param array<string, mixed> $filters
 * @return array<string, mixed>
 */
function paymentLinksListMerged(array $filters = [], ?array $tokenData = null): array
{
    $from = !empty($filters['from']) ? (int) $filters['from'] : null;
    $to = !empty($filters['to']) ? (int) $filters['to'] : null;
    $accessScope = null;
    if ($tokenData !== null) {
        $accessScope = paymentLinksBuildAccessScope(paymentLinksDb(), $tokenData);
    }

    $cacheFile = paymentLinksSyncCachePath($filters);
    $items = null;
    if (empty($filters['force'])) {
        $items = paymentLinksSyncCacheRead($cacheFile, PAYMENT_LINKS_SYNC_TTL);
        if ($items !== null) {
            $items = paymentLinksOverlayCrmRows($items, $from, $to);
        }
    }

    if ($items === null) {
        // Full sync. Built unscoped so the cache can be shared across users;
        // per-requester visibility is applied below via paymentLinksApplyListScope.
        $crmById = [];
        try {
            foreach (paymentLinkListCrmRows($from, $to, 500, null) as $row) {
                $id = trim((string) ($row['razorpay_payment_link_id'] ?? ''));
                if ($id !== '') {
                    $crmById[$id] = $row;
                }
            }
        } catch (Throwable $e) {
            error_log('[payment_links] CRM list preload: ' . $e->getMessage());
        }

        $result = razorpayFetchAllPaymentLinks($filters);
        $items = is_array($result['items'] ?? null) ? $result['items'] : [];

        foreach ($items as $i => $item) {
            if (!is_array($item)) {
                continue;
            }
            $id = trim((string) ($item['id'] ?? ''));
            if ($id !== '' && isset($crmById[$id])) {
                $items[$i] = paymentLinkMergeRazorpayWithCrm($item, $crmById[$id]);
                unset($crmById[$id]);
            }
        }

        foreach ($crmById as $row) {
            $items[] = paymentLinkCrmRowToRazorpayShape($row);
        }

        paymentLinksRefreshStalePending($items);

        // Re-merge once from a single DB read (refresh/fulfill may have updated rows).
        $items = paymentLinksOverlayCrmRows($items, $from, $to);

        if (!function_exists('paymentLinksFulfillPaidItems')) {
            require_once __DIR__ . '/payment_link_fulfillment.php';
        }
        paymentLinksFulfillPaidItems($items);

        try {
            @file_put_contents(
                $cacheFile,
                json_encode(['synced_at' => time(), 'items' => array_values($items)]),
            );
        } catch (Throwable $e) {
            error_log('[payment_links] sync cache write: ' . $e->getMessage());
        }
    }

    if ($accessScope !== null) {
        $items = paymentLinksApplyListScope($items, $accessScope);
    }

    usort($items, static function ($a, $b): int {
        $a = is_array($a) ? $a : [];
        $b = is_array($b) ? $b : [];
        return ((int) ($b['created_at'] ?? 0)) <=> ((int) ($a['created_at'] ?? 0));
    });

    return [
        'entity' => 'collection',
        'count' => count($items),
        'items' => $items,
    ];
}

function paymentLinkFindByRazorpayId(string $plinkId): ?array
{
    $db = paymentLinksDb();
    paymentLinkEnsureSchema($db);
    $st = $db->prepare(
        'SELECT * FROM payment_links WHERE razorpay_payment_link_id = ? LIMIT 1',
    );
    $st->execute([$plinkId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

function paymentLinkMarkInvoiceSent(
    string $plinkId,
    string $invoiceNumber,
    string $pdfPath,
    int $amountPaidPaise,
    string $paymentId = '',
): void {
    $db = paymentLinksDb();
    paymentLinkEnsureSchema($db);

    $processedJson = null;
    if ($paymentId !== '') {
        $existing = paymentLinkFindByRazorpayId($plinkId);
        $processed = [];
        if ($existing && !empty($existing['processed_payment_ids'])) {
            $decoded = json_decode((string) $existing['processed_payment_ids'], true);
            if (is_array($decoded)) {
                $processed = $decoded;
            }
        }
        if (!in_array($paymentId, $processed, true)) {
            $processed[] = $paymentId;
        }
        // Cap growth
        if (count($processed) > 100) {
            $processed = array_slice($processed, -100);
        }
        $processedJson = json_encode(array_values($processed));
    }

    if ($processedJson !== null) {
        $st = $db->prepare(
            'UPDATE payment_links SET
                invoice_number = ?,
                invoice_sent_at = NOW(),
                invoice_sent_for_amount_paid = GREATEST(COALESCE(invoice_sent_for_amount_paid, 0), ?),
                invoice_pdf_path = ?,
                processed_payment_ids = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE razorpay_payment_link_id = ?',
        );
        $st->execute([$invoiceNumber, $amountPaidPaise, $pdfPath, $processedJson, $plinkId]);
    } else {
        $st = $db->prepare(
            'UPDATE payment_links SET
                invoice_number = ?,
                invoice_sent_at = NOW(),
                invoice_sent_for_amount_paid = GREATEST(COALESCE(invoice_sent_for_amount_paid, 0), ?),
                invoice_pdf_path = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE razorpay_payment_link_id = ?',
        );
        $st->execute([$invoiceNumber, $amountPaidPaise, $pdfPath, $plinkId]);
    }
}
