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
        paymentLinkProcessWebhookEvent($event);
    } catch (Throwable $e) {
        error_log('[RAZORPAY WEBHOOK] process error: ' . $e->getMessage());
        paymentLinksError('Webhook processing failed', 500);
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

function handlePaymentLinkEmailReminder(string $paymentLinkId): void
{
    if (!syncpediaSmtpIsReady() && !function_exists('mail')) {
        paymentLinksError(
            'Email not configured. Set SMTP_SUPPORT_USER and SMTP_SUPPORT_PASS in api/config.php',
            500,
        );
    }

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

    $result = syncpediaSendHtmlEmail($to, $subject, $html);
    if (!$result['ok']) {
        paymentLinksError($result['error'] ?? 'Failed to send reminder email', 500);
    }

    paymentLinksSuccess([
        'sent' => true,
        'to' => $to,
        'from' => syncpediaSupportMailAddress(),
        'type' => $isPartialBalance ? 'partial_balance' : 'pending',
        'channel' => 'syncpedia_smtp',
    ]);
}

function handleSendPaymentLinkEmail(array $tokenData): void
{
    $body = getInput();
    $linkId = trim((string) ($body['link_id'] ?? $body['id'] ?? $_GET['id'] ?? ''));

    if ($linkId === '') {
        paymentLinksError('Payment link id required', 400);
    }

    if (!syncpediaSmtpIsReady() && !function_exists('mail')) {
        paymentLinksError(
            'Email not configured. Set SMTP_SUPPORT_USER and SMTP_SUPPORT_PASS in api/config.php',
            500,
        );
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

    $result = syncpediaSendHtmlEmail($to, $subject, $html);
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
        'from' => syncpediaSupportMailAddress(),
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

        default:
            paymentLinksError('Not found', 404);
    }
} catch (Throwable $e) {
    paymentLinksError($e->getMessage(), 500);
}
