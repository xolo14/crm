<?php
/**
 * Razorpay Payment Links API (PHP cURL — no Node.js required).
 * Configure RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET in config.php.
 */

function razorpayKeysConfigured(): bool
{
    if (!defined('RAZORPAY_KEY_ID') || !defined('RAZORPAY_KEY_SECRET')) {
        return false;
    }
    $id = trim((string) RAZORPAY_KEY_ID);
    $secret = trim((string) RAZORPAY_KEY_SECRET);
    return $id !== '' && $secret !== '' && str_starts_with($id, 'rzp_');
}

function razorpayCallbackBase(): string
{
    if (defined('CRM_PUBLIC_URL') && CRM_PUBLIC_URL !== '') {
        return rtrim((string) CRM_PUBLIC_URL, '/');
    }
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $scheme . '://' . $host;
}

/**
 * @return array<string, mixed>
 */
function razorpayApiRequest(string $method, string $path, ?array $body = null): array
{
    if (!razorpayKeysConfigured()) {
        throw new RuntimeException(
            'Razorpay keys not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in api/config.php',
        );
    }

    $url = 'https://api.razorpay.com/v1/' . ltrim($path, '/');
    $ch = curl_init($url);
    if ($ch === false) {
        throw new RuntimeException('Failed to initialize cURL');
    }

    curl_setopt($ch, CURLOPT_USERPWD, trim((string) RAZORPAY_KEY_ID) . ':' . trim((string) RAZORPAY_KEY_SECRET));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 60);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);

    $method = strtoupper($method);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
        }
    } elseif ($method !== 'GET') {
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
        }
    }

    $raw = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($raw === false) {
        throw new RuntimeException('Razorpay request failed: ' . ($curlErr ?: 'unknown error'));
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('Invalid response from Razorpay (HTTP ' . $httpCode . ')');
    }

    if ($httpCode >= 400) {
        $msg = $decoded['error']['description']
            ?? $decoded['error']['reason']
            ?? $decoded['error']['code']
            ?? ('Razorpay API error (HTTP ' . $httpCode . ')');
        throw new RuntimeException((string) $msg);
    }

    return $decoded;
}

/**
 * @param array<string, mixed> $filters
 * @return array<string, mixed>
 */
function razorpayFetchAllPaymentLinks(array $filters = []): array
{
    $pageSize = min(100, max(1, (int) ($filters['count'] ?? 100)));
    $maxPages = min(50, max(1, (int) ($filters['max_pages'] ?? 20)));
    $baseSkip = max(0, (int) ($filters['skip'] ?? 0));

    $allItems = [];
    for ($page = 0; $page < $maxPages; $page++) {
        $query = [];
        if (!empty($filters['from'])) {
            $query['from'] = (int) $filters['from'];
        }
        if (!empty($filters['to'])) {
            $query['to'] = (int) $filters['to'];
        }
        if (!empty($filters['status'])) {
            $query['status'] = (string) $filters['status'];
        }
        $query['count'] = $pageSize;
        $query['skip'] = $baseSkip + ($page * $pageSize);

        $path = 'payment_links?' . http_build_query($query);
        $batch = razorpayApiRequest('GET', $path);
        $items = $batch['items'] ?? [];
        if (!is_array($items) || count($items) === 0) {
            break;
        }
        foreach ($items as $item) {
            if (is_array($item)) {
                $allItems[] = $item;
            }
        }
        if (count($items) < $pageSize) {
            break;
        }
    }

    usort($allItems, static function (array $a, array $b): int {
        return ((int) ($b['created_at'] ?? 0)) <=> ((int) ($a['created_at'] ?? 0));
    });

    return [
        'entity' => 'collection',
        'count' => count($allItems),
        'items' => $allItems,
    ];
}

/** @return array<string, mixed> */
function razorpayFetchPaymentLink(string $paymentLinkId): array
{
    return razorpayApiRequest('GET', 'payment_links/' . rawurlencode($paymentLinkId));
}

/** @return array<string, mixed> */
function razorpayCancelPaymentLink(string $paymentLinkId): array
{
    return razorpayApiRequest('POST', 'payment_links/' . rawurlencode($paymentLinkId) . '/cancel');
}

/** @return array<string, mixed> */
function razorpaySendReminder(string $paymentLinkId, string $medium): array
{
    $medium = $medium === 'sms' ? 'sms' : 'email';
    return razorpayApiRequest(
        'POST',
        'payment_links/' . rawurlencode($paymentLinkId) . '/notify_by/' . $medium,
    );
}

/**
 * Standard payment link — amount already in paise.
 *
 * @param array<string, mixed> $input
 * @return array<string, mixed>
 */
function razorpayCreateStandardPaymentLink(array $input): array
{
    $callbackBase = razorpayCallbackBase();

    $customer = is_array($input['customer'] ?? null) ? $input['customer'] : [];
    $custPayload = ['name' => (string) ($customer['name'] ?? '')];
    if (!empty($customer['email'])) {
        $custPayload['email'] = (string) $customer['email'];
    }
    if (!empty($customer['contact'])) {
        $custPayload['contact'] = (string) $customer['contact'];
    }

    $notify = is_array($input['notify'] ?? null) ? $input['notify'] : [];
    $notes = is_array($input['notes'] ?? null) ? $input['notes'] : [];
    $notes['created_by'] = 'SYNCPedia CRM';

    $payload = [
        'amount' => (int) round((float) ($input['amount'] ?? 0)),
        'currency' => $input['currency'] ?? 'INR',
        'customer' => $custPayload,
        'notify' => [
            'sms' => ($notify['sms'] ?? false) === true,
            'email' => ($notify['email'] ?? false) === true,
        ],
        'reminder_enable' => ($input['reminder_enable'] ?? false) === true,
        'notes' => $notes,
        'callback_url' => $callbackBase . '/payments?status=paid',
        'callback_method' => 'get',
    ];

    if (!empty($input['description'])) {
        $payload['description'] = (string) $input['description'];
    }
    if (!empty($input['reference_id'])) {
        $payload['reference_id'] = (string) $input['reference_id'];
    }
    if (!empty($input['expire_by'])) {
        $payload['expire_by'] = (int) $input['expire_by'];
    }
    if (($input['accept_partial'] ?? false) === true) {
        $payload['accept_partial'] = true;
        if (isset($input['first_min_partial_amount'])) {
            $payload['first_min_partial_amount'] = (int) round(
                (float) $input['first_min_partial_amount'],
            );
        }
    }

    return razorpayApiRequest('POST', 'payment_links', $payload);
}

function razorpayVerifyWebhookSignature(string $rawBody, string $signature): bool
{
    if (!defined('RAZORPAY_WEBHOOK_SECRET') || RAZORPAY_WEBHOOK_SECRET === '') {
        error_log('[RAZORPAY] Webhook secret not configured — rejecting');
        return false;
    }
    if ($signature === '') {
        return false;
    }
    $expected = hash_hmac('sha256', $rawBody, RAZORPAY_WEBHOOK_SECRET);
    return hash_equals($expected, $signature);
}
