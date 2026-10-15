<?php
/**
 * Payment receipt: invoice PDF storage + customer email after paid / partial payment.
 */
require_once __DIR__ . '/payment_link_store.php';
require_once __DIR__ . '/razorpay_service.php';
require_once __DIR__ . '/mail_transport.php';

function paymentLinkReceiptAutoload(): bool
{
    return syncpediaLoadComposerAutoload();
}

function paymentLinkReceiptRenderHtmlToPdf(string $html, string $destAbsPath): bool
{
    if (!paymentLinkReceiptAutoload()) {
        error_log('[payment_receipt] Composer vendor missing — run composer install in php-backend and upload vendor/ to Hostinger');
        return false;
    }
    if (!class_exists(\Dompdf\Dompdf::class)) {
        error_log('[payment_receipt] dompdf not installed');
        return false;
    }
    try {
        $tmpDir = syncpediaDocumentStorageDir('tmp');
        $fontDir = $tmpDir . DIRECTORY_SEPARATOR . 'fonts';
        if (!is_dir($fontDir)) {
            @mkdir($fontDir, 0775, true);
        }
        $options = new \Dompdf\Options();
        // Allow data: URI org logos embedded in the HTML (not arbitrary remote fetch).
        $options->set('isRemoteEnabled', true);
        $options->set('isHtml5ParserEnabled', true);
        $options->set('tempDir', $tmpDir);
        $options->set('fontDir', $fontDir);
        $options->set('fontCache', $tmpDir . DIRECTORY_SEPARATOR . 'font_cache');
        $root = syncpediaDocumentStorageBackendRoot();
        if (is_dir($root) && method_exists($options, 'setChroot')) {
            $options->setChroot($root);
        }
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
        $dir = dirname($destAbsPath);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        return @file_put_contents($destAbsPath, $out) !== false;
    } catch (Throwable $e) {
        error_log('[payment_receipt] dompdf: ' . $e->getMessage());
        return false;
    }
}

/**
 * Resolve organization branding for invoices (name + logo as data URI when possible).
 *
 * @return array{org_name: string, logo_data_uri: string}
 */
function paymentLinkReceiptOrgBranding(?string $orgId): array
{
    $fallbackName = function_exists('syncpediaMailLegalEntityName')
        ? syncpediaMailLegalEntityName()
        : 'Syncpedia';
    $out = ['org_name' => $fallbackName, 'logo_data_uri' => ''];
    $orgId = trim((string) $orgId);
    if ($orgId === '') {
        return $out;
    }
    try {
        $db = paymentLinksDb();
        $st = $db->prepare('SELECT name, logo_url FROM organizations WHERE id = ? LIMIT 1');
        $st->execute([$orgId]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!is_array($row)) {
            return $out;
        }
        $name = trim((string) ($row['name'] ?? ''));
        if ($name !== '') {
            $out['org_name'] = $name;
        }
        $logoUrl = trim((string) ($row['logo_url'] ?? ''));
        if ($logoUrl !== '') {
            $out['logo_data_uri'] = paymentLinkReceiptResolveLogoDataUri($logoUrl);
        }
    } catch (Throwable $e) {
        error_log('[payment_receipt] org branding: ' . $e->getMessage());
    }
    return $out;
}

