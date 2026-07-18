<?php
declare(strict_types=1);

// Health check without auth — confirms this PHP file is deployed (not SPA index.html)
if (isset($_GET['action']) && $_GET['action'] === 'health') {
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store');
    echo json_encode(['success' => true, 'service' => 'payment-links']);
    exit;
}

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/razorpay_service.php';
require_once __DIR__ . '/payment_link_store.php';
require_once __DIR__ . '/payment_link_receipt.php';
require_once __DIR__ . '/payment_link_fulfillment.php';
cors();

/**
 * Route /api/payment-links/* or /api/payment-links.php (see .htaccess).
 * Returns JSON: { success: true, data: ... } to match the React client.
 */

function paymentLinksParseRoute(): array
{
    $action = isset($_GET['action']) ? trim((string) $_GET['action']) : '';
    $id = isset($_GET['id']) ? trim((string) $_GET['id']) : '';

    if ($action !== '') {
        return ['action' => $action, 'id' => $id];
    }

    $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?? '';
    $path = trim($path, '/');
    $path = preg_replace('#^api/#i', '', $path);
    $path = preg_replace('#^payment-links\.php$#i', '', $path);
    $path = preg_replace('#^payment-links/?$#i', '', $path);
    $path = trim($path, '/');

    if ($path === '') {
        return ['action' => 'list', 'id' => ''];
    }
    if ($path === 'create') {
        return ['action' => 'create', 'id' => ''];
    }
    if ($path === 'webhook') {
        return ['action' => 'webhook', 'id' => ''];
    }

    $parts = explode('/', $path);
    $linkId = $parts[0] ?? '';
    $sub = $parts[1] ?? '';

    if ($sub === 'cancel') {
        return ['action' => 'cancel', 'id' => $linkId];
    }
    if ($sub === 'remind') {
        return ['action' => 'remind', 'id' => $linkId];
    }

    return ['action' => 'fetch', 'id' => $linkId];
}

function paymentLinksSuccess($data, int $status = 200): void
{
    respond(['success' => true, 'data' => $data], $status);
}

function paymentLinksError(string $message, int $status = 500, ?array $errors = null): void
{
    $body = ['success' => false, 'error' => $message];
    if ($errors !== null) {
        $body['errors'] = $errors;
    }
    respond($body, $status);
}

function handlePaymentLinksWebhook(): void
{
    $raw = file_get_contents('php://input') ?: '';
    $signature = $_SERVER['HTTP_X_RAZORPAY_SIGNATURE'] ?? '';

    if (!razorpayVerifyWebhookSignature($raw, $signature)) {
        paymentLinksError('Invalid webhook signature', 400);
    }

    $event = json_decode($raw, true);
    if (!is_array($event)) {
        paymentLinksError('Invalid JSON', 400);
    }

    $type = (string) ($event['event'] ?? 'unknown');
    error_log('[RAZORPAY WEBHOOK] ' . $type);

    try {
        $result = paymentLinkProcessWebhookEvent($event);
    } catch (Throwable $e) {
        error_log('[RAZORPAY WEBHOOK] process error: ' . $e->getMessage());
        paymentLinksError('Webhook processing failed', 500);
    }

    // Payment row is persisted before the receipt attempt; fail so Razorpay retries the receipt.
    if (in_array($type, ['payment_link.paid', 'payment_link.partially_paid'], true)) {
        $receipt = is_array($result['receipt'] ?? null) ? $result['receipt'] : null;
        if ($receipt !== null && empty($receipt['ok'])) {
            error_log('[RAZORPAY WEBHOOK] receipt failed: ' . (string) ($receipt['error'] ?? 'unknown'));
            paymentLinksError('Receipt delivery failed', 500);
        }
    }

    paymentLinksSuccess(['received' => true, 'event' => $type]);
}

