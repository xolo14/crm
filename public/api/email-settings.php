<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
$userId = trim((string) ($tokenData['user_id'] ?? ''));

function emailSettingsResolveOrg(PDO $db, array $tokenData): array
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if ($role === 'super_admin') {
        $st = $db->query("SELECT id, name, slug FROM organizations WHERE LOWER(TRIM(slug)) = 'syncpedia' LIMIT 1");
        $org = $st ? $st->fetch(PDO::FETCH_ASSOC) : false;
        if (!is_array($org)) respond(['error' => 'Syncpedia organization not found'], 404);
        return $org;
    }
    if (!in_array($role, ['admin', 'org'], true)) {
        respond(['error' => 'Only organization admins can manage email setup'], 403);
    }
    $orgId = trim((string) ($tokenData['org_id'] ?? ''));
    if ($orgId === '') respond(['error' => 'Organization context required'], 403);
    $st = $db->prepare('SELECT id, name, slug FROM organizations WHERE id = ? LIMIT 1');
    $st->execute([$orgId]);
    $org = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($org)) respond(['error' => 'Organization not found'], 404);
    return $org;
}

function emailSettingsResponse(PDO $db, array $org): void
{
    $st = $db->prepare(
        'SELECT id, slot, label, email, from_name, is_active, last_tested_at, last_test_status, last_error
         FROM org_smtp_accounts WHERE org_id = ? ORDER BY slot',
    );
    $st->execute([$org['id']]);
    $accounts = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $row['slot'] = (int) $row['slot'];
        $row['is_active'] = (bool) $row['is_active'];
        $row['password_set'] = true;
        $accounts[] = $row;
    }
    $routesStmt = $db->prepare(
        'SELECT r.category, a.slot FROM org_email_routes r
         INNER JOIN org_smtp_accounts a ON a.id = r.smtp_account_id AND a.org_id = r.org_id
         WHERE r.org_id = ?',
    );
    $routesStmt->execute([$org['id']]);
    $routes = [];
    foreach ($routesStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $routes[(string) $row['category']] = (int) $row['slot'];
    }
    $categories = syncpediaMailCategories();
    $hasEmailOne = false;
    foreach ($accounts as $account) {
        if ((int) ($account['slot'] ?? 0) === 1 && !empty($account['is_active'])) {
            $hasEmailOne = true;
            break;
        }
    }
    $injectSlot = null;
    if (isset($routes['default'])) {
        $injectSlot = (int) $routes['default'];
    } elseif ($hasEmailOne) {
        $injectSlot = 1;
    }
    if ($injectSlot !== null) {
        foreach ($categories as $category) {
            $key = (string) $category['key'];
            if (!array_key_exists($key, $routes)) $routes[$key] = $injectSlot;
        }
    }
    respond([
        'data' => [
            'organization' => $org,
            'accounts' => $accounts,
            'routes' => $routes,
            'categories' => $categories,
            'gmail' => ['host' => 'smtp.gmail.com', 'port' => 587, 'encryption' => 'tls'],
        ],
    ]);
}

$org = emailSettingsResolveOrg($db, $tokenData);
$orgId = (string) $org['id'];
syncpediaEnsureOrgEmailSchema($db);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string) ($_GET['action'] ?? 'setup'));

if ($method === 'GET') {
    emailSettingsResponse($db, $org);
}