/** Load org logo from disk as a data URI (safe for Dompdf). */
function paymentLinkReceiptResolveLogoDataUri(string $logo): string
{
    $logo = trim($logo);
    if ($logo === '') {
        return '';
    }
    $path = $logo;
    if (preg_match('#^https?://#i', $logo)) {
        $parts = parse_url($logo);
        $path = is_array($parts) ? (string) ($parts['path'] ?? '') : '';
    }
    $uploadsIdx = strpos($path, '/uploads/');
    if ($uploadsIdx === false) {
        return '';
    }
    $rawPath = substr($path, $uploadsIdx);
    if (strpos($rawPath, '..') !== false || !str_starts_with($rawPath, '/uploads/org_logos/')) {
        return '';
    }

    $relUploads = str_replace('/', DIRECTORY_SEPARATOR, $rawPath);
    $siteRoot = dirname(__DIR__); // php-backend/api → php-backend, or public/api → public
    $apiDir = __DIR__;
    $candidates = [
        $siteRoot . $relUploads,
        $siteRoot . DIRECTORY_SEPARATOR . 'public' . $relUploads,
        dirname($siteRoot) . DIRECTORY_SEPARATOR . 'public' . $relUploads,
        $apiDir . DIRECTORY_SEPARATOR . 'uploads' . str_replace('/', DIRECTORY_SEPARATOR, substr($rawPath, strlen('/uploads'))),
        syncpediaDocumentStorageBackendRoot() . $relUploads,
    ];
    $abs = null;
    foreach ($candidates as $candidate) {
        $resolved = @realpath($candidate);
        if ($resolved !== false && is_file($resolved)) {
            $norm = str_replace('\\', '/', $resolved);
            if (strpos($norm, '/uploads/org_logos/') !== false) {
                $abs = $resolved;
                break;
            }
        }
    }
    if ($abs === null) {
        return '';
    }
    $bin = @file_get_contents($abs);
    if ($bin === false || $bin === '' || strlen($bin) > 500 * 1024) {
        return '';
    }
    $mime = 'image/png';
    if (function_exists('mime_content_type')) {
        $detected = @mime_content_type($abs);
        if (is_string($detected) && str_starts_with($detected, 'image/')) {
            $mime = $detected;
        }
    } else {
        $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));
        $byExt = [
            'jpg' => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'webp' => 'image/webp',
            'gif' => 'image/gif',
        ];
        if (isset($byExt[$ext])) {
            $mime = $byExt[$ext];
        }
    }
    // Dompdf often struggles with SVG — skip and show org name only.
    if ($mime === 'image/svg+xml') {
        return '';
    }
    return 'data:' . $mime . ';base64,' . base64_encode($bin);
}

function paymentLinkReceiptPdfEscape(string $text): string
{
    $text = preg_replace('/[^\x20-\x7E]/', '?', $text) ?? $text;
    return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $text);
}

