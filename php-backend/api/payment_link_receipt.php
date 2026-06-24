<?php
/**
 * Payment receipt: invoice PDF storage + customer email after paid / partial payment.
 */
require_once __DIR__ . '/payment_link_store.php';
require_once __DIR__ . '/razorpay_service.php';

function paymentLinkReceiptAutoload(): ?string
{
    $paths = [
        __DIR__ . '/../vendor/autoload.php',
        __DIR__ . '/../../php-backend/vendor/autoload.php',
    ];
    foreach ($paths as $p) {
        if (is_file($p)) {
            return $p;
        }
    }
    return null;
}

function paymentLinkReceiptRenderHtmlToPdf(string $html, string $destAbsPath): bool
{
    $autoload = paymentLinkReceiptAutoload();
    if ($autoload === null) {
        return false;
    }
    require_once $autoload;
    if (!class_exists(\Dompdf\Dompdf::class)) {
        return false;
    }
    try {
        $options = new \Dompdf\Options();
        $options->set('isRemoteEnabled', false);
        $options->set('isHtml5ParserEnabled', true);
        $dompdf = new \Dompdf\Dompdf($options);
        $wrapped = $html;
        if (stripos($html, '<html') === false) {
            $wrapped = '<!DOCTYPE html><html><head><meta charset="UTF-8">'
                . '<style>body{font-family:DejaVu Sans,sans-serif;font-size:12px;color:#1e293b;} table{border-collapse:collapse;width:100%;} td,th{border:1px solid #e2e8f0;padding:8px;}</style>'
                . '</head><body>' . $html . '</body></html>';
        }
        $dompdf->loadHtml($wrapped, 'UTF-8');
        $dompdf->setPaper('A4', 'portrait');
        $dompdf->render();
        $out = $dompdf->output();
        if ($out === false || $out === '') {
            return false;
        }
        return @file_put_contents($destAbsPath, $out) !== false;
    } catch (Throwable $e) {
        error_log('[payment_receipt] dompdf: ' . $e->getMessage());
        return false;
    }
}

function paymentLinkReceiptDownloadUrl(string $url): ?string
{
    $url = trim($url);
    if ($url === '' || !preg_match('#^https?://#i', $url)) {
        return null;
    }
    $ch = curl_init($url);
    if ($ch === false) {
        return null;
    }
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 45);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false || $code >= 400 || strlen($body) < 100) {
        return null;
    }
    return $body;
}

/** @return array<string, mixed>|null */
function razorpayFetchPaymentEntity(string $paymentId): ?array
{
    if ($paymentId === '') {
        return null;
    }
    try {
        $data = razorpayApiRequest('GET', 'payments/' . rawurlencode($paymentId));
        return is_array($data) ? $data : null;
    } catch (Throwable $e) {
        error_log('[payment_receipt] fetch payment: ' . $e->getMessage());
        return null;
    }
}

function paymentLinkReceiptTryRazorpayInvoicePdf(?array $paymentEntity): ?string
{
    if (!is_array($paymentEntity)) {
        return null;
    }
    $invoiceId = trim((string) ($paymentEntity['invoice_id'] ?? ''));
    if ($invoiceId === '') {
        return null;
    }
    try {
        $inv = razorpayApiRequest('GET', 'invoices/' . rawurlencode($invoiceId));
        $url = trim((string) ($inv['short_url'] ?? $inv['pdf_url'] ?? ''));
        if ($url !== '') {
            $pdf = paymentLinkReceiptDownloadUrl($url);
            if ($pdf !== null && strncmp($pdf, '%PDF', 4) === 0) {
                return $pdf;
            }
        }
    } catch (Throwable $e) {
        error_log('[payment_receipt] razorpay invoice: ' . $e->getMessage());
    }
    return null;
}

