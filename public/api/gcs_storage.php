<?php
/**
 * Hostinger-safe Google Cloud Storage helper (no google/cloud-storage SDK).
 * Uses service-account JWT → OAuth token for upload, and V4 signed URLs for download.
 *
 * Config (config.php):
 *   GCS_ENABLED       bool
 *   GCS_BUCKET        string
 *   GCS_SA_JSON_PATH  absolute path to service-account JSON (outside public_html)
 */

function syncpediaGcsEnabled(): bool
{
    if (defined('GCS_ENABLED')) {
        return (bool) GCS_ENABLED;
    }
    $e = getenv('GCS_ENABLED');
    if ($e !== false && $e !== '') {
        return in_array(strtolower(trim((string) $e)), ['1', 'true', 'yes', 'on'], true);
    }
    return false;
}

function syncpediaGcsBucket(): string
{
    if (defined('GCS_BUCKET') && is_string(GCS_BUCKET) && trim(GCS_BUCKET) !== '') {
        return trim(GCS_BUCKET);
    }
    $e = getenv('GCS_BUCKET');
    return is_string($e) ? trim($e) : '';
}

function syncpediaGcsSaJsonPath(): string
{
    if (defined('GCS_SA_JSON_PATH') && is_string(GCS_SA_JSON_PATH) && trim(GCS_SA_JSON_PATH) !== '') {
        return trim(GCS_SA_JSON_PATH);
    }
    $e = getenv('GCS_SA_JSON_PATH');
    return is_string($e) ? trim($e) : '';
}

/** @return array{client_email?: string, private_key?: string, token_uri?: string}|null */
function syncpediaGcsLoadServiceAccount(): ?array
{
    $path = syncpediaGcsSaJsonPath();
    if ($path === '' || !is_file($path) || !is_readable($path)) {
        return null;
    }
    // Soft warning: keys under the web tree are a deploy footgun (deny via .htaccess).
    $norm = str_replace('\\', '/', $path);
    if (stripos($norm, '/public_html/') !== false || stripos($norm, '/api/') !== false) {
        error_log('[gcs_storage] SA JSON is under a web-accessible tree; prefer a path outside public_html');
    }
    $raw = @file_get_contents($path);
    if (!is_string($raw) || $raw === '') {
        return null;
    }
    $json = json_decode($raw, true);
    if (!is_array($json)) {
        return null;
    }
    $email = trim((string) ($json['client_email'] ?? ''));
    $key = (string) ($json['private_key'] ?? '');
    if ($email === '' || $key === '') {
        return null;
    }
    return $json;
}

function syncpediaGcsBase64Url(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

/**
 * @return array{ok: bool, token?: string, error?: string}
 */
function syncpediaGcsAccessToken(): array
{
    static $cache = null;
    if (is_array($cache) && !empty($cache['token']) && !empty($cache['expires_at'])
        && (int) $cache['expires_at'] > time() + 60) {
        return ['ok' => true, 'token' => (string) $cache['token']];
    }

    $sa = syncpediaGcsLoadServiceAccount();
    if ($sa === null) {
        return ['ok' => false, 'error' => 'GCS service account JSON missing or unreadable'];
    }

    $tokenUri = 'https://oauth2.googleapis.com/token';
    $saTokenUri = trim((string) ($sa['token_uri'] ?? ''));
    if ($saTokenUri !== '' && $saTokenUri !== $tokenUri) {
        // Prevent SSRF via attacker-controlled SA JSON
        return ['ok' => false, 'error' => 'Invalid GCS token_uri'];
    }

    $now = time();
    $header = syncpediaGcsBase64Url(json_encode(['alg' => 'RS256', 'typ' => 'JWT'], JSON_UNESCAPED_SLASHES));
    $claim = syncpediaGcsBase64Url(json_encode([
        'iss' => (string) $sa['client_email'],
        'scope' => 'https://www.googleapis.com/auth/devstorage.read_write',
        'aud' => $tokenUri,
        'iat' => $now,
        'exp' => $now + 3600,
    ], JSON_UNESCAPED_SLASHES));
    $unsigned = $header . '.' . $claim;

    $pkey = openssl_pkey_get_private((string) $sa['private_key']);
    if ($pkey === false) {
        return ['ok' => false, 'error' => 'Invalid GCS private key'];
    }
    $signature = '';
    $ok = openssl_sign($unsigned, $signature, $pkey, OPENSSL_ALGO_SHA256);
    if (!$ok || $signature === '') {
        return ['ok' => false, 'error' => 'Failed to sign GCS JWT'];
    }
    $jwt = $unsigned . '.' . syncpediaGcsBase64Url($signature);

    $post = http_build_query([
        'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion' => $jwt,
    ]);

    $ch = curl_init($tokenUri);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $post,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_TIMEOUT => 30,
    ]);
    $body = curl_exec($ch);
    $errno = curl_errno($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($errno !== 0 || !is_string($body)) {
        return ['ok' => false, 'error' => 'GCS token request failed (curl)'];
    }
    $parsed = json_decode($body, true);
    $token = is_array($parsed) ? trim((string) ($parsed['access_token'] ?? '')) : '';
    if ($status < 200 || $status >= 300 || $token === '') {
        $msg = is_array($parsed) ? (string) ($parsed['error_description'] ?? $parsed['error'] ?? $body) : $body;
        return ['ok' => false, 'error' => 'GCS token error: ' . substr($msg, 0, 200)];
    }

    $expiresIn = is_array($parsed) ? (int) ($parsed['expires_in'] ?? 3600) : 3600;
    $cache = ['token' => $token, 'expires_at' => $now + max(60, $expiresIn)];
    return ['ok' => true, 'token' => $token];
}