if ($method === 'PUT' && $action === 'setup') {
    $input = getInput();
    $accountsInput = is_array($input['accounts'] ?? null) ? $input['accounts'] : [];
    $routesInput = is_array($input['routes'] ?? null) ? $input['routes'] : [];
    $bySlot = [];
    foreach ($accountsInput as $account) {
        if (!is_array($account)) continue;
        $slot = (int) ($account['slot'] ?? 0);
        if ($slot < 1 || $slot > 3 || isset($bySlot[$slot])) {
            respond(['error' => 'SMTP account slots must be unique values from 1 to 3'], 400);
        }
        $bySlot[$slot] = $account;
    }
    $seenEmails = [];
    foreach ($bySlot as $slot => $account) {
        $email = strtolower(trim((string) ($account['email'] ?? '')));
        if ($email === '') continue;
        if (isset($seenEmails[$email])) {
            respond(['error' => "The same Gmail address cannot be used in account {$seenEmails[$email]} and account {$slot}"], 400);
        }
        $seenEmails[$email] = $slot;
    }

    $existingStmt = $db->prepare('SELECT * FROM org_smtp_accounts WHERE org_id = ?');
    $existingStmt->execute([$orgId]);
    $existing = [];
    foreach ($existingStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $existing[(int) $row['slot']] = $row;
    }

    try {
        $db->beginTransaction();
        $db->prepare('DELETE FROM org_email_routes WHERE org_id = ?')->execute([$orgId]);
        $deleteChanged = $db->prepare('DELETE FROM org_smtp_accounts WHERE org_id = ? AND slot = ?');
        foreach ($existing as $slot => $row) {
            $nextEmail = strtolower(trim((string) ($bySlot[$slot]['email'] ?? '')));
            $oldEmail = strtolower(trim((string) ($row['email'] ?? '')));
            if ($nextEmail === '' || $nextEmail !== $oldEmail) {
                $deleteChanged->execute([$orgId, $slot]);
            }
        }
        $savedIds = [];
        for ($slot = 1; $slot <= 3; $slot++) {
            $account = $bySlot[$slot] ?? null;
            $email = is_array($account) ? strtolower(trim((string) ($account['email'] ?? ''))) : '';
            if ($email === '') {
                if (isset($existing[$slot])) {
                    $db->prepare('DELETE FROM org_email_routes WHERE org_id = ? AND smtp_account_id = ?')
                        ->execute([$orgId, $existing[$slot]['id']]);
                    $db->prepare('DELETE FROM org_smtp_accounts WHERE org_id = ? AND id = ?')
                        ->execute([$orgId, $existing[$slot]['id']]);
                }
                continue;
            }
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new InvalidArgumentException("Account {$slot} requires a valid email address");
            }
            $label = trim((string) ($account['label'] ?? '')) ?: "Email {$slot}";
            $fromName = trim((string) ($account['from_name'] ?? '')) ?: (string) $org['name'];
            $password = preg_replace('/\s+/', '', (string) ($account['app_password'] ?? '')) ?? '';
            $id = isset($existing[$slot]) ? (string) $existing[$slot]['id'] : generateUUID();
            if ($password === '' && !isset($existing[$slot])) {
                throw new InvalidArgumentException("Account {$slot} requires a Google App Password");
            }
            if ($password === '' && isset($existing[$slot])
                && strtolower(trim((string) $existing[$slot]['email'])) !== $email) {
                throw new InvalidArgumentException("Account {$slot} requires a new App Password when changing its email address");
            }
            if ($password !== '' && !preg_match('/^[A-Za-z0-9]{16}$/', $password)) {
                throw new InvalidArgumentException("Account {$slot} App Password must contain exactly 16 letters or numbers");
            }

            if ($password !== '') {
                $secret = syncpediaEncryptOrgSmtpSecret($password, $orgId, $id);
            } else {
                $secret = [
                    'ciphertext' => $existing[$slot]['secret_ciphertext'],
                    'nonce' => $existing[$slot]['secret_nonce'],
                    'tag' => $existing[$slot]['secret_tag'],
                ];
            }
            if (syncpediaDbIsMysql($db)) {
                $sql = "INSERT INTO org_smtp_accounts
                        (id, org_id, slot, label, email, from_name, secret_ciphertext, secret_nonce, secret_tag, is_active, created_by, updated_by)
                        VALUES (?,?,?,?,?,?,?,?,?,1,?,?)
                        ON DUPLICATE KEY UPDATE label=VALUES(label), email=VALUES(email), from_name=VALUES(from_name),
                        secret_ciphertext=VALUES(secret_ciphertext), secret_nonce=VALUES(secret_nonce), secret_tag=VALUES(secret_tag),
                        is_active=1, updated_by=VALUES(updated_by)";
            } else {
                $sql = "INSERT INTO org_smtp_accounts
                        (id, org_id, slot, label, email, from_name, secret_ciphertext, secret_nonce, secret_tag, is_active, created_by, updated_by)
                        VALUES (?,?,?,?,?,?,?,?,?,TRUE,?,?)
                        ON CONFLICT (org_id, slot) DO UPDATE SET
                        label=EXCLUDED.label, email=EXCLUDED.email, from_name=EXCLUDED.from_name,
                        secret_ciphertext=EXCLUDED.secret_ciphertext, secret_nonce=EXCLUDED.secret_nonce,
                        secret_tag=EXCLUDED.secret_tag, is_active=TRUE, updated_by=EXCLUDED.updated_by,
                        updated_at=CURRENT_TIMESTAMP";
            }
            $db->prepare($sql)->execute([
                $id, $orgId, $slot, $label, $email, $fromName,
                $secret['ciphertext'], $secret['nonce'], $secret['tag'], $userId, $userId,
            ]);
            $savedIds[$slot] = $id;
        }

        $allowedCategories = array_column(syncpediaMailCategories(), 'key');
        $routeStmt = $db->prepare(
            'INSERT INTO org_email_routes (id, org_id, category, smtp_account_id, updated_by) VALUES (?,?,?,?,?)',
        );
        $fallbackSlot = (int) ($routesInput['default'] ?? 0);
        if ($fallbackSlot > 0 && !isset($savedIds[$fallbackSlot])) {
            $fallbackSlot = 0;
        }
        if ($fallbackSlot === 0 && isset($savedIds[1])) {
            $fallbackSlot = 1;
        }
        foreach ($allowedCategories as $category) {
            $slot = (int) ($routesInput[$category] ?? 0);
            if ($slot === 0) $slot = $fallbackSlot;
            if ($slot === 0) continue;
            if (!isset($savedIds[$slot])) {
                throw new InvalidArgumentException("Select a configured account for {$category}");
            }
            $routeStmt->execute([generateUUID(), $orgId, $category, $savedIds[$slot], $userId]);
        }
        $db->commit();
    } catch (InvalidArgumentException $e) {
        if ($db->inTransaction()) $db->rollBack();
        respond(['error' => $e->getMessage()], 400);
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('[email-settings] save: ' . $e->getMessage());
        respond(['error' => 'Could not save email setup'], 500);
    }
    emailSettingsResponse($db, $org);
}

