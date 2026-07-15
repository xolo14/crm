<?php
/**
 * Authenticated download for private uploads (resumes, call recordings, form attachments).
 * Direct /uploads/* web access should remain denied via .htaccess.
 *
 * GET /api/files.php?path=/uploads/resumes/...
 */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method !== 'GET') {
    respond(['error' => 'Method not allowed'], 405);
}

$rawPath = trim((string) ($_GET['path'] ?? ''));
if ($rawPath === '') {
    respond(['error' => 'path is required'], 400);
}
if ($rawPath[0] !== '/') {
    $rawPath = '/' . $rawPath;
}
if (strpos($rawPath, '..') !== false) {
    respond(['error' => 'Invalid path'], 400);
}

$allowedPrefixes = [
    '/uploads/resumes/',
    '/uploads/call_recordings/',
    '/uploads/form_attachments/',
    '/uploads/hr_resumes/',
];
$okPrefix = false;
foreach ($allowedPrefixes as $prefix) {
    if (strpos($rawPath, $prefix) === 0) {
        $okPrefix = true;
        break;
    }
}
if (!$okPrefix) {
    respond(['error' => 'Path not allowed'], 403);
}

$candidates = [
    dirname(__DIR__) . str_replace('/', DIRECTORY_SEPARATOR, $rawPath),
    dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . str_replace('/', DIRECTORY_SEPARATOR, substr($rawPath, strlen('/uploads'))),
];
// Hostinger: api/ is next to uploads/ under public_html
$publicHtml = dirname(__DIR__);
$candidates[] = $publicHtml . str_replace('/', DIRECTORY_SEPARATOR, $rawPath);

$abs = null;
foreach ($candidates as $candidate) {
    $resolved = realpath($candidate);
    if ($resolved === false || !is_file($resolved)) {
        continue;
    }
    $norm = str_replace('\\', '/', $resolved);
    if (strpos($norm, '/uploads/') === false) {
        continue;
    }
    $abs = $resolved;
    break;
}
if ($abs === null) {
    respond(['error' => 'File not found'], 404);
}

$userId = (string) ($tokenData['user_id'] ?? '');
$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));

if (strpos($rawPath, '/uploads/call_recordings/') === 0) {
    $st = $db->prepare('SELECT * FROM call_logs WHERE attachment_path = ? LIMIT 1');
    $st->execute([$rawPath]);
    $log = $st->fetch(PDO::FETCH_ASSOC);
    if (!$log) {
        respond(['error' => 'File not found'], 404);
    }
    if ($role !== 'super_admin') {
        $repId = (string) ($log['sales_rep_id'] ?? '');
        $logOrg = trim((string) ($log['org_id'] ?? ''));
        $callerOrg = resolveCreatorOrgId($db, $tokenData);
        if ($role === 'sales_representative' && $repId !== $userId) {
            respond(['error' => 'Forbidden'], 403);
        }
        if (in_array($role, ['admin', 'org', 'manager', 'hr', 'marketing'], true)) {
            if ($callerOrg === null || $callerOrg === '' || $logOrg !== $callerOrg) {
                respond(['error' => 'Forbidden'], 403);
            }
        }
    }
} elseif (
    strpos($rawPath, '/uploads/resumes/') === 0
    || strpos($rawPath, '/uploads/form_attachments/') === 0
    || strpos($rawPath, '/uploads/hr_resumes/') === 0
) {
    $st = $db->prepare('SELECT * FROM leads WHERE resume_path = ? LIMIT 1');
    $st->execute([$rawPath]);
    $lead = $st->fetch(PDO::FETCH_ASSOC);
    if ($lead) {
        if ($role !== 'super_admin' && !userCanUpdateLeadForCallLog($db, $tokenData, $userId, $role, $lead)) {
            $scope = tenantLeadsScopeSql($db, $tokenData, 'l');
            $chk = $db->prepare("SELECT l.id FROM leads l WHERE l.id = ?{$scope['sql']} LIMIT 1");
            $chk->execute(array_merge([(string) $lead['id']], $scope['params']));
            if (!$chk->fetch()) {
                respond(['error' => 'Forbidden'], 403);
            }
        }
    } elseif (!in_array($role, ['super_admin', 'admin', 'org'], true)) {
        respond(['error' => 'Forbidden'], 403);
    }
}

$mime = 'application/octet-stream';
if (function_exists('mime_content_type')) {
    $detected = @mime_content_type($abs);
    if (is_string($detected) && $detected !== '') {
        $mime = $detected;
    }
}
$basename = basename($abs);
header('Content-Type: ' . $mime);
header('Content-Length: ' . (string) filesize($abs));
header('Content-Disposition: inline; filename="' . str_replace('"', '', $basename) . '"');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, no-store');
readfile($abs);
exit;