/**
 * Upload PDF bytes to GCS.
 * @return array{ok: bool, object?: string, error?: string}
 */
function syncpediaGcsUploadObject(string $objectName, string $pdfBinary, string $contentType = 'application/pdf'): array
{
    if (!syncpediaGcsEnabled()) {
        return ['ok' => false, 'error' => 'GCS disabled'];
    }
    $bucket = syncpediaGcsBucket();
    if ($bucket === '') {
        return ['ok' => false, 'error' => 'GCS_BUCKET not configured'];
    }
    $objectName = ltrim(str_replace('\\', '/', $objectName), '/');
    if ($objectName === '' || $pdfBinary === '') {
        return ['ok' => false, 'error' => 'Empty object name or PDF bytes'];
    }

    $tok = syncpediaGcsAccessToken();
    if (empty($tok['ok']) || empty($tok['token'])) {
        return ['ok' => false, 'error' => $tok['error'] ?? 'No GCS access token'];
    }

    $url = 'https://storage.googleapis.com/upload/storage/v1/b/'
        . rawurlencode($bucket)
        . '/o?uploadType=media&name='
        . rawurlencode($objectName);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $pdfBinary,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $tok['token'],
            'Content-Type: ' . $contentType,
            'Content-Length: ' . (string) strlen($pdfBinary),
        ],
        CURLOPT_TIMEOUT => 120,
    ]);
    $body = curl_exec($ch);
    $errno = curl_errno($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($errno !== 0 || !is_string($body)) {
        return ['ok' => false, 'error' => 'GCS upload failed (curl)'];
    }
    if ($status < 200 || $status >= 300) {
        return ['ok' => false, 'error' => 'GCS upload HTTP ' . $status . ': ' . substr($body, 0, 240)];
    }
    return ['ok' => true, 'object' => $objectName];
}

/**
 * Build a V4 signed GET URL (for server-side fetch only; short TTL).
 * @return array{ok: bool, url?: string, error?: string}
 */
function syncpediaGcsSignedGetUrl(string $objectName, int $ttlSeconds = 600): array
{
    $sa = syncpediaGcsLoadServiceAccount();
    $bucket = syncpediaGcsBucket();
    if ($sa === null || $bucket === '') {
        return ['ok' => false, 'error' => 'GCS credentials/bucket missing'];
    }
    $objectName = ltrim(str_replace('\\', '/', $objectName), '/');
    if ($objectName === '') {
        return ['ok' => false, 'error' => 'Empty object name'];
    }

    $ttlSeconds = max(60, min(3600, $ttlSeconds));
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $datestamp = $now->format('Ymd');
    $timestamp = $now->format('Ymd\THis\Z');
    $credentialScope = $datestamp . '/auto/storage/goog4_request';
    $credential = (string) $sa['client_email'] . '/' . $credentialScope;

    $canonicalUri = '/' . $bucket . '/' . implode('/', array_map('rawurlencode', explode('/', $objectName)));
    $query = [
        'X-Goog-Algorithm' => 'GOOG4-RSA-SHA256',
        'X-Goog-Credential' => $credential,
        'X-Goog-Date' => $timestamp,
        'X-Goog-Expires' => (string) $ttlSeconds,
        'X-Goog-SignedHeaders' => 'host',
    ];
    ksort($query);
    $canonicalQuery = [];
    foreach ($query as $k => $v) {
        $canonicalQuery[] = rawurlencode($k) . '=' . rawurlencode($v);
    }
    $canonicalQueryString = implode('&', $canonicalQuery);

    $canonicalRequest = implode("\n", [
        'GET',
        $canonicalUri,
        $canonicalQueryString,
        'host:storage.googleapis.com',
        '',
        'host',
        'UNSIGNED-PAYLOAD',
    ]);

    $stringToSign = implode("\n", [
        'GOOG4-RSA-SHA256',
        $timestamp,
        $credentialScope,
        hash('sha256', $canonicalRequest),
    ]);

    $pkey = openssl_pkey_get_private((string) $sa['private_key']);
    if ($pkey === false) {
        return ['ok' => false, 'error' => 'Invalid GCS private key'];
    }
    $signature = '';
    if (!openssl_sign($stringToSign, $signature, $pkey, OPENSSL_ALGO_SHA256) || $signature === '') {
        return ['ok' => false, 'error' => 'Failed to sign GCS URL'];
    }
    $hexSig = bin2hex($signature);
    $url = 'https://storage.googleapis.com' . $canonicalUri . '?' . $canonicalQueryString
        . '&X-Goog-Signature=' . $hexSig;

    return ['ok' => true, 'url' => $url];
}

