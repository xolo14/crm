<?php
/**
 * On-disk PDF storage (same pattern as certificates: php-backend/storage/{subdir}/).
 */
require_once __DIR__ . '/helpers.php';

function syncpediaDocumentStorageBackendRoot(): string {
    $dir = realpath(__DIR__ . '/../');
    if (!is_string($dir) || $dir === '') {
        $dir = __DIR__ . '/../';
    }
    return rtrim($dir, '/\\');
}

/** @param 'certificates'|'payslips'|'payment_invoices'|'offer_letters' $subdir */
function syncpediaDocumentStorageDir(string $subdir): string {
    $safe = preg_replace('/[^a-z0-9_]/', '', strtolower($subdir));
    if ($safe === '') {
        $safe = 'misc';
    }
    $target = syncpediaDocumentStorageBackendRoot()
        . DIRECTORY_SEPARATOR . 'storage'
        . DIRECTORY_SEPARATOR . $safe;
    if (!is_dir($target)) {
        @mkdir($target, 0777, true);
    }
    return $target;
}

function syncpediaDocumentSafeFilename(string $name): string {
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
 * Write PDF bytes under storage/{subdir}/. Returns absolute path or null.
 */
function syncpediaDocumentStorageSavePdf(string $subdir, string $filename, string $pdfBinary): ?string {
    if ($pdfBinary === '') {
        return null;
    }
    $dir = syncpediaDocumentStorageDir($subdir);
    $path = $dir . DIRECTORY_SEPARATOR . syncpediaDocumentSafeFilename($filename);
    if (@file_put_contents($path, $pdfBinary) === false) {
        return null;
    }
    return $path;
}

function syncpediaDocumentStorageFileExists(?string $absPath): bool {
    return is_string($absPath) && $absPath !== '' && is_file($absPath);
}

/** Stream PDF to browser and exit. */
function syncpediaDocumentStorageStreamPdf(string $absPath, string $downloadName = 'document.pdf'): void {
    if (!syncpediaDocumentStorageFileExists($absPath)) {
        respond(['error' => 'PDF not found on server'], 404);
    }
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    if (!defined('SYNCPIEDIA_API_DONE')) {
        define('SYNCPIEDIA_API_DONE', true);
    }
    $name = syncpediaDocumentSafeFilename($downloadName);
    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="' . $name . '"');
    header('Content-Length: ' . (string) filesize($absPath));
    readfile($absPath);
    exit;
}

function syncpediaDocumentEnsureColumn(PDO $db, string $table, string $column, string $definitionSql): void {
    try {
        $st = $db->prepare(
            'SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
        );
        $st->execute([$table, $column]);
        if ((int) $st->fetchColumn() === 0) {
            $db->exec("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definitionSql}");
        }
    } catch (Throwable $e) {
        error_log("syncpediaDocumentEnsureColumn {$table}.{$column}: " . $e->getMessage());
    }
}