function paymentLinksResolveSalesperson(array $tokenData): array
{
    $name = '';
    $email = '';
    $userId = $tokenData['user_id'] ?? null;
    if ($userId === null || $userId === '') {
        return ['name' => $name, 'email' => $email];
    }
    try {
        $db = (new Database())->getConnection();
        $st = $db->prepare('SELECT full_name, email FROM users WHERE id = ? LIMIT 1');
        $st->execute([(string) $userId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (is_array($row)) {
            $name = trim((string) ($row['full_name'] ?? ''));
            $email = trim((string) ($row['email'] ?? ''));
        }
    } catch (Throwable $e) {
        error_log('[payment-links] salesperson lookup: ' . $e->getMessage());
    }
    return ['name' => $name, 'email' => $email];
}

function paymentLinksSetMailContextForItem(string $paymentLinkId, string $category): void
{
    $row = paymentLinkFindByRazorpayId($paymentLinkId);
    $orgId = trim((string) (is_array($row) ? ($row['org_id'] ?? '') : ''));
    syncpediaSetMailContext($orgId !== '' ? $orgId : null, $category);
}

function handlePaymentLinkEmailReminder(string $paymentLinkId): void
{
    try {
        $link = razorpayFetchPaymentLink($paymentLinkId);
    } catch (Throwable $e) {
        paymentLinksError($e->getMessage(), 500);
    }

    $customer = is_array($link['customer'] ?? null) ? $link['customer'] : [];
    $to = trim((string) ($customer['email'] ?? ''));
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
        paymentLinksError('Customer email is required to send a reminder', 400);
    }

    $payUrl = trim((string) ($link['short_url'] ?? ''));
    if ($payUrl === '') {
        paymentLinksError('Payment link URL is missing', 400);
    }

    $amountPaise = (int) ($link['amount'] ?? 0);
    $amountPaidPaise = (int) ($link['amount_paid'] ?? 0);
    $totalRupees = $amountPaise / 100;
    $paidRupees = $amountPaidPaise / 100;
    $status = strtolower(trim((string) ($link['status'] ?? 'created')));

    $isPartialBalance = $status === 'partially_paid'
        || ($amountPaidPaise > 0 && $amountPaidPaise < $amountPaise);

    if ($status === 'paid' || ($amountPaise > 0 && $amountPaidPaise >= $amountPaise)) {
        paymentLinksError('This payment link is already fully paid', 400);
    }
    if ($status === 'cancelled' || $status === 'expired') {
        paymentLinksError('Reminders cannot be sent for cancelled or expired links', 400);
    }

    $customerName = trim((string) ($customer['name'] ?? 'Customer'));
    $customerPhone = isset($customer['contact']) ? trim((string) $customer['contact']) : null;
    if ($customerPhone === '') {
        $customerPhone = null;
    }
    $description = trim((string) ($link['description'] ?? ''));
    $plinkId = trim((string) ($link['id'] ?? $paymentLinkId));

    $balanceRupees = max(0, $totalRupees - $paidRupees);
    if ($isPartialBalance) {
        $subject = 'Reminder: balance due — INR ' . number_format($balanceRupees, 2, '.', ',')
            . ' | ' . syncpediaMailLegalEntityName();
    } else {
        $subject = 'Payment reminder — INR ' . number_format($totalRupees, 2, '.', ',')
            . ' | ' . syncpediaMailLegalEntityName();
    }

    $html = syncpediaBuildPaymentLinkReminderEmailHtml(
        $customerName,
        $to,
        $customerPhone,
        $description,
        $totalRupees,
        $paidRupees,
        $payUrl,
        $plinkId,
        $isPartialBalance,
    );

    $plain = "Dear {$customerName},\n\n";
    if ($isPartialBalance) {
        $plain .= "Thank you for your partial payment of INR " . number_format($paidRupees, 2)
            . ". Balance due: INR " . number_format($balanceRupees, 2) . "\n\n";
    } else {
        $plain .= "Reminder: please complete your payment of INR " . number_format($totalRupees, 2) . "\n\n";
    }
    $plain .= "Pay here: {$payUrl}\n\nRegards,\nSyncpedia\nsupport@syncpedia.in";

    paymentLinksSetMailContextForItem($paymentLinkId, 'payment_links');
    $result = syncpediaSendHtmlEmail($to, $subject, $html, 'payment_links');
    if (!$result['ok']) {
        paymentLinksError($result['error'] ?? 'Failed to send reminder email', 500);
    }

    paymentLinksSuccess([
        'sent' => true,
        'to' => $to,
        'from' => (string) ($result['from'] ?? syncpediaSupportMailAddress()),
        'type' => $isPartialBalance ? 'partial_balance' : 'pending',
        'channel' => ($result['transport'] ?? '') === 'smtp' ? 'syncpedia_smtp' : ($result['transport'] ?? 'unknown'),
        'transport' => $result['transport'] ?? 'smtp',
    ]);
}

function handleSendPaymentLinkEmail(array $tokenData): void
{
    $body = getInput();
    $linkId = trim((string) ($body['link_id'] ?? $body['id'] ?? $_GET['id'] ?? ''));

    if ($linkId === '') {
        paymentLinksError('Payment link id required', 400);
    }

    $db = paymentLinksDb();
    paymentLinksAssertItemAllowed($db, $tokenData, $linkId);

    try {
        $link = razorpayFetchPaymentLink($linkId);
    } catch (Throwable $e) {
        paymentLinksError($e->getMessage(), 500);
    }

    if (!is_array($link)) {
        paymentLinksError('Payment link not found', 404);
    }

    $customer = is_array($link['customer'] ?? null) ? $link['customer'] : [];
    $to = trim((string) ($body['customer_email'] ?? $customer['email'] ?? ''));
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
        paymentLinksError('A valid customer email is required to send the payment link', 400);
    }

    $payUrl = trim((string) ($link['short_url'] ?? $body['short_url'] ?? ''));
    if ($payUrl === '') {
        paymentLinksError('Payment link URL is missing', 400);
    }

    $amountPaise = (int) ($link['amount'] ?? 0);
    $amountRupees = $amountPaise > 0 ? $amountPaise / 100 : (float) ($body['amount_rupees'] ?? 0);
    $customerName = trim((string) ($customer['name'] ?? $body['customer_name'] ?? 'Customer'));
    $customerPhone = isset($customer['contact']) ? trim((string) $customer['contact']) : null;
    if ($customerPhone === '') {
        $customerPhone = null;
    }
    $description = trim((string) ($link['description'] ?? $body['description'] ?? ''));
    $plinkId = trim((string) ($link['id'] ?? $linkId));

    $subject = 'Payment requested by ' . syncpediaMailLegalEntityName();
    $html = syncpediaBuildPaymentLinkRequestEmailHtml(
        $customerName,
        $to,
        $customerPhone,
        $description,
        $amountRupees,
        $payUrl,
        $plinkId,
    );

    paymentLinksSetMailContextForItem($linkId, 'payment_links');
    $result = syncpediaSendHtmlEmail($to, $subject, $html, 'payment_links');
    $sales = paymentLinksResolveSalesperson($tokenData);
    $amountDisplay = 'INR ' . number_format($amountRupees, 2, '.', ',');

    syncpediaNotifySupportPaymentLinkCustomerMail(
        $result['ok'],
        $plinkId,
        $to,
        $customerName,
        $amountDisplay,
        $sales['name'],
        $sales['email'],
        $result['ok'] ? null : ($result['error'] ?? 'Unknown error'),
    );

    if (!$result['ok']) {
        paymentLinksError($result['error'] ?? 'Failed to send email', 500);
    }

    paymentLinksSuccess([
        'sent' => true,
        'to' => $to,
        'from' => (string) ($result['from'] ?? syncpediaSupportMailAddress()),
        'transport' => $result['transport'] ?? 'smtp',
    ]);
}