/**
 * Download object bytes via signed URL.
 * @return array{ok: bool, bytes?: string, error?: string}
 */
function syncpediaGcsDownloadObject(string $objectName): array
{
    if (!syncpediaGcsEnabled()) {
        return ['ok' => false, 'error' => 'GCS disabled'];
    }
    $signed = syncpediaGcsSignedGetUrl($objectName, 600);
    if (empty($signed['ok']) || empty($signed['url'])) {
        // Fallback: JSON API with access token
        $tok = syncpediaGcsAccessToken();
        $bucket = syncpediaGcsBucket();
        if (empty($tok['ok']) || $bucket === '') {
            return ['ok' => false, 'error' => $signed['error'] ?? 'GCS download unavailable'];
        }
        $objectName = ltrim(str_replace('\\', '/', $objectName), '/');
        $url = 'https://storage.googleapis.com/storage/v1/b/'
            . rawurlencode($bucket)
            . '/o/'
            . rawurlencode($objectName)
            . '?alt=media';
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $tok['token']],
            CURLOPT_TIMEOUT => 120,
        ]);
        $body = curl_exec($ch);
        $errno = curl_errno($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($errno !== 0 || !is_string($body) || $status < 200 || $status >= 300) {
            return ['ok' => false, 'error' => 'GCS download failed HTTP ' . $status];
        }
        return ['ok' => true, 'bytes' => $body];
    }

    $ch = curl_init((string) $signed['url']);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 120,
    ]);
    $body = curl_exec($ch);
    $errno = curl_errno($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($errno !== 0 || !is_string($body) || $status < 200 || $status >= 300) {
        return ['ok' => false, 'error' => 'GCS signed download failed HTTP ' . $status];
    }
    return ['ok' => true, 'bytes' => $body];
}

/**
 * Build a stable object key for issued docs.
 * Optional $label (candidate/student name) makes objects easy to identify in the bucket UI.
 * Format: {org}/{kind}/{yyyy}/{mm}/{SafeName}_{id}.pdf
 */
function syncpediaGcsObjectKey(?string $orgId, string $kind, string $id, ?string $label = null): string
{
    $org = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) ($orgId ?: 'unknown')) ?: 'unknown';
    $kind = preg_replace('/[^a-z0-9_-]/', '', strtolower($kind)) ?: 'docs';
    $safeId = preg_replace('/[^a-zA-Z0-9._-]/', '_', $id) ?: 'doc';
    $ym = date('Y/m');
    $base = $safeId;
    $label = trim((string) $label);
    if ($label !== '') {
        $safeLabel = preg_replace('/[^A-Za-z0-9_-]+/', '_', $label);
        $safeLabel = trim((string) $safeLabel, '_');
        if ($safeLabel === '') {
            $safeLabel = 'Candidate';
        }
        if (strlen($safeLabel) > 60) {
            $safeLabel = substr($safeLabel, 0, 60);
        }
        $base = $safeLabel . '_' . $safeId;
    }
    return $org . '/' . $kind . '/' . $ym . '/' . $base . '.pdf';
}

/**
 * Stream PDF bytes to the browser and exit.
 */
function syncpediaGcsStreamPdfBytes(string $pdfBinary, string $downloadName = 'document.pdf'): void
{
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    if (!defined('SYNCPIEDIA_API_DONE')) {
        define('SYNCPIEDIA_API_DONE', true);
    }
    $name = preg_replace('/[^A-Za-z0-9._-]/', '_', $downloadName) ?: 'document.pdf';
    if (!preg_match('/\.pdf$/i', $name)) {
        $name .= '.pdf';
    }
    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="' . $name . '"');
    header('Content-Length: ' . (string) strlen($pdfBinary));
    echo $pdfBinary;
    exit;
}