/** Pure-PHP A4 invoice PDF when Dompdf is unavailable (text + org name; no HTML). */
function paymentLinkReceiptBuildSimpleInvoicePdf(
    string $orgName,
    string $invoiceNumber,
    string $customerName,
    string $customerEmail,
    string $customerPhone,
    string $description,
    string $plinkId,
    string $paymentId,
    float $amountThisPaymentRupees,
    float $totalRupees,
    float $cumulativePaidRupees,
    bool $isPartial,
): string {
    $statusLabel = $isPartial ? 'Partial payment' : 'Paid in full';
    $balance = max(0, $totalRupees - $cumulativePaidRupees);
    $lines = [
        ['TAX INVOICE / PAYMENT RECEIPT', 14, 48, true],
        [$orgName !== '' ? $orgName : 'Syncpedia', 16, 78, true],
        ['INVOICE  ' . $invoiceNumber, 12, 110, true],
        ['Date: ' . date('d M Y, h:i A'), 10, 132, false],
        ['Bill to:', 11, 165, false],
        [$customerName !== '' ? $customerName : 'Customer', 12, 182, false],
        [$customerEmail, 10, 198, false],
        [$customerPhone, 10, 212, false],
        ['Description: ' . ($description !== '' ? $description : 'Payment'), 10, 240, false],
        ['Payment link: ' . $plinkId, 9, 258, false],
    ];
    if ($paymentId !== '') {
        $lines[] = ['Razorpay payment: ' . $paymentId, 9, 274, false];
    }
    $y = 310;
    $lines[] = ['Item                                              Amount (INR)', 10, $y, false];
    $y += 18;
    $lines[] = [$statusLabel . '                               ' . number_format($amountThisPaymentRupees, 2), 11, $y, false];
    $y += 16;
    $lines[] = ['Total payment link amount                  ' . number_format($totalRupees, 2), 10, $y, false];
    $y += 16;
    $lines[] = ['Paid cumulative                            ' . number_format($cumulativePaidRupees, 2), 10, $y, false];
    if ($isPartial && $balance > 0.009) {
        $y += 16;
        $lines[] = ['Balance due                                ' . number_format($balance, 2), 10, $y, false];
    }
    $y += 36;
    $lines[] = ['This receipt is issued for your Razorpay payment via Syncpedia CRM.', 9, $y, false];

    $w = 595;
    $h = 842;
    $content = "0.11 0.62 0.46 RG\n2 w\n36 36 " . ($w - 72) . " " . ($h - 72) . " re S\n";
    $content .= "0.05 0.08 0.12 rg\n";
    foreach ($lines as $row) {
        $text = trim((string) ($row[0] ?? ''));
        $size = (float) ($row[1] ?? 12);
        $yFromTop = (float) ($row[2] ?? 72);
        $center = !empty($row[3]);
        if ($text === '') {
            continue;
        }
        if (strlen($text) > 95) {
            $text = substr($text, 0, 92) . '...';
        }
        $yPdf = $h - $yFromTop;
        $esc = paymentLinkReceiptPdfEscape($text);
        $approxWidth = strlen($text) * $size * 0.5;
        $x = $center ? max(48, ($w - $approxWidth) / 2) : 56;
        $content .= "BT /F1 {$size} Tf {$x} {$yPdf} Td ({$esc}) Tj ET\n";
    }
    $len = strlen($content);
    $objects = [
        "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
        "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
        "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {$w} {$h}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
        "4 0 obj<< /Length {$len} >>stream\n{$content}endstream endobj\n",
        "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
    ];
    $pdf = "%PDF-1.4\n";
    $offsets = [0];
    foreach ($objects as $obj) {
        $offsets[] = strlen($pdf);
        $pdf .= $obj;
    }
    $xrefPos = strlen($pdf);
    $count = count($objects) + 1;
    $pdf .= "xref\n0 {$count}\n0000000000 65535 f \n";
    for ($i = 1; $i < $count; $i++) {
        $pdf .= sprintf("%010d 00000 n \n", $offsets[$i]);
    }
    $pdf .= "trailer<< /Size {$count} /Root 1 0 R >>\nstartxref\n{$xrefPos}\n%%EOF";
    return $pdf;
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
    $branding = paymentLinkReceiptOrgBranding(isset($row['org_id']) ? (string) $row['org_id'] : null);
    $orgName = $h($branding['org_name']);
    $logoUri = trim((string) ($branding['logo_data_uri'] ?? ''));
    $logoBlock = $logoUri !== ''
        ? '<img src="' . $h($logoUri) . '" alt="' . $orgName . '" style="max-height:56px;max-width:180px;object-fit:contain;margin-bottom:6px;display:block;"/>'
        : '';
    $totalRupees = ((int) ($row['amount'] ?? 0)) / 100;
    $balance = max(0, $totalRupees - $cumulativePaidRupees);
    $statusLabel = $isPartial ? 'Partial payment' : 'Paid in full';

    return '<div style="padding:24px;">'
        . '<table width="100%" style="border:none;"><tr>'
        . '<td style="border:none;vertical-align:top;">'
        . $logoBlock
        . '<strong style="font-size:18px;color:#0f2318;">' . $orgName . '</strong><br/>'
        . '<span style="font-size:11px;color:#64748b;">Tax Invoice / Payment Receipt</span></td>'
        . '<td style="border:none;vertical-align:top;" align="right"><span style="font-size:14px;font-weight:bold;">INVOICE</span><br/>'
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
        . '<p style="margin-top:24px;font-size:11px;color:#64748b;">This receipt is issued by ' . $orgName
        . ' for your Razorpay payment via Syncpedia CRM.</p>'
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
    if (paymentLinkReceiptRenderHtmlToPdf($html, $abs)) {
        return syncpediaDocumentStorageRelativePath($abs);
    }

    // Never fall back to HTML downloads — emit a simple PDF instead.
    error_log('[payment_receipt] dompdf unavailable — using simple PDF fallback for ' . $filename);
    $branding = paymentLinkReceiptOrgBranding(isset($row['org_id']) ? (string) $row['org_id'] : null);
    $totalRupees = ((int) ($row['amount'] ?? 0)) / 100;
    $simplePdf = paymentLinkReceiptBuildSimpleInvoicePdf(
        (string) ($branding['org_name'] ?? 'Syncpedia'),
        $invoiceNumber,
        trim((string) ($row['customer_name'] ?? '')),
        trim((string) ($row['customer_email'] ?? '')),
        trim((string) ($row['customer_phone'] ?? '')),
        trim((string) ($row['description'] ?? 'Payment')),
        trim((string) ($row['razorpay_payment_link_id'] ?? '')),
        $paymentId,
        $amountThisPaymentRupees,
        $totalRupees,
        $cumulativePaidRupees,
        $isPartial,
    );
    return syncpediaDocumentStorageSavePdf('payment_invoices', $filename, $simplePdf);
}

