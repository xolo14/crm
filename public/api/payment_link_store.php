<?php
/**
 * Persist Razorpay payment links in MySQL (payment_links table).
 */
require_once __DIR__ . '/document_storage.php';

function paymentLinksDb(): PDO
{
    return (new Database())->getConnection();
}

function paymentLinkEnsureSchema(PDO $db): void
{
    try {
        $db->exec(
            'CREATE TABLE IF NOT EXISTS `payment_links` (
              `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
              `org_id` CHAR(36) DEFAULT NULL,
              `razorpay_payment_link_id` VARCHAR(64) NOT NULL,
              `salesperson_id` CHAR(36) NOT NULL,
              `salesperson_referral_code` VARCHAR(50) NOT NULL DEFAULT "",
              `customer_name` VARCHAR(200) NOT NULL,
              `customer_email` VARCHAR(255) DEFAULT NULL,
              `customer_phone` VARCHAR(30) DEFAULT NULL,
              `amount` BIGINT NOT NULL,
              `currency` VARCHAR(3) NOT NULL DEFAULT "INR",
              `description` VARCHAR(500) DEFAULT NULL,
              `reference_id` VARCHAR(100) DEFAULT NULL,
              `payment_type` ENUM("full","partial") NOT NULL DEFAULT "full",
              `accept_partial` TINYINT(1) NOT NULL DEFAULT 0,
              `first_min_partial_amount` BIGINT UNSIGNED DEFAULT NULL,
              `status` ENUM("created","partially_paid","paid","cancelled","expired") NOT NULL DEFAULT "created",
              `amount_paid` BIGINT UNSIGNED NOT NULL DEFAULT 0,
              `razorpay_short_url` VARCHAR(500) NOT NULL DEFAULT "",
              `notify_email` TINYINT(1) NOT NULL DEFAULT 0,
              `notify_sms` TINYINT(1) NOT NULL DEFAULT 0,
              `expire_by` DATETIME DEFAULT NULL,
              `reminder_enable` TINYINT(1) NOT NULL DEFAULT 0,
              `notes` JSON DEFAULT NULL,
              `invoice_number` VARCHAR(64) DEFAULT NULL,
              `invoice_sent_at` DATETIME DEFAULT NULL,
              `invoice_sent_for_amount_paid` BIGINT UNSIGNED DEFAULT NULL,
              `invoice_pdf_path` TEXT DEFAULT NULL,
              `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              UNIQUE KEY `uq_pl_rzp_id` (`razorpay_payment_link_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
    } catch (Throwable $e) {
        error_log('[payment_links] ensure table: ' . $e->getMessage());
    }
}

function paymentLinkMapRazorpayStatus(string $status, int $amountPaid, int $amount): string
{
    $s = strtolower(trim($status));
    if ($s === 'paid') {
        return 'paid';
    }
    if ($s === 'partially_paid' || ($amountPaid > 0 && $amountPaid < $amount)) {
        return 'partially_paid';
    }
    if ($s === 'cancelled') {
        return 'cancelled';
    }
    if ($s === 'expired') {
        return 'expired';
    }
    return 'created';
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

    $sql = 'INSERT INTO payment_links (
        org_id, razorpay_payment_link_id, salesperson_id, salesperson_referral_code,
        customer_name, customer_email, customer_phone, amount, currency, description,
        reference_id, payment_type, accept_partial, first_min_partial_amount, status,
        amount_paid, razorpay_short_url, notify_email, notify_sms, expire_by,
        reminder_enable, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
        customer_name = VALUES(customer_name),
        customer_email = VALUES(customer_email),
        customer_phone = VALUES(customer_phone),
        amount = VALUES(amount),
        description = VALUES(description),
        reference_id = VALUES(reference_id),
        status = VALUES(status),
        amount_paid = VALUES(amount_paid),
        razorpay_short_url = VALUES(razorpay_short_url),
        notes = VALUES(notes),
        updated_at = CURRENT_TIMESTAMP';

    $stmt = $db->prepare($sql);
    $stmt->execute([
        $tokenData['org_id'] ?? null,
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
    $amountPaid = (int) ($rzpLink['amount_paid'] ?? 0);
    $status = paymentLinkMapRazorpayStatus(
        (string) ($rzpLink['status'] ?? 'created'),
        $amountPaid,
        $amount,
    );

    $expireBy = null;
    if (!empty($rzpLink['expire_by'])) {
        $expireBy = date('Y-m-d H:i:s', (int) $rzpLink['expire_by']);
    }

    $notesJson = json_encode($notes, JSON_UNESCAPED_UNICODE) ?: '{}';

    if ($existing) {
        $upd = $db->prepare(
            'UPDATE payment_links SET
                customer_name = ?, customer_email = ?, customer_phone = ?,
                amount = ?, description = ?, reference_id = ?, status = ?,
                amount_paid = ?, razorpay_short_url = ?, expire_by = ?, notes = ?,
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
 * @return array{mode: string, org_id: ?string, salesperson_ids: string[]}
 */
function paymentLinksBuildAccessScope(PDO $db, array $tokenData): array
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    $orgId = getOrgId($tokenData);

    if ($role === 'super_admin' && !$orgId) {
        return ['mode' => 'all', 'org_id' => null, 'salesperson_ids' => []];
    }
    if (in_array($role, ['admin', 'org', 'finance'], true) || ($role === 'super_admin' && $orgId)) {
        return ['mode' => 'org', 'org_id' => is_string($orgId) ? $orgId : null, 'salesperson_ids' => []];
    }
    if ($role === 'manager') {
        $ids = hierarchyGetVisibleUserIds($db, $tokenData);
        if (empty($ids) && $userId !== '') {
            $ids = [$userId];
        }
        return ['mode' => 'downline', 'org_id' => is_string($orgId) ? $orgId : null, 'salesperson_ids' => $ids];
    }
    if ($role === 'sales_representative') {
        return [
            'mode' => 'self',
            'org_id' => is_string($orgId) ? $orgId : null,
            'salesperson_ids' => $userId !== '' ? [$userId] : [],
        ];
    }
    return [
        'mode' => 'self',
        'org_id' => is_string($orgId) ? $orgId : null,
        'salesperson_ids' => $userId !== '' ? [$userId] : [],
    ];
}

/**
 * @param array{mode: string, org_id: ?string, salesperson_ids: string[]} $scope
 * @return array{sql: string, params: array}
 */
function paymentLinksCrmListScopeSql(array $scope): array
{
    $mode = (string) ($scope['mode'] ?? 'all');
    if ($mode === 'all') {
        return ['sql' => '', 'params' => []];
    }
    if ($mode === 'org' && !empty($scope['org_id'])) {
        return ['sql' => ' AND org_id = ?', 'params' => [(string) $scope['org_id']]];
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

/** @param array<string, mixed> $item @param array{mode: string, org_id: ?string, salesperson_ids: string[]} $scope @param array<string, array<string, mixed>> $crmMap */
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
        }
        return true;
    }
    return true;
}

/** @param list<mixed> $items @param array{mode: string, org_id: ?string, salesperson_ids: string[]} $scope @return list<mixed> */
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

    $status = (string) ($row['status'] ?? 'created');
    if ($status === 'partially_paid') {
        $status = 'partially_paid';
    }

    return [
        'id' => (string) ($row['razorpay_payment_link_id'] ?? ''),
        'amount' => (int) ($row['amount'] ?? 0),
        'amount_paid' => (int) ($row['amount_paid'] ?? 0),
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

/**
 * Razorpay list + CRM rows missing from API response.
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

    $result = razorpayFetchAllPaymentLinks($filters);
    $items = is_array($result['items'] ?? null) ? $result['items'] : [];
    $seen = [];
    foreach ($items as $item) {
        if (is_array($item) && !empty($item['id'])) {
            $seen[(string) $item['id']] = true;
        }
    }

    try {
        foreach (paymentLinkListCrmRows($from, $to, 500, $accessScope) as $row) {
            $id = trim((string) ($row['razorpay_payment_link_id'] ?? ''));
            if ($id === '' || isset($seen[$id])) {
                continue;
            }
            $items[] = paymentLinkCrmRowToRazorpayShape($row);
            $seen[$id] = true;
        }
    } catch (Throwable $e) {
        error_log('[payment_links] CRM list merge: ' . $e->getMessage());
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
): void {
    $db = paymentLinksDb();
    $st = $db->prepare(
        'UPDATE payment_links SET
            invoice_number = ?,
            invoice_sent_at = NOW(),
            invoice_sent_for_amount_paid = ?,
            invoice_pdf_path = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE razorpay_payment_link_id = ?',
    );
    $st->execute([$invoiceNumber, $amountPaidPaise, $pdfPath, $plinkId]);
}
