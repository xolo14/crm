<?php
/**
 * DECOY-ONLY helpers — no require of public/api/helpers.php
 */
require_once __DIR__ . '/bootstrap.php';

if (ob_get_level() === 0) {
    ob_start();
}

function decoyRespond($data, int $status = 200): void
{
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function decoyCors(): void
{
    // Same-origin decoy SPA only — do not reflect arbitrary origins.
    $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $origin = $host !== '' ? $scheme . '://' . $host : '';
    if ($origin !== '') {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
    }
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function decoyUuid(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function decoyInput(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return $_POST ?: [];
    }
    $json = json_decode($raw, true);
    return is_array($json) ? $json : [];
}

function decoySetSessionCookie(string $jwt): void
{
    $name = (string) DECOY_COOKIE_NAME;
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    setcookie($name, $jwt, [
        'expires' => time() + (int) DECOY_TOKEN_EXPIRY,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function decoyClearSessionCookie(): void
{
    $name = (string) DECOY_COOKIE_NAME;
    setcookie($name, '', [
        'expires' => time() - 3600,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function decoyReadToken(): string
{
    $cookie = trim((string) ($_COOKIE[DECOY_COOKIE_NAME] ?? ''));
    if ($cookie !== '') {
        return $cookie;
    }
    $auth = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (preg_match('/^\s*Bearer\s+(\S+)\s*$/i', $auth, $m)) {
        return trim($m[1]);
    }
    return '';
}

function decoyIsActive($value): bool
{
    if ($value === true || $value === 1 || $value === '1' || $value === 't' || $value === 'true') {
        return true;
    }
    return false;
}

function decoyRequireAuth(PDO $db): array
{
    $token = decoyReadToken();
    if ($token === '') {
        decoyRespond(['error' => 'Unauthorized'], 401);
    }
    $payload = decoyJwtDecode($token);
    if (!$payload || empty($payload['user_id'])) {
        decoyRespond(['error' => 'Unauthorized'], 401);
    }
    $st = $db->prepare('SELECT id, email, full_name, role, is_active FROM decoy_users WHERE id = ? LIMIT 1');
    $st->execute([(string) $payload['user_id']]);
    $user = $st->fetch(PDO::FETCH_ASSOC);
    if (!$user || !decoyIsActive($user['is_active'] ?? false)) {
        decoyRespond(['error' => 'Unauthorized'], 401);
    }
    return $user;
}

/** Simple IP tarpit for failed logins (file-based, decoy-only). */
function decoyTarpitDelay(string $ip): void
{
    if ($ip === '') {
        return;
    }
    $dir = sys_get_temp_dir() . '/syncpedia_decoy_tarpit';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    $file = $dir . '/' . hash('sha256', $ip) . '.txt';
    $fails = 0;
    if (is_file($file)) {
        $raw = @file_get_contents($file);
        $fails = (int) trim((string) $raw);
    }
    $fails++;
    @file_put_contents($file, (string) $fails);
    // Cap delay so it doesn't look absurd (max ~1.5s)
    $ms = min(1500, 100 + ($fails * 120));
    usleep($ms * 1000);
}

function decoyTarpitReset(string $ip): void
{
    if ($ip === '') {
        return;
    }
    $file = sys_get_temp_dir() . '/syncpedia_decoy_tarpit/' . hash('sha256', $ip) . '.txt';
    if (is_file($file)) {
        @unlink($file);
    }
}