/** Return an active form only when it is visible to the current user. */
function paymentLinksFindAllowedForm(PDO $db, array $tokenData, string $formId): ?array
{
    $st = $db->prepare(
        'SELECT lf.id, lf.name, lf.slug, lf.org_id, lf.created_by, lf.is_active,
                LOWER(TRIM(o.slug)) AS org_slug,
                LOWER(TRIM(cu.role)) AS creator_role
         FROM lead_forms lf
         LEFT JOIN organizations o ON o.id = lf.org_id
         LEFT JOIN users cu ON cu.id = lf.created_by
         WHERE lf.id = ? AND lf.is_active = 1
         LIMIT 1',
    );
    $st->execute([$formId]);
    $form = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($form)) {
        return null;
    }

    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    $userId = trim((string) ($tokenData['user_id'] ?? ''));
    $orgId = paymentLinksResolveOrgId($tokenData);
    $formOrgId = trim((string) ($form['org_id'] ?? ''));

    if ($role === 'super_admin' && tenantIsMasterView($tokenData)) {
        return $form;
    }
    if ($orgId === null || $formOrgId === '' || $formOrgId !== $orgId) {
        return null;
    }
    if ($role === 'admin' && ($form['org_slug'] ?? '') === 'syncpedia'
        && syncpediaNormalizeRoleKey((string) ($form['creator_role'] ?? '')) !== 'super_admin') {
        return null;
    }
    if ($role === 'marketing' && ($form['org_slug'] ?? '') === 'syncpedia'
        && trim((string) ($form['created_by'] ?? '')) !== $userId) {
        return null;
    }
    if (in_array($role, ['super_admin', 'admin', 'org', 'manager', 'marketing'], true)) {
        return $form;
    }

    $assigned = $db->prepare(
        'SELECT 1 FROM lead_form_assignments WHERE form_id = ? AND member_id = ? LIMIT 1',
    );
    $assigned->execute([$formId, $userId]);
    return $assigned->fetchColumn() ? $form : null;
}

