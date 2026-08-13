<?php
/**
 * Retry payment_links marked reconcile_needed (receipt / enrollment drift).
 * Schedule via Hostinger cron every 10–15 minutes:
 *   php /home/.../public_html/api/cron_payment_reconcile.php
 * Or:
 *   GET /api/cron_payment_reconcile.php?key=YOUR_CRON_SECRET
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/payment_link_store.php';
require_once __DIR__ . '/payment_link_fulfillment.php';

$cli = (PHP_SAPI === 'cli');
if (!$cli) {
    $key = (string) ($_GET['key'] ?? $_SERVER['HTTP_X_CRON_KEY'] ?? '');
    $expected = '';
    if (defined('CRON_SECRET')) {
        $expected = (string) CRON_SECRET;
    } elseif (defined('WHATSAPP_CRON_SECRET')) {
        $expected = (string) WHATSAPP_CRON_SECRET;
    }
    if ($expected === '' || !hash_equals($expected, $key)) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Forbidden']);
        exit;
    }
}

$db = (new Database())->getConnection();
paymentLinkEnsureSchema($db);

$limit = 50;
try {
    $stmt = $db->query(
        'SELECT razorpay_payment_link_id, id, status, amount, amount_paid, invoice_sent_for_amount_paid, enrollment_applied_at, reconcile_needed
         FROM payment_links
         WHERE reconcile_needed = 1
         ORDER BY updated_at ASC
         LIMIT ' . (int) $limit
    );
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
} catch (Throwable $e) {
    $rows = [];
    error_log('[cron_payment_reconcile] list failed: ' . $e->getMessage());
}

$checked = 0;
$cleared = 0;
$failed = 0;
foreach ($rows as $row) {
    if (!is_array($row)) {
        continue;
    }
    $plinkId = trim((string) ($row['razorpay_payment_link_id'] ?? ''));
    if ($plinkId === '') {
        continue;
    }
    $checked++;
    $amountPaid = (int) ($row['amount_paid'] ?? 0);
    $amount = (int) ($row['amount'] ?? 0);
    $status = paymentLinkMapRazorpayStatus(
        (string) ($row['status'] ?? 'created'),
        $amountPaid,
        $amount,
    );
    $item = [
        'id' => $plinkId,
        'status' => $status,
        'amount' => $amount,
        'amount_paid' => $amountPaid,
    ];
    $eventType = $status === 'paid' ? 'payment_link.paid' : 'payment_link.partially_paid';
    try {
        $side = paymentLinkProcessPaymentSideEffects($row, $item, null, $eventType);
        $receiptOk = !is_array($side['receipt'] ?? null) || !empty($side['receipt']['ok']);
        $enrollOk = !is_array($side['enrollment'] ?? null)
            || !empty($side['enrollment']['ok'])
            || !empty($side['enrollment']['skipped']);
        if ($receiptOk && $enrollOk) {
            paymentLinkClearNeedsReconcile($plinkId);
            $cleared++;
        } else {
            paymentLinkMarkNeedsReconcile($plinkId);
            $failed++;
        }
    } catch (Throwable $e) {
        paymentLinkMarkNeedsReconcile($plinkId);
        $failed++;
        error_log('[cron_payment_reconcile] ' . $plinkId . ': ' . $e->getMessage());
    }
}

$out = [
    'ok' => true,
    'checked' => $checked,
    'cleared' => $cleared,
    'still_needed' => $failed,
];
if ($cli) {
    echo json_encode($out) . PHP_EOL;
    exit(0);
}
header('Content-Type: application/json');
echo json_encode($out);
