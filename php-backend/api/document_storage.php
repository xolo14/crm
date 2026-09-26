<?php
/**
 * On-disk PDF storage under {site-root}/storage/{subdir}/ (Hostinger: public_html/storage/).
 * DB stores relative paths like storage/payment_invoices/invoice_xxx.pdf
 * Optional GCS upload via gcs_storage.php when GCS_ENABLED is true.
 */
require_once __DIR__ . '/helpers.php';
if (is_file(__DIR__ . '/gcs_storage.php')) {
    require_once __DIR__ . '/gcs_storage.php';
}

function syncpediaDocumentStorageBackendRoot(): string
{
    $dir = realpath(__DIR__ . '/..');
    if (!is_string($dir) || $dir === '') {
        $dir = dirname(__DIR__);
    }
    return rtrim($dir, '/\\');
}

/** @param 'certificates'|'payslips'|'payment_invoices'|'offer_letters'|'tmp' $subdir */
function syncpediaDocumentStorageDir(string $subdir): string
{
    $safe = preg_replace('/[^a-z0-9_]/', '', strtolower($subdir));
    if ($safe === '') {
        $safe = 'misc';
    }
    $target = syncpediaDocumentStorageBackendRoot()
        . DIRECTORY_SEPARATOR . 'storage'
        . DIRECTORY_SEPARATOR . $safe;
    if (!is_dir($target)) {
        @mkdir($target, 0775, true);
    }
    return $target;
}

function syncpediaDocumentSafeFilename(string $name): string
{
    $base = preg_replace('/[^A-Za-z0-9._-]/', '_', $name);
    $base = trim((string) $base, '._-');
    if ($base === '') {
        $base = 'document';
    }
    if (!preg_match('/\.pdf$/i', $base)) {
        $base .= '.pdf';
    }
    return $base;
}

/**
 * Convert absolute path under site root to portable relative path for MySQL.
 */
function syncpediaDocumentStorageRelativePath(string $absPath): string
{
    $abs = str_replace('\\', '/', $absPath);
    $root = str_replace('\\', '/', syncpediaDocumentStorageBackendRoot());
    if (str_starts_with($abs, $root)) {
        return ltrim(substr($abs, strlen($root)), '/');
    }
    if (!preg_match('#^[A-Za-z]:/#', $abs) && !str_starts_with($abs, '/')) {
        return ltrim($abs, '/');
    }
    $name = basename($abs);
    $parent = basename(dirname($abs));
    if ($parent !== '' && $parent !== '.') {
        return 'storage/' . $parent . '/' . $name;
    }
    return 'storage/' . $name;
}

/**
 * Resolve DB path (relative or legacy absolute) to readable file path.
 * Only allows files under site storage/ (blocks path traversal / absolute escapes).
 */
function syncpediaDocumentStorageResolvePath(?string $stored): ?string
{
    if ($stored === null) {
        return null;
    }
    $stored = trim($stored);
    if ($stored === '') {
        return null;
    }
    if (str_contains($stored, "\0") || str_contains($stored, '..')) {
        return null;
    }

    $root = syncpediaDocumentStorageBackendRoot();
    $storageRoot = realpath($root . DIRECTORY_SEPARATOR . 'storage');
    if ($storageRoot === false || !is_dir($storageRoot)) {
        return null;
    }
    $storageRootNorm = rtrim(str_replace('\\', '/', $storageRoot), '/');

    $normalized = str_replace('\\', '/', $stored);
    $candidates = [];

    // Relative: storage/offer_letters/x.pdf
    if (!preg_match('#^[A-Za-z]:/#', $normalized) && !str_starts_with($normalized, '/')) {
        $candidates[] = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, ltrim($normalized, '/'));
    } else {
        // Legacy absolute — only accept if it resolves under storage/
        $candidates[] = $stored;
    }

    // Basename fallback under known subdirs when only a filename was stored
    $base = basename($normalized);
    if ($base !== '' && $base !== '.' && $base !== '..') {
        foreach (['offer_letters', 'certificates', 'payslips', 'payment_invoices', 'tmp'] as $subdir) {
            $candidates[] = $storageRoot . DIRECTORY_SEPARATOR . $subdir . DIRECTORY_SEPARATOR . $base;
        }
    }

    foreach ($candidates as $candidate) {
        $resolved = realpath($candidate);
        if ($resolved === false || !is_file($resolved)) {
            continue;
        }
        $resolvedNorm = str_replace('\\', '/', $resolved);
        if (!str_starts_with($resolvedNorm, $storageRootNorm . '/') && $resolvedNorm !== $storageRootNorm) {
            continue;
        }
        return $resolved;
    }

    return null;
}