function paymentLinkReceiptBuildInvoiceHtml(
    array $row,
    array $rzpLink,
    float $amountThisPaymentRupees,
    float $cumulativePaidRupees,
    string $invoiceNumber,
    string $paymentId,
    bool $isPartial,
): string {
    $h = static function (string $s): string {
        return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    };
    $legal = $h(syncpediaMailLegalEntityName());
    $totalRupees = ((int) ($row['amount'] ?? 0)) / 100;
    $balance = max(0, $totalRupees - $cumulativePaidRupees);
    $statusLabel = $isPartial ? 'Partial payment' : 'Paid in full';

    return '<div style="padding:24px;">'
        . '<table width="100%"><tr>'
        . '<td><strong style="font-size:18px;color:#0f2318;">' . $legal . '</strong><br/>'
        . '<span style="font-size:11px;color:#64748b;">Tax Invoice / Payment Receipt</span></td>'
        . '<td align="right"><span style="font-size:14px;font-weight:bold;">INVOICE</span><br/>'
        . '<span style="font-family:monospace;">' . $h($invoiceNumber) . '</span></td>'
        . '</tr></table>'
        . '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;"/>'
        . '<p><strong>Bill to:</strong><br/>' . $h((string) ($row['customer_name'] ?? '')) . '<br/>'
        . $h((string) ($row['customer_email'] ?? '')) . '<br/>'
        . $h((string) ($row['customer_phone'] ?? '')) . '</p>'
        . '<p><strong>Description:</strong> ' . $h((string) ($row['description'] ?? 'Payment')) . '</p>'
        . '<p><strong>Payment link ID:</strong> <span style="font-family:monospace;">' . $h((string) ($row['razorpay_payment_link_id'] ?? '')) . '</span></p>'
        . ($paymentId !== '' ? '<p><strong>Razorpay payment ID:</strong> <span style="font-family:monospace;">' . $h($paymentId) . '</span></p>' : '')
        . '<p><strong>Date:</strong> ' . $h(date('d M Y, h:i A')) . '</p>'
        . '<table style="margin-top:20px;"><tr><th align="left">Item</th><th align="right">Amount (INR)</th></tr>'
        . '<tr><td>' . $h($statusLabel) . '</td><td align="right"><strong>' . $h(number_format($amountThisPaymentRupees, 2)) . '</strong></td></tr>'
        . '<tr><td>Total payment link amount</td><td align="right">' . $h(number_format($totalRupees, 2)) . '</td></tr>'
        . '<tr><td>Paid cumulative</td><td align="right">' . $h(number_format($cumulativePaidRupees, 2)) . '</td></tr>'
        . ($isPartial && $balance > 0.009
            ? '<tr><td>Balance due</td><td align="right">' . $h(number_format($balance, 2)) . '</td></tr>'
            : '')
        . '</table>'
        . '<p style="margin-top:24px;font-size:11px;color:#64748b;">This receipt is issued by Syncpedia for your Razorpay payment. '
        . 'For official GST invoice from Razorpay (if enabled on your account), refer to the attached PDF when available.</p>'
        . '</div>';
}

function paymentLinkReceiptGenerateInvoicePdf(
    array $row,
    array $rzpLink,
    ?array $paymentEntity,
    float $amountThisPaymentRupees,
    float $cumulativePaidRupees,
    string $invoiceNumber,
    string $paymentId,
    bool $isPartial,
): ?string {
    $razorpayPdf = paymentLinkReceiptTryRazorpayInvoicePdf($paymentEntity);
    $filename = 'invoice_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $invoiceNumber) . '.pdf';

    if ($razorpayPdf !== null) {
        $path = syncpediaDocumentStorageSavePdf('payment_invoices', $filename, $razorpayPdf);
        if ($path !== null) {
            return $path;
        }
    }

    $html = paymentLinkReceiptBuildInvoiceHtml(
        $row,
        $rzpLink,
        $amountThisPaymentRupees,
        $cumulativePaidRupees,
        $invoiceNumber,
        $paymentId,
        $isPartial,
    );
    $dir = syncpediaDocumentStorageDir('payment_invoices');
    $abs = $dir . DIRECTORY_SEPARATOR . syncpediaDocumentSafeFilename($filename);
    if (!paymentLinkReceiptRenderHtmlToPdf($html, $abs)) {
        return null;
    }
    return $abs;
}