function paymentLinksPublicFormUrl(array $form, array $link): string
{
    $base = defined('CRM_PUBLIC_URL') ? trim((string) CRM_PUBLIC_URL) : '';
    if ($base === '') {
        $https = !empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off';
        $host = preg_replace('/[^a-z0-9.:-]/i', '', (string) ($_SERVER['HTTP_HOST'] ?? ''));
        $base = ($https ? 'https://' : 'http://') . $host;
    }
    $url = rtrim($base, '/') . '/apply?form=' . rawurlencode((string) ($form['slug'] ?? ''));

    $notes = is_array($link['notes'] ?? null) ? $link['notes'] : [];
    $referral = trim((string) ($notes['crm_referral'] ?? $notes['referral_code'] ?? ''));
    if ($referral === '') {
        $local = paymentLinkFindByRazorpayId((string) ($link['id'] ?? ''));
        $referral = trim((string) (is_array($local) ? ($local['salesperson_referral_code'] ?? '') : ''));
    }
    if ($referral !== '') {
        $url .= '&ref=' . rawurlencode($referral);
    }
    return $url;
}

function handleSendPaidFormLinkEmail(array $tokenData): void
{
    $body = getInput();
    $linkId = trim((string) ($body['link_id'] ?? $body['id'] ?? ''));
    $formId = trim((string) ($body['form_id'] ?? ''));
    if ($linkId === '' || $formId === '') {
        paymentLinksError('Payment link and form are required', 400);
    }

    $db = paymentLinksDb();
    paymentLinksAssertItemAllowed($db, $tokenData, $linkId);
    syncpediaRateLimitConsume('payment_link_send_form_' . $linkId, 1, 15);
    $form = paymentLinksFindAllowedForm($db, $tokenData, $formId);
    if (!is_array($form)) {
        paymentLinksError('Form not found or unavailable to your account', 404);
    }

    try {
        $link = razorpayFetchPaymentLink($linkId);
    } catch (Throwable $e) {
        paymentLinksError($e->getMessage(), 500);
    }
    if (!is_array($link)) {
        paymentLinksError('Payment link not found', 404);
    }

    $amount = (int) ($link['amount'] ?? 0);
    $amountPaid = (int) ($link['amount_paid'] ?? 0);
    $status = paymentLinkMapRazorpayStatus((string) ($link['status'] ?? ''), $amountPaid, $amount);
    if ($status !== 'paid') {
        paymentLinksError('Form links can only be emailed after the payment is fully paid', 409);
    }

    $customer = is_array($link['customer'] ?? null) ? $link['customer'] : [];
    $to = trim((string) ($customer['email'] ?? ''));
    if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
        paymentLinksError('Customer email is required', 400);
    }
    $customerName = trim((string) ($customer['name'] ?? 'Customer'));
    $formName = trim((string) ($form['name'] ?? 'Form'));
    $formUrl = paymentLinksPublicFormUrl($form, $link);

    $eName = htmlspecialchars($customerName, ENT_QUOTES, 'UTF-8');
    $eForm = htmlspecialchars($formName, ENT_QUOTES, 'UTF-8');
    $eUrl = htmlspecialchars($formUrl, ENT_QUOTES, 'UTF-8');
    $html = '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#1f2937">'
        . '<h2 style="color:#0f5132">Please complete your form</h2>'
        . '<p>Dear ' . $eName . ',</p>'
        . '<p>Thank you for completing your payment. Please use the link below to complete <strong>'
        . $eForm . '</strong>.</p>'
        . '<p style="margin:28px 0"><a href="' . $eUrl
        . '" style="background:#16a34a;color:#fff;padding:12px 22px;text-decoration:none;border-radius:6px;display:inline-block">'
        . 'Open form</a></p>'
        . '<p>If the button does not work, copy this URL:<br><a href="' . $eUrl . '">' . $eUrl . '</a></p>'
        . '<p>Regards,<br>' . htmlspecialchars(syncpediaMailLegalEntityName(), ENT_QUOTES, 'UTF-8') . '</p>'
        . '</div>';
    paymentLinksSetMailContextForItem($linkId, 'form_links');
    $result = syncpediaSendHtmlEmail($to, $formName . ' — form link', $html, 'form_links');
    if (empty($result['ok'])) {
        paymentLinksError($result['error'] ?? 'Failed to send form link email', 500);
    }

    paymentLinksSuccess([
        'sent' => true,
        'to' => $to,
        'from' => (string) ($result['from'] ?? syncpediaSupportMailAddress()),
        'form_id' => $formId,
        'form_name' => $formName,
    ]);
}