/**
 * Decode client pdf_base64 (optional data-URL) with size + magic-byte checks.
 * @return array{ok:bool,bytes?:string,error?:string}
 */
function syncpediaDecodePdfBase64(string $raw, int $maxBytes = 12582912): array
{
    $raw = trim($raw);
    if ($raw === '') {
        return ['ok' => false, 'error' => 'Empty pdf_base64'];
    }
    // ~4/3 expansion; reject oversized payloads before decode
    if (strlen($raw) > (int) ($maxBytes * 1.4) + 128) {
        return ['ok' => false, 'error' => 'pdf_base64 too large'];
    }
    if (str_starts_with($raw, 'data:')) {
        $comma = strpos($raw, ',');
        if ($comma === false) {
            return ['ok' => false, 'error' => 'Invalid pdf_base64 data URL'];
        }
        $raw = substr($raw, $comma + 1);
    }
    $bin = base64_decode($raw, true);
    if ($bin === false || strlen($bin) < 100) {
        return ['ok' => false, 'error' => 'Invalid pdf_base64'];
    }
    if (strlen($bin) > $maxBytes) {
        return ['ok' => false, 'error' => 'PDF exceeds size limit'];
    }
    if (strncmp($bin, '%PDF', 4) !== 0) {
        return ['ok' => false, 'error' => 'pdf_base64 is not a PDF'];
    }
    return ['ok' => true, 'bytes' => $bin];
}

/** @return array{ok: bool, path: string, writable: bool, message: string} */
function syncpediaDocumentStorageHealth(string $subdir = 'payment_invoices'): array
{
    $dir = syncpediaDocumentStorageDir($subdir);
    $writable = is_dir($dir) && is_writable($dir);
    $probe = $dir . DIRECTORY_SEPARATOR . '.write_probe_' . getmypid();
    if ($writable) {
        $writable = @file_put_contents($probe, 'ok') !== false;
        if ($writable) {
            @unlink($probe);
        }
    }
    return [
        'ok' => $writable,
        'path' => str_replace('\\', '/', $dir),
        'writable' => $writable,
        'message' => $writable
            ? 'Storage directory is writable'
            : 'Storage directory is not writable — chmod 775 storage/' . $subdir . ' on Hostinger',
    ];
}

/**
 * Write PDF bytes under storage/{subdir}/. Returns relative path for DB or null.
 */
function syncpediaDocumentStorageSavePdf(string $subdir, string $filename, string $pdfBinary): ?string
{
    if ($pdfBinary === '') {
        return null;
    }

    $health = syncpediaDocumentStorageHealth($subdir);
    if (!$health['writable']) {
        error_log('[document_storage] not writable: ' . $health['path']);
        return null;
    }

    $dir = syncpediaDocumentStorageDir($subdir);
    $abs = $dir . DIRECTORY_SEPARATOR . syncpediaDocumentSafeFilename($filename);
    $written = @file_put_contents($abs, $pdfBinary);
    if ($written === false) {
        error_log('[document_storage] failed to write PDF: ' . $abs);
        return null;
    }

    @chmod($abs, 0644);
    return syncpediaDocumentStorageRelativePath($abs);
}