function paymentLinkReceiptMakeInvoiceNumber(array $row, string $paymentId): string
{
    if ($paymentId !== '') {
        return 'INV-' . strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $paymentId));
    }
    $ref = trim((string) ($row['reference_id'] ?? ''));
    if ($ref !== '') {
        return 'INV-' . preg_replace('/[^A-Za-z0-9-]/', '', $ref);
    }
    $plink = (string) ($row['razorpay_payment_link_id'] ?? 'PL');
    return 'INV-' . strtoupper(substr(str_replace('plink_', '', $plink), 0, 12));
}

/**
 * Send receipt email + store invoice. Returns summary array.
 *
 * @param array<string, mixed> $row DB row
 * @param array<string, mixed> $rzpLink Razorpay payment link entity
 * @param array<string, mixed>|null $paymentEntity Razorpay payment entity from webhook
 */
function paymentLinkDeliverReceipt(
    array $row,
    array $rzpLink,
    ?array $paymentEntity,
    string $eventType,
): array {
    $customerEmail = trim((string) ($row['customer_email'] ?? ''));
    if ($customerEmail === '' || !filter_var($customerEmail, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'No valid customer email'];
    }

    $amountPaidPaise = (int) ($rzpLink['amount_paid'] ?? $row['amount_paid'] ?? 0);
    $previouslySentFor = (int) ($row['invoice_sent_for_amount_paid'] ?? 0);
    if ($amountPaidPaise <= $previouslySentFor) {
        return ['ok' => true, 'skipped' => true, 'reason' => 'already_sent_for_amount'];
    }

    $amountThisPaymentPaise = $amountPaidPaise - $previouslySentFor;
    $totalAmountPaise = (int) ($row['amount'] ?? $rzpLink['amount'] ?? 0);
    $isPartial = $eventType === 'payment_link.partially_paid'
        || ($amountPaidPaise > 0 && $amountPaidPaise < $totalAmountPaise);

    $paymentId = '';
    if (is_array($paymentEntity)) {
        $paymentId = trim((string) ($paymentEntity['id'] ?? ''));
    }
    if ($paymentId === '' && is_array($rzpLink['payments'] ?? null)) {
        $payments = $rzpLink['payments'];
        $last = is_array($payments) ? end($payments) : null;
        if (is_array($last)) {
            $paymentId = trim((string) ($last['payment_id'] ?? $last['id'] ?? ''));
        }
    }
    if ($paymentId !== '' && !is_array($paymentEntity)) {
        $paymentEntity = razorpayFetchPaymentEntity($paymentId);
    }

    $invoiceNumber = paymentLinkReceiptMakeInvoiceNumber($row, $paymentId !== '' ? $paymentId : (string) microtime(true));
    $amountThisRupees = $amountThisPaymentPaise / 100;
    $cumulativeRupees = $amountPaidPaise / 100;
    $totalRupees = $totalAmountPaise / 100;

    $pdfPath = paymentLinkReceiptGenerateInvoicePdf(
        $row,
        $rzpLink,
        $paymentEntity,
        $amountThisRupees,
        $cumulativeRupees,
        $invoiceNumber,
        $paymentId,
        $isPartial,
    );

    $customerName = trim((string) ($row['customer_name'] ?? 'Customer'));
    $description = trim((string) ($row['description'] ?? ''));
    $html = syncpediaBuildPaymentReceiptEmailHtml(
        $customerName,
        $amountThisRupees,
        $totalRupees,
        $cumulativeRupees,
        $invoiceNumber,
        $paymentId,
        $description,
        $isPartial,
    );

    $subject = $isPartial
        ? 'Partial payment received — INR ' . number_format($amountThisRupees, 2) . ' (Invoice attached)'
        : 'Payment received — INR ' . number_format($amountThisRupees, 2) . ' (Invoice attached)';

    $plain = "Dear {$customerName},\n\n"
        . 'We received your payment of INR ' . number_format($amountThisRupees, 2) . ".\n"
        . "Invoice number: {$invoiceNumber}\n";
    if ($paymentId !== '') {
        $plain .= "Payment ID: {$paymentId}\n";
    }
    if ($isPartial) {
        $plain .= 'Paid so far: INR ' . number_format($cumulativeRupees, 2)
            . ' of INR ' . number_format($totalRupees, 2) . "\n";
    }
    $plain .= "\nYour invoice PDF is attached.\n\nRegards,\nSyncpedia";

    $attachments = [];
    if ($pdfPath !== null && is_file($pdfPath)) {
        $attachments[] = [
            'path' => $pdfPath,
            'name' => syncpediaDocumentSafeFilename($invoiceNumber . '.pdf'),
        ];
    }

    $send = syncpediaSendPaymentReceiptEmail(
        $customerEmail,
        $subject,
        $html,
        $plain,
        $attachments,
    );

    if ($send['ok']) {
        paymentLinkMarkInvoiceSent(
            (string) $row['razorpay_payment_link_id'],
            $invoiceNumber,
            $pdfPath ?? '',
            $amountPaidPaise,
        );
        $notes = json_decode((string) ($row['notes'] ?? '{}'), true);
        $salesName = is_array($notes) ? (string) ($notes['salesperson_name'] ?? '') : '';
        syncpediaNotifySupportPaymentLinkCustomerMail(
            true,
            (string) $row['razorpay_payment_link_id'],
            $customerEmail,
            $customerName,
            'INR ' . number_format($amountThisRupees, 2),
            $salesName,
            '',
            null,
        );
    }

    return [
        'ok' => $send['ok'],
        'email' => $customerEmail,
        'invoice_number' => $invoiceNumber,
        'pdf_path' => $pdfPath,
        'amount_paid_paise' => $amountPaidPaise,
        'error' => $send['error'] ?? null,
    ];
}