/** Safe filename segment from candidate / customer name. */
function paymentLinkReceiptSafeCandidateSlug(string $name): string
{
    $name = trim($name);
    if ($name === '') {
        return 'candidate';
    }
    $name = preg_replace('/\s+/', '_', $name) ?? $name;
    $name = preg_replace('/[^A-Za-z0-9_-]/', '', $name) ?? '';
    $name = trim($name, '_-');
    if ($name === '') {
        return 'candidate';
    }
    return substr($name, 0, 60);
}

/** Download filename: Invoice-{CandidateName}-{InvoiceNo}.pdf */
function paymentLinkReceiptDownloadFilename(array $row): string
{
    $candidate = paymentLinkReceiptSafeCandidateSlug((string) ($row['customer_name'] ?? ''));
    $inv = trim((string) ($row['invoice_number'] ?? ''));
    if ($inv === '') {
        $inv = 'invoice';
    }
    $inv = preg_replace('/[^A-Za-z0-9_-]/', '_', $inv) ?? 'invoice';
    return 'Invoice-' . $candidate . '-' . $inv . '.pdf';
}

/**
 * Rebuild invoice PDF with latest template (org logo + branding).
 * Used for new receipts and to upgrade existing/legacy invoices on download.
 *
 * @return array{path: string, ok: bool, filename: string}
 */
function paymentLinkReceiptRegenerateLatestPdf(array $row): array
{
    $invoiceNumber = trim((string) ($row['invoice_number'] ?? ''));
    if ($invoiceNumber === '') {
        $invoiceNumber = paymentLinkReceiptMakeInvoiceNumber($row, '');
    }
    $amountPaidPaise = (int) ($row['amount_paid'] ?? 0);
    $totalPaise = (int) ($row['amount'] ?? 0);
    $amountPaid = $amountPaidPaise / 100;
    $total = $totalPaise / 100;
    if ($amountPaid <= 0 && $total > 0) {
        // Link marked paid in Razorpay but amount_paid not synced — use full amount.
        $status = strtolower(trim((string) ($row['status'] ?? '')));
        if (in_array($status, ['paid', 'partially_paid'], true)) {
            $amountPaid = $total;
        }
    }
    $isPartial = $amountPaid > 0 && $amountPaid + 0.009 < $total;
    $amountThis = $amountPaid > 0 ? $amountPaid : $total;

    $html = paymentLinkReceiptBuildInvoiceHtml(
        $row,
        [],
        $amountThis,
        $amountPaid > 0 ? $amountPaid : $amountThis,
        $invoiceNumber,
        '',
        $isPartial,
    );

    $filename = 'invoice_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $invoiceNumber) . '.pdf';
    $dir = syncpediaDocumentStorageDir('payment_invoices');
    $abs = $dir . DIRECTORY_SEPARATOR . syncpediaDocumentSafeFilename($filename);
    $newPath = null;
    if (paymentLinkReceiptRenderHtmlToPdf($html, $abs)) {
        $newPath = syncpediaDocumentStorageRelativePath($abs);
    } else {
        $branding = paymentLinkReceiptOrgBranding(isset($row['org_id']) ? (string) $row['org_id'] : null);
        $simplePdf = paymentLinkReceiptBuildSimpleInvoicePdf(
            (string) ($branding['org_name'] ?? 'Syncpedia'),
            $invoiceNumber,
            trim((string) ($row['customer_name'] ?? '')),
            trim((string) ($row['customer_email'] ?? '')),
            trim((string) ($row['customer_phone'] ?? '')),
            trim((string) ($row['description'] ?? 'Payment')),
            trim((string) ($row['razorpay_payment_link_id'] ?? '')),
            '',
            $amountThis,
            $total,
            $amountPaid > 0 ? $amountPaid : $amountThis,
            $isPartial,
        );
        $newPath = syncpediaDocumentStorageSavePdf('payment_invoices', $filename, $simplePdf);
    }

    $downloadName = paymentLinkReceiptDownloadFilename(array_merge($row, [
        'invoice_number' => $invoiceNumber,
    ]));

    if ($newPath === null || $newPath === '') {
        $stored = trim((string) ($row['invoice_pdf_path'] ?? ''));
        return ['path' => $stored, 'ok' => false, 'filename' => $downloadName];
    }

    try {
        $plinkId = trim((string) ($row['razorpay_payment_link_id'] ?? ''));
        if ($plinkId !== '') {
            paymentLinksDb()->prepare(
                'UPDATE payment_links SET invoice_pdf_path = ?, invoice_number = COALESCE(NULLIF(invoice_number, ""), ?), updated_at = CURRENT_TIMESTAMP
                 WHERE razorpay_payment_link_id = ?'
            )->execute([$newPath, $invoiceNumber, $plinkId]);
        }
    } catch (Throwable $e) {
        try {
            $plinkId = trim((string) ($row['razorpay_payment_link_id'] ?? ''));
            if ($plinkId !== '') {
                paymentLinksDb()->prepare(
                    'UPDATE payment_links SET invoice_pdf_path = ?, updated_at = CURRENT_TIMESTAMP WHERE razorpay_payment_link_id = ?'
                )->execute([$newPath, $plinkId]);
            }
        } catch (Throwable $e2) {
            error_log('[payment_receipt] update pdf path after regenerate: ' . $e2->getMessage());
        }
    }

    return ['path' => $newPath, 'ok' => true, 'filename' => $downloadName];
}