function handleCreateStandardPaymentLink(array $tokenData): void
{
    $body = getInput();
    $errors = [];

    $amount = isset($body['amount']) ? (float) $body['amount'] : 0;
    if (!is_finite($amount) || $amount < 100) {
        $errors[] = 'amount must be at least ₹1 (100 paise)';
    }

    $customer = is_array($body['customer'] ?? null) ? $body['customer'] : [];
    $name = trim((string) ($customer['name'] ?? ''));
    if ($name === '') {
        $errors[] = 'customer.name is required';
    }

    $email = trim((string) ($customer['email'] ?? ''));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'customer.email is invalid';
    }

    $acceptPartial = ($body['accept_partial'] ?? false) === true;
    $minPartial = isset($body['first_min_partial_amount'])
        ? (float) $body['first_min_partial_amount']
        : 0;
    if ($acceptPartial) {
        if (!is_finite($minPartial) || $minPartial < 100) {
            $errors[] = 'first_min_partial_amount must be at least ₹1';
        } elseif ($minPartial >= $amount) {
            $errors[] = 'minimum partial amount must be less than total amount';
        }
    }

    $expireBy = isset($body['expire_by']) ? (int) $body['expire_by'] : null;
    if ($expireBy !== null && $expireBy > 0 && $expireBy <= time()) {
        $errors[] = 'expire_by must be a future date';
    }

    if ($errors !== []) {
        paymentLinksError('Validation failed', 400, $errors);
    }

    $userNotes = is_array($body['notes'] ?? null) ? $body['notes'] : [];
    $creatorId = trim((string) ($tokenData['user_id'] ?? ''));
    if ($creatorId !== '') {
        $userNotes['salesperson_id'] = $creatorId;
    }
    $refCode = trim((string) ($body['referralCode'] ?? ''));
    if ($refCode !== '') {
        $userNotes['crm_referral'] = $refCode;
    }

    try {
        $link = razorpayCreateStandardPaymentLink([
            'amount' => $amount,
            'currency' => $body['currency'] ?? 'INR',
            'description' => $body['description'] ?? null,
            'customer' => [
                'name' => $name,
                'email' => $email !== '' ? $email : null,
                'contact' => isset($customer['contact']) ? (string) $customer['contact'] : null,
            ],
            'notify' => [
                'sms' => ($body['notify']['sms'] ?? false) === true,
                'email' => ($body['notify']['email'] ?? false) === true,
            ],
            'reminder_enable' => ($body['reminder_enable'] ?? false) === true,
            'expire_by' => $expireBy,
            'reference_id' => isset($body['reference_id']) ? trim((string) $body['reference_id']) : null,
            'accept_partial' => $acceptPartial,
            'first_min_partial_amount' => $acceptPartial ? $minPartial : null,
            'notes' => $userNotes,
        ]);
        $body['notes'] = $userNotes;
        try {
            $persisted = paymentLinkPersistOnCreate($link, $body, $tokenData);
            if ($persisted === null) {
                error_log('[payment-links] persist on create returned null for ' . ($link['id'] ?? ''));
            }
        } catch (Throwable $e) {
            error_log('[payment-links] persist on create: ' . $e->getMessage());
        }
        paymentLinksSuccess($link, 201);
    } catch (Throwable $e) {
        paymentLinksError($e->getMessage(), 500);
    }
}

