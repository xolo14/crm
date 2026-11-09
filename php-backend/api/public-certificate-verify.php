<?php
/**
 * Public certificate verification — no authentication required.
 * GET /api/public-certificate-verify.php?id=CERT_ID&token=VERIFY_TOKEN
 * GET ...&format=pdf  → stream the issued PDF (same file as email attachment)
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cert_ids.php';
require_once __DIR__ . '/document_storage.php';
cors();

$db = (new Database())->getConnection();
$certId = strtoupper(trim((string) ($_GET['id'] ?? '')));
$token = trim((string) ($_GET['token'] ?? ''));
$format = strtolower(trim((string) ($_GET['format'] ?? '')));

if ($certId === '') {
    respond(['verified' => false, 'error' => 'Certificate id is required'], 400);
}

// Per-IP limit (a single visitor/scanner checking a handful of certificates).
syncpediaRateLimitConsume('cert_verify', 60, 900);
// IP-agnostic limit on this org+type's certificate space, so a scrape distributed across many
// IPs can't bypass the per-IP limit above by spreading requests out.
syncpediaRateLimitConsumeGlobal('cert_verify_org:' . substr($certId, 0, 5), 300, 900);

// Printed QR codes point at /verify/{id} with no token. Only issued ids of the
// PREFIX-TYPE-###### form can be opened that way. A token, when present, must match.
if ($token === '' && !preg_match(certIssuedIdPattern(), $certId)) {
    error_log('[cert-verify] invalid lookup: malformed id=' . $certId . ' ip=' . (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    respond(['verified' => false, 'error' => 'Certificate not found'], 404);
}

$hasTokenCol = syncpediaColumnExists($db, 'issued_certificates', 'verify_token');
$tokenSelect = $hasTokenCol ? ', verify_token' : '';
$stmt = $db->prepare(
    "SELECT id, template_id, template_name, recipient_name, course_name, cert_type, issue_date, status{$tokenSelect}
     FROM issued_certificates WHERE id = ? LIMIT 1",
);
$stmt->execute([$certId]);
$row = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$row || ($row['status'] ?? '') !== 'issued') {
    error_log('[cert-verify] invalid lookup: not found/not issued id=' . $certId . ' ip=' . (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    respond(['verified' => false, 'error' => 'Certificate not found'], 404);
}

if ($token !== '') {
    $stored = (string) ($row['verify_token'] ?? '');
    if (!$hasTokenCol || $stored === '' || !hash_equals($stored, $token)) {
        error_log('[cert-verify] invalid lookup: bad token id=' . $certId . ' ip=' . (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
        respond(['verified' => false, 'error' => 'Invalid verification token'], 403);
    }
}

/**
 * Resolve issued PDF artifact for this cert id (token already validated on issued_certificates).
 * @return array{pdf_path:?string,gcs_object:?string}|null
 */
$resolveArtifact = static function (PDO $db, string $syncId, string $verifyToken): ?array {
    try {
        $hasGcs = syncpediaColumnExists($db, 'certificate_issue_artifacts', 'gcs_object');
        $cols = $hasGcs ? 'pdf_path, gcs_object, verify_token' : 'pdf_path, verify_token';
        // Prefer artifact whose verify_token matches; else latest for this sync_id.
        $q = $db->prepare(
            "SELECT {$cols} FROM certificate_issue_artifacts
             WHERE sync_id = ?
             ORDER BY
               CASE WHEN verify_token IS NOT NULL AND verify_token = ? THEN 0 ELSE 1 END,
               created_at DESC
             LIMIT 1",
        );
        $q->execute([$syncId, $verifyToken]);
        $art = $q->fetch(PDO::FETCH_ASSOC);
        if (!$art) {
            return null;
        }
        return [
            'pdf_path' => trim((string) ($art['pdf_path'] ?? '')),
            'gcs_object' => $hasGcs ? trim((string) ($art['gcs_object'] ?? '')) : '',
        ];
    } catch (Throwable $e) {
        error_log('[public-certificate-verify] artifact lookup: ' . $e->getMessage());
        return null;
    }
};

$artifact = $resolveArtifact($db, $certId, $token);
$pdfPath = is_array($artifact) ? (string) ($artifact['pdf_path'] ?? '') : '';
$gcsObject = is_array($artifact) ? (string) ($artifact['gcs_object'] ?? '') : '';
$hasPdf = ($pdfPath !== '' && syncpediaDocumentStorageFileExists($pdfPath))
    || ($gcsObject !== '');

if ($format === 'pdf') {
    if (!$hasPdf) {
        respond(['error' => 'PDF not found'], 404);
    }
    $downloadName = 'Certificate_' . preg_replace('/[^A-Za-z0-9_-]/', '_', $certId) . '.pdf';
    if ($pdfPath !== '' && syncpediaDocumentStorageFileExists($pdfPath)) {
        syncpediaDocumentStorageStreamPdf($pdfPath, $downloadName);
    }
    syncpediaDocumentStorageStreamLocalOrGcs(
        $pdfPath !== '' ? $pdfPath : null,
        $gcsObject !== '' ? $gcsObject : null,
        $downloadName,
    );
}

