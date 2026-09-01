<?php
/**
 * DECOY-ONLY auth — login against decoy_users with DECOY_JWT_SECRET.
 * No connection to public/api/auth.php or production users table.
 */
require_once __DIR__ . '/helpers.php';
decoyCors();

$db = (new DecoyDatabase())->getConnection();
decoyEnsureSchema($db);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string) ($_GET['action'] ?? ''));

if ($method === 'GET' && ($action === 'ping' || $action === 'health')) {
    decoyRespond(['ok' => true, 'layer' => 'decoy']);
}

if ($method === 'GET' && $action === 'beacon') {
    decoyAlert('login_page_load', [
        'decoy_user' => null,
        'session_id' => null,
    ]);
    decoyRespond(['ok' => true]);
}

if ($method === 'POST' && ($action === 'login' || $action === '')) {
    // Constant-ish timing baseline (~180ms) so success/fail feel similar to a real CRM.
    $t0 = microtime(true);
    $input = decoyInput();
    $email = strtolower(trim((string) ($input['email'] ?? '')));
    $password = (string) ($input['password'] ?? '');
    $ip = decoyClientIp();

    decoyAlert('login_attempt', [
        'decoy_user' => $email !== '' ? $email : null,
        'session_id' => null,
    ]);

    $ok = false;
    $user = null;
    if ($email !== '' && $password !== '') {
        $st = $db->prepare('SELECT id, email, full_name, password_hash, role, is_active FROM decoy_users WHERE email = ? LIMIT 1');
        $st->execute([$email]);
        $user = $st->fetch(PDO::FETCH_ASSOC);
        if ($user && decoyIsActive($user['is_active'] ?? false)) {
            $ok = password_verify($password, (string) ($user['password_hash'] ?? ''));
        }
    }

    if (!$ok) {
        decoyTarpitDelay($ip);
        $elapsed = (microtime(true) - $t0) * 1000;
        if ($elapsed < 180) {
            usleep((int) ((180 - $elapsed) * 1000));
        }
        decoyAlert('login_fail', [
            'decoy_user' => $email !== '' ? $email : null,
            'session_id' => null,
        ]);
        // Same copy as a generic CRM login failure
        decoyRespond(['error' => 'Invalid email or password'], 401);
    }

    decoyTarpitReset($ip);
    $sid = decoyUuid();
    $exp = time() + (int) DECOY_TOKEN_EXPIRY;
    $jwt = decoyJwtEncode([
        'user_id' => (string) $user['id'],
        'email' => (string) $user['email'],
        'role' => (string) ($user['role'] ?? 'admin'),
        'sid' => $sid,
        'layer' => 'decoy',
        'iat' => time(),
        'exp' => $exp,
    ]);
    decoySetSessionCookie($jwt);

    $elapsed = (microtime(true) - $t0) * 1000;
    if ($elapsed < 180) {
        usleep((int) ((180 - $elapsed) * 1000));
    }

    decoyAlert('login_ok', [
        'decoy_user' => (string) $user['email'],
        'session_id' => $sid,
    ]);

    decoyRespond([
        'data' => [
            'user' => [
                'id' => (string) $user['id'],
                'email' => (string) $user['email'],
                'full_name' => (string) $user['full_name'],
                'role' => (string) ($user['role'] ?? 'admin'),
            ],
            'token' => $jwt,
            'expires_at' => $exp,
        ],
        'message' => 'Logged in',
    ]);
}

if ($method === 'POST' && $action === 'logout') {
    decoyClearSessionCookie();
    decoyRespond(['message' => 'Logged out']);
}

if ($method === 'GET' && $action === 'me') {
    $user = decoyRequireAuth($db);
    decoyRespond([
        'data' => [
            'id' => (string) $user['id'],
            'email' => (string) $user['email'],
            'full_name' => (string) $user['full_name'],
            'role' => (string) ($user['role'] ?? 'admin'),
        ],
    ]);
}

decoyRespond(['error' => 'Method not allowed'], 405);