/**
 * Handle Razorpay webhook payload for payment link paid / partial.
 */
function paymentLinkProcessWebhookEvent(array $event): void
{
    $type = (string) ($event['event'] ?? '');
    $handled = ['payment_link.paid', 'payment_link.partially_paid'];
    if (!in_array($type, $handled, true)) {
        return;
    }

    $payload = is_array($event['payload'] ?? null) ? $event['payload'] : [];
    $plinkWrap = $payload['payment_link'] ?? null;
    $plinkEntity = is_array($plinkWrap) && is_array($plinkWrap['entity'] ?? null)
        ? $plinkWrap['entity']
        : (is_array($plinkWrap) ? $plinkWrap : null);

    if (!is_array($plinkEntity)) {
        error_log('[payment_receipt] webhook missing payment_link entity');
        return;
    }

    $plinkId = trim((string) ($plinkEntity['id'] ?? ''));
    if ($plinkId === '') {
        return;
    }

    $paymentWrap = $payload['payment'] ?? null;
    $paymentEntity = is_array($paymentWrap) && is_array($paymentWrap['entity'] ?? null)
        ? $paymentWrap['entity']
        : null;

    try {
        $fullLink = razorpayFetchPaymentLink($plinkId);
    } catch (Throwable $e) {
        error_log('[payment_receipt] fetch link: ' . $e->getMessage());
        $fullLink = $plinkEntity;
    }

    $row = paymentLinkUpsertFromRazorpay($fullLink, $paymentEntity);
    if (!is_array($row)) {
        error_log('[payment_receipt] could not upsert payment link ' . $plinkId);
        return;
    }

    $result = paymentLinkDeliverReceipt($row, $fullLink, $paymentEntity, $type);
    error_log('[payment_receipt] ' . $plinkId . ' ' . json_encode($result, JSON_UNESCAPED_UNICODE));
}