$template = null;
$tplId = trim((string) ($row['template_id'] ?? ''));
if ($tplId !== '') {
    $tstmt = $db->prepare(
        'SELECT id, name, status, cert_type, layout_style, bg_color, accent_color, style_json, fields_json, layers_json, created_at
         FROM certificate_templates WHERE id = ? LIMIT 1',
    );
    $tstmt->execute([$tplId]);
    $tpl = $tstmt->fetch(PDO::FETCH_ASSOC);
    if ($tpl) {
        $styleJson = syncpediaDecodeAssocJson($tpl['style_json'] ?? null);
        $fieldsJson = syncpediaDecodeAssocJson($tpl['fields_json'] ?? null);
        $layersJson = syncpediaDecodeAssocJson($tpl['layers_json'] ?? null);
        $template = [
            'id' => (string) $tpl['id'],
            'name' => (string) $tpl['name'],
            'status' => (string) ($tpl['status'] ?? 'active'),
            'createdAt' => substr((string) ($tpl['created_at'] ?? date('Y-m-d')), 0, 10),
            'certType' => certNormalizeType($tpl['cert_type'] ?? 'CC'),
            'style' => array_merge([
                'layout' => (string) ($tpl['layout_style'] ?? 'classic'),
                'bgColor' => (string) ($tpl['bg_color'] ?? '#ffffff'),
                'accentColor' => (string) ($tpl['accent_color'] ?? '#1A6B3C'),
            ], $styleJson),
            'fields' => $fieldsJson,
            'layers' => $layersJson,
        ];
    }
}

if ($format === 'asset') {
    $asset = basename(str_replace('\\', '/', trim((string) ($_GET['asset'] ?? ''))));
    if ($asset === '' || $asset === '.' || $asset === '..' || !preg_match('/^[A-Za-z0-9._-]+$/', $asset)) {
        respond(['error' => 'Asset not found'], 404);
    }
    $allowed = certPublicTemplateAssetPaths(is_array($template) ? $template : null);
    $match = '';
    foreach ($allowed as $path) {
        if (basename($path) === $asset) {
            $match = $path;
            break;
        }
    }
    if ($match === '') {
        respond(['error' => 'Asset not found'], 404);
    }
    certPublicStreamTemplateAsset($match);
}

respond([
    'verified' => true,
    'certId' => $row['id'],
    'recipientName' => $row['recipient_name'],
    'courseName' => $row['course_name'],
    'certType' => certNormalizeType($row['cert_type'] ?? 'CC'),
    'issueDate' => $row['issue_date'],
    'templateName' => $row['template_name'],
    'template' => $template,
    'hasPdf' => $hasPdf,
    'overrides' => [
        'recipientName' => $row['recipient_name'],
        'domainName' => $row['course_name'],
    ],
]);

/**
 * Upload paths this issued certificate's template is allowed to show publicly.
 *
 * @param array<string, mixed>|null $template
 * @return list<string>
 */
function certPublicTemplateAssetPaths(?array $template): array
{
    if (!is_array($template)) {
        return [];
    }
    $found = [];
    $push = static function ($value) use (&$found): void {
        $raw = trim((string) $value);
        if ($raw === '' || str_starts_with($raw, 'data:') || str_starts_with($raw, 'blob:')) {
            return;
        }
        if (strpos($raw, '..') !== false) {
            return;
        }
        $idx = strpos($raw, '/uploads/certificate_assets/');
        if ($idx === false) {
            return;
        }
        $path = substr($raw, $idx);
        $path = (string) strtok($path, '?#');
        if ($path === '' || !preg_match('#^/uploads/certificate_assets/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+$#', $path)) {
            return;
        }
        $found[$path] = true;
    };
    $style = is_array($template['style'] ?? null) ? $template['style'] : [];
    $fields = is_array($template['fields'] ?? null) ? $template['fields'] : [];
    foreach (['bgImage', 'bgPdf'] as $key) {
        $push($style[$key] ?? '');
    }
    foreach (['signatureImage', 'watermarkImage', 'logoLeftImage', 'logoRightImage'] as $key) {
        $push($fields[$key] ?? '');
    }
    $layers = is_array($template['layers'] ?? null) ? $template['layers'] : [];
    foreach ($layers as $layer) {
        if (!is_array($layer)) {
            continue;
        }
        $push($layer['content'] ?? '');
    }
    return array_keys($found);
}

function certPublicStreamTemplateAsset(string $rawPath): void
{
    $relUploads = str_replace('/', DIRECTORY_SEPARATOR, $rawPath);
    $candidates = [
        dirname(__DIR__) . $relUploads,
        dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . str_replace('/', DIRECTORY_SEPARATOR, substr($rawPath, strlen('/uploads'))),
        dirname(__DIR__, 2) . $relUploads,
        dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'public' . $relUploads,
        dirname(__DIR__) . DIRECTORY_SEPARATOR . 'public' . $relUploads,
    ];
    $abs = null;
    foreach ($candidates as $candidate) {
        $resolved = realpath($candidate);
        if ($resolved === false || !is_file($resolved)) {
            continue;
        }
        $norm = str_replace('\\', '/', $resolved);
        if (strpos($norm, '/uploads/certificate_assets/') === false) {
            continue;
        }
        $abs = $resolved;
        break;
    }
    if ($abs === null) {
        respond(['error' => 'Asset not found'], 404);
    }
    $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));
    $mime = [
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        'webp' => 'image/webp',
        'gif' => 'image/gif',
        'pdf' => 'application/pdf',
    ][$ext] ?? '';
    if ($mime === '') {
        respond(['error' => 'Asset not found'], 404);
    }
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . (string) filesize($abs));
    header('X-Content-Type-Options: nosniff');
    header('Content-Disposition: inline; filename="' . basename($abs) . '"');
    header('Cache-Control: public, max-age=86400');
    readfile($abs);
    exit;
}