/**
 * Ensure a stored invoice path is a PDF (legacy HTML → latest template).
 *
 * @return array{path: string, ok: bool, filename?: string}
 */
function paymentLinkReceiptEnsurePdfPath(array $row): array
{
    // Always rebuild with latest branding/logo so old invoices match current design.
    return paymentLinkReceiptRegenerateLatestPdf($row);
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
 * Atomically claim receipt sending (CAS on invoice_sent_for_amount_paid) so
 * concurrent webhook retries / list polls cannot double-send the same receipt.
 *
 * @param list<string> $previousProcessed
 */
function paymentLinkClaimReceiptSend(
    string $plinkId,
    int $previousSentFor,
    int $newSentFor,
    array $previousProcessed,
    string $paymentId,
): bool {
    $db = paymentLinksDb();
    $processed = $previousProcessed;
    if ($paymentId !== '' && !in_array($paymentId, $processed, true)) {
        $processed[] = $paymentId;
    }
    if (count($processed) > 100) {
        $processed = array_slice($processed, -100);
    }
    $st = $db->prepare(
        'UPDATE payment_links SET
            invoice_sent_for_amount_paid = ?,
            processed_payment_ids = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE razorpay_payment_link_id = ?
           AND COALESCE(invoice_sent_for_amount_paid, 0) = ?',
    );
    $st->execute([
        $newSentFor,
        json_encode(array_values($processed)) ?: '[]',
        $plinkId,
        $previousSentFor,
    ]);
    return $st->rowCount() > 0;
}

/**
 * Undo a receipt claim after a failed email send so a later pass retries.
 *
 * @param list<string> $previousProcessed
 */
function paymentLinkReleaseReceiptClaim(
    string $plinkId,
    int $previousSentFor,
    int $claimedSentFor,
    array $previousProcessed,
): void {
    try {
        $db = paymentLinksDb();
        $st = $db->prepare(
            'UPDATE payment_links SET
                invoice_sent_for_amount_paid = ?,
                processed_payment_ids = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE razorpay_payment_link_id = ?
               AND COALESCE(invoice_sent_for_amount_paid, 0) = ?',
        );
        $st->execute([
            $previousSentFor > 0 ? $previousSentFor : null,
            json_encode(array_values($previousProcessed)) ?: '[]',
            $plinkId,
            $claimedSentFor,
        ]);
    } catch (Throwable $e) {
        error_log('[payment_receipt] release claim failed for ' . $plinkId . ': ' . $e->getMessage());
        paymentLinkMarkNeedsReconcile($plinkId);
    }
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
        // Do not fail the webhook forever — mark for reconcile when email is fixed.
        paymentLinkMarkNeedsReconcile(trim((string) ($row['razorpay_payment_link_id'] ?? '')));
        return ['ok' => true, 'skipped' => true, 'reason' => 'no_customer_email'];
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

    // Idempotent by Razorpay payment_id when present.
    $processed = [];
    if (!empty($row['processed_payment_ids'])) {
        $decoded = json_decode((string) $row['processed_payment_ids'], true);
        if (is_array($decoded)) {
            $processed = $decoded;
        }
    }
    if ($paymentId !== '' && in_array($paymentId, $processed, true)) {
        return ['ok' => true, 'skipped' => true, 'reason' => 'payment_id_already_processed'];
    }

    $plinkId = (string) $row['razorpay_payment_link_id'];
    $claimed = paymentLinkClaimReceiptSend(
        $plinkId,
        $previouslySentFor,
        $amountPaidPaise,
        $processed,
        $paymentId,
    );
    if (!$claimed) {
        return ['ok' => true, 'skipped' => true, 'reason' => 'claimed_by_other_process'];
    }

    $invoiceNumber = paymentLinkReceiptMakeInvoiceNumber($row, $paymentId !== '' ? $paymentId : (string) microtime(true));
    $amountThisRupees = $amountThisPaymentPaise / 100;
    $cumulativeRupees = $amountPaidPaise / 100;
    $totalRupees = $totalAmountPaise / 100;

    try {
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
        if ($pdfPath !== null) {
            $resolvedAttach = syncpediaDocumentStorageResolvePath($pdfPath);
            if ($resolvedAttach !== null && is_file($resolvedAttach)) {
                $isHtml = preg_match('/\.html?$/i', $resolvedAttach) === 1;
                $attachments[] = [
                    'path' => $resolvedAttach,
                    'name' => syncpediaDocumentSafeFilename(
                        $invoiceNumber . ($isHtml ? '.html' : '.pdf'),
                    ),
                ];
            }
        }

        $receiptOrgId = trim((string) ($row['org_id'] ?? ''));
        syncpediaSetMailContext($receiptOrgId !== '' ? $receiptOrgId : null, 'payment_receipts');
        $send = syncpediaSendPaymentReceiptEmail(
            $customerEmail,
            $subject,
            $html,
            $plain,
            $attachments,
        );
    } catch (Throwable $e) {
        paymentLinkReleaseReceiptClaim($plinkId, $previouslySentFor, $amountPaidPaise, $processed);
        throw $e;
    }

    if ($send['ok']) {
        $storedPath = is_string($pdfPath) ? trim($pdfPath) : '';
        if ($storedPath !== '' && !syncpediaDocumentStorageFileExists($storedPath)) {
            error_log('[payment_receipt] invoice saved path missing on disk: ' . $storedPath);
            $storedPath = '';
        }
        paymentLinkMarkInvoiceSent(
            (string) $row['razorpay_payment_link_id'],
            $invoiceNumber,
            $storedPath,
            $amountPaidPaise,
            $paymentId,
        );
        paymentLinkClearNeedsReconcile($plinkId);
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
    } else {
        paymentLinkReleaseReceiptClaim($plinkId, $previouslySentFor, $amountPaidPaise, $processed);
        paymentLinkMarkNeedsReconcile($plinkId);
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
 *
 * @return array<string, mixed> Side-effect result (receipt/enrollment) for the caller to inspect.
 */
function paymentLinkProcessWebhookEvent(array $event): array
{
    $type = (string) ($event['event'] ?? '');
    $handled = [
        'payment_link.paid',
        'payment_link.partially_paid',
        'payment_link.cancelled',
        'payment_link.expired',
    ];
    if (!in_array($type, $handled, true)) {
        return [];
    }

    $payload = is_array($event['payload'] ?? null) ? $event['payload'] : [];
    $plinkWrap = $payload['payment_link'] ?? null;
    $plinkEntity = is_array($plinkWrap) && is_array($plinkWrap['entity'] ?? null)
        ? $plinkWrap['entity']
        : (is_array($plinkWrap) ? $plinkWrap : null);

    if (!is_array($plinkEntity)) {
        error_log('[payment_receipt] webhook missing payment_link entity');
        return [];
    }

    $plinkId = trim((string) ($plinkEntity['id'] ?? ''));
    if ($plinkId === '') {
        return [];
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
        // Money-bearing webhooks must not ACK success without durable persistence —
        // returning [] previously made the handler send HTTP 200 and Razorpay stopped retrying.
        throw new RuntimeException('Failed to persist payment link ' . $plinkId);
    }

    if (in_array($type, ['payment_link.cancelled', 'payment_link.expired'], true)) {
        error_log('[payment_receipt] ' . $plinkId . ' status=' . ($fullLink['status'] ?? $type));
        return [];
    }

    if (!function_exists('paymentLinkProcessPaymentSideEffects')) {
        require_once __DIR__ . '/payment_link_fulfillment.php';
    }
    $result = paymentLinkProcessPaymentSideEffects($row, $fullLink, $paymentEntity, $type);
    error_log('[payment_receipt] ' . $plinkId . ' ' . json_encode($result, JSON_UNESCAPED_UNICODE));
    return $result;
}