/**
 * Write local PDF (for SMTP attach) and optionally upload to GCS.
 *
 * @return array{ok: bool, local_path?: string, local_abs?: string, gcs_object?: string|null, error?: string}
 */
function syncpediaDocumentStorageSaveAndUpload(
    string $subdir,
    string $filename,
    string $pdfBinary,
    string $gcsObjectKey = '',
): array {
    if ($pdfBinary === '') {
        return ['ok' => false, 'error' => 'Empty PDF bytes'];
    }

    $rel = syncpediaDocumentStorageSavePdf($subdir, $filename, $pdfBinary);
    if ($rel === null) {
        return ['ok' => false, 'error' => 'Could not write local PDF'];
    }
    $abs = syncpediaDocumentStorageResolvePath($rel);
    $out = [
        'ok' => true,
        'local_path' => $rel,
        'local_abs' => is_string($abs) ? $abs : null,
        'gcs_object' => null,
        'gcs_uploaded' => false,
        'gcs_error' => null,
    ];

    $gcsOn = function_exists('syncpediaGcsEnabled') && syncpediaGcsEnabled();
    if (!$gcsOn) {
        $out['gcs_error'] = 'GCS_ENABLED is false in api/config.php';
        return $out;
    }
    if ($gcsObjectKey === '') {
        $out['gcs_error'] = 'Empty GCS object key';
        return $out;
    }
    if (!function_exists('syncpediaGcsUploadObject')) {
        $out['gcs_error'] = 'gcs_storage.php not loaded';
        return $out;
    }

    $up = syncpediaGcsUploadObject($gcsObjectKey, $pdfBinary);
    if (!empty($up['ok']) && !empty($up['object'])) {
        $out['gcs_object'] = (string) $up['object'];
        $out['gcs_uploaded'] = true;
    } else {
        $err = (string) ($up['error'] ?? 'unknown');
        $out['gcs_error'] = $err;
        error_log('[document_storage] GCS upload failed: ' . $err);
    }

    return $out;
}

/**
 * Delete a local PDF after successful GCS upload + email (frees Hostinger disk).
 */
function syncpediaDocumentStorageDeleteLocal(?string $storedPath): void
{
    $abs = syncpediaDocumentStorageResolvePath($storedPath);
    if (is_string($abs) && is_file($abs)) {
        @unlink($abs);
    }
}

/**
 * Remove a stored PDF from disk and, when present, from GCS.
 */
function syncpediaDocumentStorageDeleteLocalAndGcs(?string $storedPath, ?string $gcsObject): void
{
    $object = ltrim(str_replace('\\', '/', trim((string) $gcsObject)), '/');
    if ($object !== '' && function_exists('syncpediaGcsDeleteObject')) {
        $gcsOn = !function_exists('syncpediaGcsEnabled') || syncpediaGcsEnabled();
        if ($gcsOn) {
            $del = syncpediaGcsDeleteObject($object);
            if (empty($del['ok'])) {
                error_log('[document_storage] GCS delete failed: ' . ($del['error'] ?? 'unknown'));
            }
        }
    }
    $path = trim((string) $storedPath);
    if ($path !== '') {
        syncpediaDocumentStorageDeleteLocal($path);
    }
}

/** Extract issued certificate id from a stored pdf_url (certificates.php?certificate_id=). */
function syncpediaCertificateIdFromPdfUrl(?string $pdfUrl): string
{
    $url = trim((string) $pdfUrl);
    if ($url === '' || stripos($url, 'certificates.php') === false) {
        return '';
    }
    if (preg_match('/[?&]certificate_id=([^&#]+)/i', $url, $m)) {
        return trim(rawurldecode((string) $m[1]));
    }
    return '';
}

/**
 * Delete local + GCS PDFs and related rows for an issued certificate id (sync_id).
 */