if ($method === 'POST' && $action === 'test') {
    $input = getInput();
    $slot = (int) ($input['slot'] ?? 0);
    $st = $db->prepare('SELECT * FROM org_smtp_accounts WHERE org_id = ? AND slot = ? AND is_active = 1 LIMIT 1');
    $st->execute([$orgId, $slot]);
    $account = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($account)) respond(['error' => 'SMTP account not found'], 404);
    $recipientStmt = $db->prepare('SELECT email FROM users WHERE id = ? LIMIT 1');
    $recipientStmt->execute([$userId]);
    $recipient = trim((string) ($recipientStmt->fetchColumn() ?: ''));
    if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) respond(['error' => 'Your account has no valid test email'], 400);
    if (!syncpediaLoadComposerAutoload()) respond(['error' => 'PHPMailer is not installed'], 500);

    try {
        $result = syncpediaSmtpSendOnce(
            $recipient,
            'CRM email setup test',
            '<p>Your organization Gmail SMTP setup is working.</p>',
            (string) $account['email'],
            trim((string) $account['from_name']) ?: (string) $org['name'],
            ['user' => (string) $account['email'], 'pass' => syncpediaDecryptOrgSmtpSecret($account)],
            'smtp.gmail.com',
            587,
            'tls',
        );
    } catch (Throwable $e) {
        $result = ['ok' => false, 'error' => $e->getMessage()];
    }
    $ok = !empty($result['ok']);
    $safeError = $ok ? null : substr((string) ($result['error'] ?? 'SMTP test failed'), 0, 500);
    $db->prepare('UPDATE org_smtp_accounts SET last_tested_at = NOW(), last_test_status = ?, last_error = ? WHERE id = ? AND org_id = ?')
        ->execute([$ok ? 'success' : 'failed', $safeError, $account['id'], $orgId]);
    if (!$ok) respond(['error' => $safeError], 502);
    respond(['message' => 'Test email sent', 'to' => $recipient]);
}

respond(['error' => 'Method not allowed'], 405);
