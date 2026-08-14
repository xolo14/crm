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

    $normalized = str_replace('\\', '/', $stored);
    if (is_file($stored)) {
        return $stored;
    }

    $root = syncpediaDocumentStorageBackendRoot();
    $candidate = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, ltrim($normalized, '/'));
    if (is_file($candidate)) {
        return $candidate;
    }

    return null;
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
    ];

    if ($gcsObjectKey !== '' && function_exists('syncpediaGcsEnabled') && syncpediaGcsEnabled()) {
        $up = syncpediaGcsUploadObject($gcsObjectKey, $pdfBinary);
        if (!empty($up['ok']) && !empty($up['object'])) {
            $out['gcs_object'] = (string) $up['object'];
        } else {
            error_log('[document_storage] GCS upload failed: ' . ($up['error'] ?? 'unknown'));
        }
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
