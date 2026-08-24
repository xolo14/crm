<?php
/**
 * Meta Ads Marketing API — OAuth connect + admin read/manage + insights.
 *
 * Actions:
 *   GET  ?action=status
 *   GET  ?action=oauth_start          → { url }
 *   GET  ?action=oauth_callback       → redirects to Settings
 *   PUT  ?action=accounts             → enable/disable selected ad accounts { accounts:[{ad_account_id,is_enabled}] }
 *   POST ?action=sync_now             → sync this org's enabled accounts
 *   POST ?action=disconnect           → revoke connection (+ accounts)
 *   GET  ?action=insights&from=&to=&ad_account_id=
 *   GET  ?action=webhook              → Meta verification (stub)
 *   POST ?action=webhook              → stub listener
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/meta_ads_service.php';
cors();

$db = (new Database())->getConnection();
metaAdsEnsureSchema($db);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = trim((string) ($_GET['action'] ?? ''));

// ── Public OAuth callback (no JWT; state binds org/user) ─────────────────────
if ($method === 'GET' && $action === 'oauth_callback') {
    $state = trim((string) ($_GET['state'] ?? ''));
    $code = trim((string) ($_GET['code'] ?? ''));
    $err = trim((string) ($_GET['error'] ?? ''));
    if ($err !== '') {
        header('Location: ' . metaAdsFrontendReturnUrl('meta_ads=error&reason=' . rawurlencode($err)));
        exit;
    }
    if ($state === '' || $code === '') {
        header('Location: ' . metaAdsFrontendReturnUrl('meta_ads=error&reason=missing_code'));
        exit;
    }
    $st = $db->prepare('SELECT * FROM meta_ads_oauth_states WHERE state = ? AND expires_at > NOW() LIMIT 1');
    $st->execute([$state]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    $db->prepare('DELETE FROM meta_ads_oauth_states WHERE state = ?')->execute([$state]);
    if (!$row) {
        header('Location: ' . metaAdsFrontendReturnUrl('meta_ads=error&reason=invalid_state'));
        exit;
    }
    $orgId = (string) $row['org_id'];
    $userId = (string) $row['user_id'];
    try {
        $ex = metaAdsExchangeCode($code);
        $accessToken = (string) $ex['access_token'];
        $expiresIn = (int) ($ex['expires_in'] ?? 5184000);
        $expiresAt = date('Y-m-d H:i:s', time() + max(3600, $expiresIn));

        $me = metaAdsGraphGet('me', $accessToken, ['fields' => 'id,name']);
        $metaUserId = is_array($me['json']) ? (string) ($me['json']['id'] ?? '') : '';
        $metaUserName = is_array($me['json']) ? (string) ($me['json']['name'] ?? '') : '';

        $enc = metaAdsEncryptToken($accessToken, $orgId);

        // Upsert connection (do not wipe accounts — that felt like "connection disrupted").
        $existing = $db->prepare('SELECT id FROM meta_ads_connections WHERE org_id = ? ORDER BY updated_at DESC LIMIT 1');
        $existing->execute([$orgId]);
        $connId = (string) ($existing->fetchColumn() ?: '');
        if ($connId === '') {
            $connId = generateUUID();
            $db->prepare(
                'INSERT INTO meta_ads_connections
                 (id, org_id, meta_user_id, meta_user_name, token_ciphertext, token_nonce, token_tag,
                  token_expires_at, scopes, status, last_error, connected_by)
                 VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?)'
            )->execute([
                $connId, $orgId, $metaUserId !== '' ? $metaUserId : null, $metaUserName !== '' ? $metaUserName : null,
                $enc['ciphertext'], $enc['nonce'], $enc['tag'], $expiresAt, metaAdsOauthScopes(), 'active', $userId,
            ]);
        } else {
            $db->prepare(
                'UPDATE meta_ads_connections SET
                    meta_user_id=?, meta_user_name=?,
                    token_ciphertext=?, token_nonce=?, token_tag=?,
                    token_expires_at=?, scopes=?, status=?, last_error=NULL, connected_by=?, updated_at=NOW()
                 WHERE id=?'
            )->execute([
                $metaUserId !== '' ? $metaUserId : null,
                $metaUserName !== '' ? $metaUserName : null,
                $enc['ciphertext'], $enc['nonce'], $enc['tag'],
                $expiresAt, metaAdsOauthScopes(), 'active', $userId, $connId,
            ]);
            // Drop orphan connection rows for this org (keep the one we updated).
            $db->prepare('DELETE FROM meta_ads_connections WHERE org_id = ? AND id <> ?')->execute([$orgId, $connId]);
        }

        // Discover ALL ad accounts (paginated) and upsert — keep is_enabled for existing rows.
        $list = metaAdsFetchAllAdAccounts($accessToken);
        foreach ($list as $a) {
            if (!is_array($a)) {
                continue;
            }
            $actId = (string) ($a['id'] ?? '');
            if ($actId === '') {
                continue;
            }
            if (!str_starts_with($actId, 'act_')) {
                $actId = 'act_' . $actId;
            }
            $db->prepare(
                'INSERT INTO meta_ads_accounts
                 (id, org_id, connection_id, ad_account_id, account_name, currency, timezone_name, is_enabled)
                 VALUES (?,?,?,?,?,?,?,1)
                 ON DUPLICATE KEY UPDATE
                   connection_id=VALUES(connection_id),
                   account_name=VALUES(account_name),
                   currency=VALUES(currency),
                   timezone_name=VALUES(timezone_name),
                   updated_at=NOW()'
            )->execute([
                generateUUID(),
                $orgId,
                $connId,
                $actId,
                (string) ($a['name'] ?? ''),
                (string) ($a['currency'] ?? ''),
                (string) ($a['timezone_name'] ?? ''),
            ]);
        }

        header('Location: ' . metaAdsFrontendReturnUrl('meta_ads=connected'));
        exit;
    } catch (Throwable $e) {
        error_log('[meta-ads oauth] ' . $e->getMessage());
        header('Location: ' . metaAdsFrontendReturnUrl('meta_ads=error&reason=' . rawurlencode($e->getMessage())));
        exit;
    }
}

// ── Webhook verify / stub (public) ───────────────────────────────────────────
if ($action === 'webhook') {
    if ($method === 'GET') {
        $mode = (string) ($_GET['hub_mode'] ?? '');
        $token = (string) ($_GET['hub_verify_token'] ?? '');
        $challenge = (string) ($_GET['hub_challenge'] ?? '');
        $expected = defined('META_ADS_WEBHOOK_VERIFY_TOKEN') ? (string) META_ADS_WEBHOOK_VERIFY_TOKEN : '';
        if ($mode === 'subscribe' && $expected !== '' && hash_equals($expected, $token)) {
            header('Content-Type: text/plain');
            echo $challenge;
            exit;
        }
        respond(['error' => 'Forbidden'], 403);
    }
    // Account-level events — acknowledge; polling remains source of truth for insights.
    $raw = file_get_contents('php://input') ?: '';
    error_log('[meta-ads webhook] ' . substr($raw, 0, 2000));
    respond(['success' => true]);
}

// ── Authenticated APIs ───────────────────────────────────────────────────────
$tokenData = verifyToken();
$userId = (string) ($tokenData['user_id'] ?? '');
$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));

$isAdmin = in_array($role, ['admin', 'org', 'super_admin'], true);
$isMarketing = str_starts_with($role, 'marketing');
if (!$isAdmin && !$isMarketing) {
    respond(['error' => 'Insufficient permissions'], 403);
}

$orgId = resolveWriteOrgId($db, $tokenData);
if ($orgId === null || trim((string) $orgId) === '') {
    respond(['error' => 'Organization context required'], 403);
}
$orgId = (string) $orgId;

// Connect / manage / sync — org admins only. Marketing may view status + insights.
if (
    ($method === 'GET' && $action === 'oauth_start')
    || ($method === 'PUT' && $action === 'accounts')
    || ($method === 'POST' && in_array($action, ['disconnect', 'sync_now'], true))
) {
    requireRole($tokenData, ['admin', 'org', 'super_admin']);
}

if ($method === 'GET' && ($action === '' || $action === 'status')) {
    $c = $db->prepare('SELECT id, org_id, meta_user_id, meta_user_name, token_expires_at, scopes, status, last_error, connected_by, created_at, updated_at FROM meta_ads_connections WHERE org_id = ? ORDER BY updated_at DESC LIMIT 1');
    $c->execute([$orgId]);
    $conn = $c->fetch(PDO::FETCH_ASSOC) ?: null;
    $accounts = [];
    if ($conn) {
        $a = $db->prepare('SELECT id, ad_account_id, account_name, currency, timezone_name, is_enabled, last_synced_at, last_sync_error FROM meta_ads_accounts WHERE org_id = ? AND connection_id = ? ORDER BY account_name ASC');
        $a->execute([$orgId, $conn['id']]);
        $accounts = $a->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }
    $configured = metaAdsAppId() !== '' && metaAdsAppSecret() !== '';
    $oauthScopes = metaAdsOauthScopes();
    $connScopes = is_array($conn) ? (string) ($conn['scopes'] ?? '') : '';
    $hasLeadsScope = str_contains($connScopes, 'leads_retrieval') || str_contains($oauthScopes, 'leads_retrieval');
    respond([
        'data' => [
            'configured' => $configured,
            'redirect_uri' => metaAdsOauthRedirectUri(),
            'oauth_scopes' => $oauthScopes,
            'leads_retrieval_configured' => str_contains($oauthScopes, 'leads_retrieval'),
            'leads_retrieval_granted' => str_contains($connScopes, 'leads_retrieval'),
            'connection' => $conn,
            'accounts' => $accounts,
            // Soft hint for UI; not used for auth.
            'leads_ready' => $hasLeadsScope && str_contains($connScopes, 'leads_retrieval'),
        ],
    ]);
}

if ($method === 'GET' && $action === 'oauth_start') {
    if (metaAdsAppId() === '' || metaAdsAppSecret() === '') {
        respond(['error' => 'Meta Ads app is not configured on the server (META_ADS_APP_ID / META_ADS_APP_SECRET)'], 503);
    }
    $state = bin2hex(random_bytes(24));
    $db->prepare('DELETE FROM meta_ads_oauth_states WHERE expires_at < NOW() OR (org_id = ? AND user_id = ?)')->execute([$orgId, $userId]);
    $db->prepare('INSERT INTO meta_ads_oauth_states (state, org_id, user_id, expires_at) VALUES (?,?,?, DATE_ADD(NOW(), INTERVAL 20 MINUTE))')
        ->execute([$state, $orgId, $userId]);
    try {
        $url = metaAdsBuildOauthUrl($state);
    } catch (Throwable $e) {
        respond(['error' => $e->getMessage()], 500);
    }
    respond(['data' => ['url' => $url, 'state' => $state]]);
}

if ($method === 'PUT' && $action === 'accounts') {
    $input = getInput();
    $list = $input['accounts'] ?? null;
    if (!is_array($list)) {
        respond(['error' => 'accounts array required'], 422);
    }
    $upd = $db->prepare('UPDATE meta_ads_accounts SET is_enabled = ?, updated_at = NOW() WHERE org_id = ? AND ad_account_id = ?');
    foreach ($list as $item) {
        if (!is_array($item)) {
            continue;
        }
        $act = trim((string) ($item['ad_account_id'] ?? ''));
        if ($act === '') {
            continue;
        }
        $enabled = !empty($item['is_enabled']) ? 1 : 0;
        $upd->execute([$enabled, $orgId, $act]);
    }
    respond(['success' => true]);
}

if ($method === 'POST' && $action === 'disconnect') {
    $c = $db->prepare('SELECT id FROM meta_ads_connections WHERE org_id = ?');
    $c->execute([$orgId]);
    foreach ($c->fetchAll(PDO::FETCH_COLUMN) as $cid) {
        $db->prepare('DELETE FROM meta_ads_accounts WHERE connection_id = ?')->execute([$cid]);
        $db->prepare('DELETE FROM meta_ads_connections WHERE id = ?')->execute([$cid]);
    }
    respond(['success' => true]);
}

if ($method === 'POST' && $action === 'sync_now') {
    $c = $db->prepare('SELECT * FROM meta_ads_connections WHERE org_id = ? AND status IN (\'active\',\'error\') ORDER BY updated_at DESC LIMIT 1');
    $c->execute([$orgId]);
    $conn = $c->fetch(PDO::FETCH_ASSOC);
    if (!$conn) {
        respond(['error' => 'No Meta Ads connection for this organization'], 404);
    }
    try {
        $token = metaAdsGetValidAccessToken($db, $conn);
    } catch (Throwable $e) {
        respond(['error' => 'Token expired — reconnect Meta Ads', 'detail' => $e->getMessage()], 401);
    }
    $since = date('Y-m-d', strtotime('-30 days'));
    $until = date('Y-m-d');
    $a = $db->prepare('SELECT * FROM meta_ads_accounts WHERE org_id = ? AND connection_id = ? AND is_enabled = 1');
    $a->execute([$orgId, $conn['id']]);
    $accounts = $a->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $upserted = 0;
    $leadsImported = 0;
    $errors = [];
    $connScopes = (string) ($conn['scopes'] ?? '');
    $oauthScopes = metaAdsOauthScopes();
    $tokenHasLeads = str_contains($connScopes, 'leads_retrieval');
    $configHasLeads = str_contains($oauthScopes, 'leads_retrieval');
    if (!$tokenHasLeads) {
        $errors[] = !$configHasLeads
            ? 'Lead Ads: token has no leads_retrieval. After Meta App Review, set META_ADS_OAUTH_SCOPES=ads_read,leads_retrieval in config.php, then Reconnect.'
            : 'Lead Ads: server requests leads_retrieval but this connection was granted without it. Reconnect Meta Ads and accept Retrieve leads.';
    }
    foreach ($accounts as $acct) {
        try {
            $r = metaAdsSyncAccountInsights(
                $db,
                $orgId,
                (string) $acct['ad_account_id'],
                $token,
                $since,
                $until,
                $acct['currency'] ?? null
            );
            $upserted += (int) $r['upserted'];
            try {
                $lr = metaAdsSyncAccountLeads($db, $orgId, (string) $acct['ad_account_id'], $token);
                $leadsImported += (int) ($lr['imported'] ?? 0);
            } catch (Throwable $le) {
                $errors[] = $acct['ad_account_id'] . ' leads: ' . $le->getMessage();
            }
            $db->prepare('UPDATE meta_ads_accounts SET last_synced_at=NOW(), last_sync_error=NULL WHERE id=?')->execute([$acct['id']]);
        } catch (Throwable $e) {
            $errors[] = $acct['ad_account_id'] . ': ' . $e->getMessage();
            $db->prepare('UPDATE meta_ads_accounts SET last_sync_error=? WHERE id=?')->execute([mb_substr($e->getMessage(), 0, 1000), $acct['id']]);
        }
    }
    respond([
        'success' => true,
        'data' => [
            'upserted' => $upserted,
            'leads_imported' => $leadsImported,
            'accounts' => count($accounts),
            'since' => $since,
            'until' => $until,
            'errors' => $errors,
        ],
    ]);
}

if ($method === 'GET' && $action === 'insights') {
    $from = trim((string) ($_GET['from'] ?? date('Y-m-d', strtotime('-30 days'))));
    $to = trim((string) ($_GET['to'] ?? date('Y-m-d')));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
        respond(['error' => 'from/to must be YYYY-MM-DD'], 422);
    }
    $adAccountId = trim((string) ($_GET['ad_account_id'] ?? ''));
    $sql = 'SELECT campaign_id, campaign_name, ad_account_id, insight_date,
                   spend, impressions, clicks, ctr, cpc, conversions, conversion_value, roas, currency, synced_at
            FROM meta_ads_campaign_insights
            WHERE org_id = ? AND insight_date BETWEEN ? AND ?';
    $params = [$orgId, $from, $to];
    if ($adAccountId !== '') {
        $sql .= ' AND ad_account_id = ?';
        $params[] = $adAccountId;
    }
    $sql .= ' ORDER BY insight_date DESC, spend DESC LIMIT 5000';
    $st = $db->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $totals = [
        'spend' => 0.0,
        'impressions' => 0,
        'clicks' => 0,
        'conversions' => 0.0,
        'conversion_value' => 0.0,
    ];
    foreach ($rows as $r) {
        $totals['spend'] += (float) $r['spend'];
        $totals['impressions'] += (int) $r['impressions'];
        $totals['clicks'] += (int) $r['clicks'];
        $totals['conversions'] += (float) $r['conversions'];
        $totals['conversion_value'] += (float) $r['conversion_value'];
    }
    $totals['ctr'] = $totals['impressions'] > 0 ? ($totals['clicks'] / $totals['impressions']) * 100 : 0;
    $totals['cpc'] = $totals['clicks'] > 0 ? $totals['spend'] / $totals['clicks'] : 0;
    $totals['roas'] = $totals['spend'] > 0 ? $totals['conversion_value'] / $totals['spend'] : 0;

    respond([
        'data' => [
            'from' => $from,
            'to' => $to,
            'rows' => $rows,
            'totals' => $totals,
        ],
    ]);
}

respond(['error' => 'Invalid action'], 400);