$method = $_SERVER['REQUEST_METHOD'];
$route = paymentLinksParseRoute();
$action = $route['action'];
$id = $route['id'];

if (!function_exists('curl_init')) {
    paymentLinksError(
        'PHP cURL extension is not enabled on this server. Enable it in Hostinger PHP settings.',
        500,
    );
}

if ($action === 'webhook' && $method === 'POST') {
    handlePaymentLinksWebhook();
}

$tokenData = verifyToken();

// Sales reps only when page_access.payments is enabled (admins/managers always).
$__payRole = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
if ($__payRole === 'sales_representative') {
    $__db = paymentLinksDb();
    ensureUsersPageAccessColumn($__db);
    try {
        $__st = $__db->prepare('SELECT role, page_access_json FROM users WHERE id = ? LIMIT 1');
        $__st->execute([(string) ($tokenData['user_id'] ?? '')]);
        $__row = $__st->fetch(PDO::FETCH_ASSOC) ?: null;
    } catch (Throwable $e) {
        $__row = null;
    }
    if (!userCanAccessPaymentsPage($tokenData, is_array($__row) ? $__row : null)) {
        respond(['error' => 'Forbidden — Payment links access is disabled for this account'], 403);
    }
}

try {
    switch ($action) {
        case 'crm_list':
            if ($method !== 'GET') {
                paymentLinksError('Method not allowed', 405);
            }
            $db = paymentLinksDb();
            paymentLinkEnsureSchema($db);
            $scope = paymentLinksBuildAccessScope($db, $tokenData);
            $scopeSql = paymentLinksCrmListScopeSql($scope);
            $sql = 'SELECT razorpay_payment_link_id, customer_name, customer_email, amount, amount_paid,
                        status, invoice_number, invoice_sent_at, invoice_sent_for_amount_paid,
                        (invoice_pdf_path IS NOT NULL AND invoice_pdf_path != "") AS has_invoice,
                        salesperson_id, salesperson_referral_code, created_at
                 FROM payment_links WHERE 1=1' . $scopeSql['sql'] . ' ORDER BY updated_at DESC LIMIT 200';
            $st = $db->prepare($sql);
            $st->execute($scopeSql['params']);
            paymentLinksSuccess($st ? $st->fetchAll(PDO::FETCH_ASSOC) : []);
            break;

        case 'list':
            if ($method !== 'GET') {
                paymentLinksError('Method not allowed', 405);
            }
            $from = isset($_GET['from']) && $_GET['from'] !== ''
                ? (int) $_GET['from']
                : null;
            $to = isset($_GET['to']) && $_GET['to'] !== ''
                ? (int) $_GET['to']
                : null;
            $maxPages = 30;
            if ($from === null && $to === null) {
                $maxPages = 50;
            }
            $result = paymentLinksListMerged([
                'from' => $from,
                'to' => $to,
                'status' => $_GET['status'] ?? null,
                'count' => 100,
                'skip' => $_GET['skip'] ?? 0,
                'max_pages' => $maxPages,
                'force' => !empty($_GET['force']),
            ], $tokenData);
            paymentLinksSuccess($result);
            break;

        case 'create':
            if ($method !== 'POST') {
                paymentLinksError('Method not allowed', 405);
            }
            handleCreateStandardPaymentLink($tokenData);
            break;

        case 'invoice':
            if ($method !== 'GET') {
                paymentLinksError('Method not allowed', 405);
            }
            $plinkId = $id !== '' ? $id : trim((string) ($_GET['id'] ?? ''));
            if ($plinkId === '') {
                paymentLinksError('Payment link id required', 400);
            }
            $db = paymentLinksDb();
            paymentLinksAssertItemAllowed($db, $tokenData, $plinkId);
            $row = paymentLinkFindByRazorpayId($plinkId);
            if (!is_array($row) || empty($row['invoice_pdf_path'])
                || !syncpediaDocumentStorageFileExists((string) $row['invoice_pdf_path'])) {
                paymentLinksError('Invoice not found for this payment link', 404);
            }
            $name = trim((string) ($row['invoice_number'] ?? 'invoice'));
            $resolved = syncpediaDocumentStorageResolvePath((string) $row['invoice_pdf_path']);
            $ext = is_string($resolved) && preg_match('/\.html?$/i', $resolved) ? '.html' : '.pdf';
            syncpediaDocumentStorageStreamPdf((string) $row['invoice_pdf_path'], $name . $ext);
            break;

        case 'fetch':
            if ($method !== 'GET') {
                paymentLinksError('Method not allowed', 405);
            }
            if ($id === '') {
                paymentLinksError('Payment link id required', 400);
            }
            $db = paymentLinksDb();
            paymentLinksAssertItemAllowed($db, $tokenData, $id);
            paymentLinksSuccess(razorpayFetchPaymentLink($id));
            break;

        case 'cancel':
            if ($method !== 'POST') {
                paymentLinksError('Method not allowed', 405);
            }
            if ($id === '') {
                paymentLinksError('Payment link id required', 400);
            }
            $db = paymentLinksDb();
            paymentLinksAssertItemAllowed($db, $tokenData, $id);
            $cancelled = razorpayCancelPaymentLink($id);
            paymentLinkUpsertFromRazorpay($cancelled, null);
            paymentLinksSuccess($cancelled);
            break;

        case 'remind':
            if ($method !== 'POST') {
                paymentLinksError('Method not allowed', 405);
            }
            if ($id === '') {
                paymentLinksError('Payment link id required', 400);
            }
            $db = paymentLinksDb();
            paymentLinksAssertItemAllowed($db, $tokenData, $id);
            syncpediaRateLimitConsume('payment_link_remind_' . $id, 1, 15);
            $input = getInput();
            $medium = (($input['medium'] ?? 'email') === 'sms') ? 'sms' : 'email';
            if ($medium === 'sms') {
                paymentLinksSuccess(razorpaySendReminder($id, 'sms'));
            } else {
                handlePaymentLinkEmailReminder($id);
            }
            break;

        case 'send_email':
            if ($method !== 'POST') {
                paymentLinksError('Method not allowed', 405);
            }
            handleSendPaymentLinkEmail($tokenData);
            break;

        case 'send_form_link':
            if ($method !== 'POST') {
                paymentLinksError('Method not allowed', 405);
            }
            handleSendPaidFormLinkEmail($tokenData);
            break;

        default:
            paymentLinksError('Not found', 404);
    }
} catch (Throwable $e) {
    paymentLinksError($e->getMessage(), 500);
}