function syncpediaPurgeIssuedCertificate(PDO $db, array $tokenData, string $certificateId): bool
{
    $certificateId = trim($certificateId);
    if ($certificateId === '') {
        return false;
    }
    if (function_exists('syncpediaDocumentEnsureColumn')) {
        syncpediaDocumentEnsureColumn($db, 'certificate_issue_artifacts', 'pdf_path', 'TEXT DEFAULT NULL');
        syncpediaDocumentEnsureColumn($db, 'certificate_issue_artifacts', 'gcs_object', 'TEXT DEFAULT NULL');
    }

    $found = false;
    $org = orgFilter($tokenData, '');
    $artParams = array_merge([$certificateId], $org['params']);
    try {
        $st = $db->prepare("SELECT id, pdf_path, gcs_object, sync_id FROM certificate_issue_artifacts WHERE sync_id = ? AND {$org['where']}");
        $st->execute($artParams);
        $arts = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
        foreach ($arts as $row) {
            $found = true;
            if (function_exists('syncpediaDocumentStorageDeleteLocalAndGcs')) {
                syncpediaDocumentStorageDeleteLocalAndGcs(
                    isset($row['pdf_path']) ? (string) $row['pdf_path'] : null,
                    isset($row['gcs_object']) ? (string) $row['gcs_object'] : null,
                );
            }
            $safe = preg_replace('/[^A-Za-z0-9._-]/', '_', (string) ($row['sync_id'] ?? $certificateId));
            if ($safe !== '' && function_exists('syncpediaDocumentStorageDeleteLocal')) {
                syncpediaDocumentStorageDeleteLocal('storage/certificates/' . $safe . '.pdf');
            }
        }
        if ($arts) {
            $db->prepare("DELETE FROM certificate_issue_artifacts WHERE sync_id = ? AND {$org['where']}")->execute($artParams);
        }
    } catch (Throwable $e) {
        error_log('[purgeIssuedCertificate] artifacts: ' . $e->getMessage());
    }

    try {
        $ic = $db->prepare("SELECT id FROM issued_certificates WHERE id = ? AND {$org['where']} LIMIT 1");
        $ic->execute($artParams);
        if ($ic->fetch(PDO::FETCH_ASSOC)) {
            $found = true;
            $db->prepare("DELETE FROM issued_certificates WHERE id = ? AND {$org['where']}")->execute($artParams);
        }
    } catch (Throwable $e) {
        error_log('[purgeIssuedCertificate] issued_certificates: ' . $e->getMessage());
    }

    try {
        $db->prepare('DELETE FROM certificate_email_logs WHERE certificate_id = ?')->execute([$certificateId]);
    } catch (Throwable $e) {
        /* ignore */
    }

    try {
        $likeA = '%certificates.php%certificate_id=' . $certificateId . '%';
        $likeB = '%certificates.php%certificate_id=' . rawurlencode($certificateId) . '%';
        $sql = 'DELETE FROM doc_issued_documents WHERE (pdf_url LIKE ? OR pdf_url LIKE ?) AND ' . $org['where'];
        $db->prepare($sql)->execute(array_merge([$likeA, $likeB], $org['params']));
    } catch (Throwable $e) {
        error_log('[purgeIssuedCertificate] doc_issued cascade: ' . $e->getMessage());
    }

    return $found;
}

/** Extract offer_letters_sent id from a stored pdf_url, if the URL points at this API. */
function syncpediaOfferLetterSentIdFromPdfUrl(?string $pdfUrl): string
{
    $url = trim((string) $pdfUrl);
    if ($url === '') {
        return '';
    }
    if (preg_match('/offer-letters\.php\?[^#]*[?&]id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i', $url, $m)) {
        return strtolower($m[1]);
    }
    if (preg_match('/[?&]id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i', $url, $m)
        && stripos($url, 'offer-letters') !== false) {
        return strtolower($m[1]);
    }
    return '';
}

/**
 * Stream PDF from local path or GCS object. Exits on success.
 */
function syncpediaDocumentStorageStreamLocalOrGcs(
    ?string $localPath,
    ?string $gcsObject,
    string $downloadName = 'document.pdf',
): void {
    if (syncpediaDocumentStorageFileExists($localPath)) {
        syncpediaDocumentStorageStreamPdf((string) $localPath, $downloadName);
    }
    $obj = trim((string) ($gcsObject ?? ''));
    if ($obj !== '' && function_exists('syncpediaGcsDownloadObject')) {
        $dl = syncpediaGcsDownloadObject($obj);
        if (!empty($dl['ok']) && isset($dl['bytes']) && is_string($dl['bytes']) && $dl['bytes'] !== '') {
            if (function_exists('syncpediaGcsStreamPdfBytes')) {
                syncpediaGcsStreamPdfBytes($dl['bytes'], $downloadName);
            }
            while (ob_get_level() > 0) {
                @ob_end_clean();
            }
            header('Content-Type: application/pdf');
            header('Content-Disposition: inline; filename="' . syncpediaDocumentSafeFilename($downloadName) . '"');
            header('Content-Length: ' . (string) strlen($dl['bytes']));
            echo $dl['bytes'];
            exit;
        }
    }
    respond(['error' => 'PDF not found on server'], 404);
}

/**
 * Save HTML invoice/receipt when PDF engine is unavailable.
 */
function syncpediaDocumentStorageSaveHtml(string $subdir, string $filename, string $html): ?string
{
    if (trim($html) === '') {
        return null;
    }
    $health = syncpediaDocumentStorageHealth($subdir);
    if (!$health['writable']) {
        return null;
    }
    $base = syncpediaDocumentSafeFilename($filename);
    $base = preg_replace('/\.pdf$/i', '.html', $base);
    if (!preg_match('/\.html$/i', $base)) {
        $base .= '.html';
    }
    $dir = syncpediaDocumentStorageDir($subdir);
    $abs = $dir . DIRECTORY_SEPARATOR . $base;
    if (@file_put_contents($abs, $html) === false) {
        return null;
    }
    @chmod($abs, 0644);
    return syncpediaDocumentStorageRelativePath($abs);
}

function syncpediaDocumentStorageMimeType(?string $storedPath): string
{
    $resolved = syncpediaDocumentStorageResolvePath($storedPath);
    if (!is_string($resolved)) {
        return 'application/octet-stream';
    }
    if (preg_match('/\.html?$/i', $resolved)) {
        return 'text/html; charset=UTF-8';
    }
    return 'application/pdf';
}

function syncpediaDocumentStorageFileExists(?string $storedPath): bool
{
    $resolved = syncpediaDocumentStorageResolvePath($storedPath);
    return is_string($resolved) && is_file($resolved);
}

/** Stream PDF to browser and exit. */
function syncpediaDocumentStorageStreamPdf(string $storedPath, string $downloadName = 'document.pdf'): void
{
    $absPath = syncpediaDocumentStorageResolvePath($storedPath);
    if (!is_string($absPath) || !is_file($absPath)) {
        respond(['error' => 'PDF not found on server'], 404);
    }
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    if (!defined('SYNCPIEDIA_API_DONE')) {
        define('SYNCPIEDIA_API_DONE', true);
    }
    $name = syncpediaDocumentSafeFilename($downloadName);
    $mime = syncpediaDocumentStorageMimeType($storedPath);
    header('Content-Type: ' . $mime);
    header('Content-Disposition: inline; filename="' . $name . '"');
    header('Content-Length: ' . (string) filesize($absPath));
    readfile($absPath);
    exit;
}

function syncpediaDocumentEnsureColumn(PDO $db, string $table, string $column, string $definitionSql): void
{
    try {
        $st = $db->prepare(
            'SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        );
        $st->execute([$table, $column]);
        if ((int) $st->fetchColumn() === 0) {
            $db->exec("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definitionSql}");
        }
    } catch (Throwable $e) {
        error_log("syncpediaDocumentEnsureColumn {$table}.{$column}: " . $e->getMessage());
    }
}
