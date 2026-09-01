<?php
declare(strict_types=1);

/**
 * Meta Marketing API (Graph) — token crypto, HTTP client, schema, sync helpers.
 * Campaigns-only daily insights; long-lived user tokens (~60d) via fb_exchange_token.
 */

function metaAdsGraphVersion(): string
{
    if (defined('META_ADS_GRAPH_VERSION') && trim((string) META_ADS_GRAPH_VERSION) !== '') {
        return trim((string) META_ADS_GRAPH_VERSION);
    }
    return 'v19.0';
}

function metaAdsAppId(): string
{
    if (defined('META_ADS_APP_ID') && trim((string) META_ADS_APP_ID) !== '') {
        return trim((string) META_ADS_APP_ID);
    }
    // Fallback to WhatsApp app if same Meta app is reused.
    if (defined('META_WHATSAPP_APP_ID') && trim((string) META_WHATSAPP_APP_ID) !== '') {
        return trim((string) META_WHATSAPP_APP_ID);
    }
    return '';
}

function metaAdsAppSecret(): string
{
    if (defined('META_ADS_APP_SECRET') && trim((string) META_ADS_APP_SECRET) !== '') {
        return trim((string) META_ADS_APP_SECRET);
    }
    if (defined('META_WHATSAPP_APP_SECRET') && trim((string) META_WHATSAPP_APP_SECRET) !== '') {
        return trim((string) META_WHATSAPP_APP_SECRET);
    }
    if (defined('WHATSAPP_APP_SECRET') && trim((string) WHATSAPP_APP_SECRET) !== '') {
        return trim((string) WHATSAPP_APP_SECRET);
    }
    return '';
}

function metaAdsOauthRedirectUri(): string
{
    if (defined('META_ADS_OAUTH_REDIRECT_URI') && trim((string) META_ADS_OAUTH_REDIRECT_URI) !== '') {
        return rtrim(trim((string) META_ADS_OAUTH_REDIRECT_URI), '');
    }
    $base = '';
    if (defined('CRM_PUBLIC_URL') && trim((string) CRM_PUBLIC_URL) !== '') {
        $base = rtrim((string) CRM_PUBLIC_URL, '/');
    } else {
        $base = metaAdsPublicBaseFromRequest();
    }
    return $base . '/api/meta-ads.php?action=oauth_callback';
}

function metaAdsPublicBaseFromRequest(): string
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https')
        || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443');
    $host = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
    if ($host === '') {
        return '';
    }
    return ($https ? 'https' : 'http') . '://' . $host;
}

/**
 * Prefer the live request host (oauth callback on crm.syncpedia.in) over a mis-set
 * FRONTEND_URL like crm.syncpedia.com that does not resolve (DNS NXDOMAIN).
 */
function metaAdsFrontendReturnUrl(string $query = 'meta_ads=connected'): string
{
    $requestBase = metaAdsPublicBaseFromRequest();
    $configured = '';
    if (defined('FRONTEND_URL') && trim((string) FRONTEND_URL) !== '') {
        $configured = rtrim(trim((string) FRONTEND_URL), '/');
    } elseif (defined('CRM_PUBLIC_URL') && trim((string) CRM_PUBLIC_URL) !== '') {
        $configured = rtrim(trim((string) CRM_PUBLIC_URL), '/');
    }

    $base = $requestBase !== '' ? $requestBase : $configured;
    // If config points at a different host than the API that just handled OAuth, trust the request.
    if ($requestBase !== '' && $configured !== '') {
        $reqHost = strtolower((string) (parse_url($requestBase, PHP_URL_HOST) ?: ''));
        $cfgHost = strtolower((string) (parse_url($configured, PHP_URL_HOST) ?: ''));
        if ($reqHost !== '' && $cfgHost !== '' && $reqHost !== $cfgHost) {
            $base = $requestBase;
        }
    }
    if ($base === '') {
        $base = 'https://crm.syncpedia.in';
    }
    return rtrim($base, '/') . '/settings?' . ltrim($query, '?');
}

function metaAdsCryptoKey(): string
{
    $raw = defined('SMTP_CREDENTIAL_KEY_V1') ? trim((string) SMTP_CREDENTIAL_KEY_V1) : '';
    if ($raw !== '') {
        $decoded = base64_decode($raw, true);
        if (is_string($decoded) && strlen($decoded) === 32) {
            return $decoded;
        }
    }
    return hash('sha256', 'syncpedia-meta-ads-v1|' . (defined('JWT_SECRET') ? (string) JWT_SECRET : ''), true);
}

/** @return array{ciphertext:string,nonce:string,tag:string} */
function metaAdsEncryptToken(string $token, string $orgId): array
{
    $nonce = random_bytes(12);
    $tag = '';
    $cipher = openssl_encrypt(
        $token,
        'aes-256-gcm',
        metaAdsCryptoKey(),
        OPENSSL_RAW_DATA,
        $nonce,
        $tag,
        "meta-ads:v1|{$orgId}|access_token",
        16,
    );
    if (!is_string($cipher)) {
        throw new RuntimeException('Could not encrypt Meta access token');
    }
    return [
        'ciphertext' => base64_encode($cipher),
        'nonce' => base64_encode($nonce),
        'tag' => base64_encode($tag),
    ];
}

function metaAdsDecryptToken(array $row): string
{
    $cipher = base64_decode((string) ($row['token_ciphertext'] ?? ''), true);
    $nonce = base64_decode((string) ($row['token_nonce'] ?? ''), true);
    $tag = base64_decode((string) ($row['token_tag'] ?? ''), true);
    if (!is_string($cipher) || !is_string($nonce) || !is_string($tag) || $cipher === '') {
        throw new RuntimeException('Stored Meta token is invalid');
    }
    $plain = openssl_decrypt(
        $cipher,
        'aes-256-gcm',
        metaAdsCryptoKey(),
        OPENSSL_RAW_DATA,
        $nonce,
        $tag,
        'meta-ads:v1|' . (string) ($row['org_id'] ?? '') . '|access_token',
    );
    if (!is_string($plain) || $plain === '') {
        throw new RuntimeException('Could not decrypt Meta access token');
    }
    return $plain;
}

function metaAdsEnsureSchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $db->exec(
        "CREATE TABLE IF NOT EXISTS meta_ads_connections (
            id CHAR(36) NOT NULL,
            org_id CHAR(36) NOT NULL,
            meta_user_id VARCHAR(64) DEFAULT NULL,
            meta_user_name VARCHAR(255) DEFAULT NULL,
            token_ciphertext TEXT NOT NULL,
            token_nonce VARCHAR(64) NOT NULL,
            token_tag VARCHAR(64) NOT NULL,
            token_expires_at DATETIME DEFAULT NULL,
            scopes VARCHAR(500) DEFAULT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            last_error TEXT DEFAULT NULL,
            connected_by CHAR(36) DEFAULT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_meta_conn_org (org_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS meta_ads_accounts (
            id CHAR(36) NOT NULL,
            org_id CHAR(36) NOT NULL,
            connection_id CHAR(36) NOT NULL,
            ad_account_id VARCHAR(64) NOT NULL,
            account_name VARCHAR(255) DEFAULT NULL,
            currency VARCHAR(8) DEFAULT NULL,
            timezone_name VARCHAR(64) DEFAULT NULL,
            is_enabled TINYINT(1) NOT NULL DEFAULT 1,
            last_synced_at DATETIME DEFAULT NULL,
            last_sync_error TEXT DEFAULT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_meta_acct_org_act (org_id, ad_account_id),
            INDEX idx_meta_acct_conn (connection_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS meta_ads_campaign_insights (
            id CHAR(36) NOT NULL,
            org_id CHAR(36) NOT NULL,
            ad_account_id VARCHAR(64) NOT NULL,
            campaign_id VARCHAR(64) NOT NULL,
            campaign_name VARCHAR(500) DEFAULT NULL,
            insight_date DATE NOT NULL,
            spend DECIMAL(14,4) NOT NULL DEFAULT 0,
            impressions BIGINT NOT NULL DEFAULT 0,
            clicks BIGINT NOT NULL DEFAULT 0,
            ctr DECIMAL(12,6) NOT NULL DEFAULT 0,
            cpc DECIMAL(14,6) NOT NULL DEFAULT 0,
            conversions DECIMAL(14,4) NOT NULL DEFAULT 0,
            conversion_value DECIMAL(14,4) NOT NULL DEFAULT 0,
            roas DECIMAL(14,6) NOT NULL DEFAULT 0,
            currency VARCHAR(8) DEFAULT NULL,
            raw_json LONGTEXT DEFAULT NULL,
            synced_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_meta_insight_day (org_id, ad_account_id, campaign_id, insight_date),
            INDEX idx_meta_insight_org_date (org_id, insight_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $db->exec(
        "CREATE TABLE IF NOT EXISTS meta_ads_oauth_states (
            state CHAR(64) NOT NULL,
            org_id CHAR(36) NOT NULL,
            user_id CHAR(36) NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (state)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    $done = true;
}

/**
 * @return array{ok:bool,status:int,headers:array<string,string>,json:?array,body:string,error?:string}
 */
function metaAdsHttp(string $method, string $url, ?array $query = null, ?array $form = null): array
{
    if ($query) {
        $url .= (str_contains($url, '?') ? '&' : '?') . http_build_query($query);
    }
    $ch = curl_init($url);
    if ($ch === false) {
        return ['ok' => false, 'status' => 0, 'headers' => [], 'json' => null, 'body' => '', 'error' => 'curl_init failed'];
    }
    $headersOut = [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_TIMEOUT => 60,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$headersOut): int {
            $len = strlen($line);
            $parts = explode(':', $line, 2);
            if (count($parts) === 2) {
                $headersOut[strtolower(trim($parts[0]))] = trim($parts[1]);
            }
            return $len;
        },
    ]);
    if ($form !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($form));
    }
    $body = curl_exec($ch);
    $errno = curl_errno($ch);
    $err = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($errno) {
        return ['ok' => false, 'status' => $status, 'headers' => $headersOut, 'json' => null, 'body' => '', 'error' => $err];
    }
    $json = null;
    if (is_string($body) && $body !== '') {
        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            $json = $decoded;
        }
    }
    $ok = $status >= 200 && $status < 300;
    return [
        'ok' => $ok,
        'status' => $status,
        'headers' => $headersOut,
        'json' => $json,
        'body' => is_string($body) ? $body : '',
        'error' => $ok ? null : (string) ($json['error']['message'] ?? "HTTP {$status}"),
    ];
}

function metaAdsRespectRateLimit(array $headers): void
{
    // Meta may return X-Business-Use-Case-Usage JSON with call_count / total_cputime / total_time (0–100).
    $raw = $headers['x-business-use-case-usage'] ?? $headers['x-app-usage'] ?? '';
    if ($raw === '') {
        return;
    }
    $usage = json_decode($raw, true);
    $max = 0;
    if (is_array($usage)) {
        foreach ($usage as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            foreach (['call_count', 'total_cputime', 'total_time'] as $k) {
                if (isset($entry[$k])) {
                    $max = max($max, (int) $entry[$k]);
                }
            }
        }
    }
    if ($max >= 90) {
        usleep(2_000_000);
    } elseif ($max >= 75) {
        usleep(500_000);
    }
}

/**
 * @return array{access_token:string,expires_in?:int,token_type?:string}
 */
function metaAdsExchangeLongLived(string $shortToken): array
{
    $appId = metaAdsAppId();
    $secret = metaAdsAppSecret();
    if ($appId === '' || $secret === '') {
        throw new RuntimeException('META_ADS_APP_ID / META_ADS_APP_SECRET not configured');
    }
    $res = metaAdsHttp('GET', 'https://graph.facebook.com/' . metaAdsGraphVersion() . '/oauth/access_token', [
        'grant_type' => 'fb_exchange_token',
        'client_id' => $appId,
        'client_secret' => $secret,
        'fb_exchange_token' => $shortToken,
    ]);
    if (!$res['ok'] || !is_array($res['json']) || empty($res['json']['access_token'])) {
        throw new RuntimeException($res['error'] ?? 'Failed to exchange long-lived token');
    }
    return $res['json'];
}

function metaAdsOauthScopes(): string
{
    // Default: ads_read only (insights). Do NOT include leads_retrieval until Meta grants
    // Advanced Access — otherwise Facebook shows "Invalid Scopes: leads_retrieval".
    // After App Review, set e.g.:
    // define('META_ADS_OAUTH_SCOPES', 'ads_read,leads_retrieval,pages_show_list,pages_manage_metadata,pages_read_engagement');
    if (defined('META_ADS_OAUTH_SCOPES') && trim((string) META_ADS_OAUTH_SCOPES) !== '') {
        return trim((string) META_ADS_OAUTH_SCOPES);
    }
    return 'ads_read';
}

function metaAdsBuildOauthUrl(string $state): string
{
    $appId = metaAdsAppId();
    if ($appId === '') {
        throw new RuntimeException('META_ADS_APP_ID not configured');
    }
    $params = [
        'client_id' => $appId,
        'redirect_uri' => metaAdsOauthRedirectUri(),
        'state' => $state,
        'response_type' => 'code',
        'scope' => metaAdsOauthScopes(),
    ];
    // Login for Business optional config id
    if (defined('META_ADS_LOGIN_CONFIG_ID') && trim((string) META_ADS_LOGIN_CONFIG_ID) !== '') {
        $params['config_id'] = trim((string) META_ADS_LOGIN_CONFIG_ID);
    }
    return 'https://www.facebook.com/' . metaAdsGraphVersion() . '/dialog/oauth?' . http_build_query($params);
}

/**
 * @return array{access_token:string,expires_in?:int}
 */
function metaAdsExchangeCode(string $code): array
{
    $appId = metaAdsAppId();
    $secret = metaAdsAppSecret();
    if ($appId === '' || $secret === '') {
        throw new RuntimeException('META_ADS_APP_ID / META_ADS_APP_SECRET not configured');
    }
    $res = metaAdsHttp('GET', 'https://graph.facebook.com/' . metaAdsGraphVersion() . '/oauth/access_token', [
        'client_id' => $appId,
        'client_secret' => $secret,
        'redirect_uri' => metaAdsOauthRedirectUri(),
        'code' => $code,
    ]);
    if (!$res['ok'] || !is_array($res['json']) || empty($res['json']['access_token'])) {
        throw new RuntimeException($res['error'] ?? 'OAuth code exchange failed');
    }
    $short = (string) $res['json']['access_token'];
    return metaAdsExchangeLongLived($short);
}

/**
 * @return array{ok:bool,json:?array,error?:string,status:int,headers:array}
 */
function metaAdsGraphGet(string $path, string $accessToken, array $query = []): array
{
    $query['access_token'] = $accessToken;
    $url = 'https://graph.facebook.com/' . metaAdsGraphVersion() . '/' . ltrim($path, '/');
    $res = metaAdsHttp('GET', $url, $query);
    metaAdsRespectRateLimit($res['headers']);
    if (!$res['ok'] && ($res['status'] === 429 || $res['status'] === 17 || $res['status'] === 4 || $res['status'] === 32)) {
        usleep(3_000_000);
        $res = metaAdsHttp('GET', $url, $query);
        metaAdsRespectRateLimit($res['headers']);
    }
    return $res;
}

/**
 * Fetch all pages of me/adaccounts (not just the first 100).
 * @return list<array<string,mixed>>
 */
function metaAdsFetchAllAdAccounts(string $accessToken): array
{
    $out = [];
    $query = [
        'fields' => 'id,account_id,name,currency,timezone_name,account_status',
        'limit' => 100,
    ];
    $nextUrl = null;
    $guard = 0;
    while ($guard++ < 50) {
        if ($nextUrl) {
            $res = metaAdsHttp('GET', $nextUrl);
            metaAdsRespectRateLimit($res['headers']);
        } else {
            $res = metaAdsGraphGet('me/adaccounts', $accessToken, $query);
        }
        if (!$res['ok']) {
            error_log('[meta_ads] me/adaccounts: ' . ($res['error'] ?? 'fail'));
            break;
        }
        $chunk = is_array($res['json']['data'] ?? null) ? $res['json']['data'] : [];
        foreach ($chunk as $row) {
            if (is_array($row)) {
                $out[] = $row;
            }
        }
        $paging = $res['json']['paging']['next'] ?? null;
        if (is_string($paging) && $paging !== '') {
            $nextUrl = $paging;
            continue;
        }
        break;
    }
    return $out;
}

/** Sum conversion-like actions from insights `actions` array. */
function metaAdsSumConversions(?array $actions): float
{
    if (!is_array($actions)) {
        return 0.0;
    }
    $prefer = [
        'purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase',
        'lead', 'onsite_conversion.lead_grouped', 'complete_registration',
    ];
    $sum = 0.0;
    $matched = false;
    foreach ($actions as $a) {
        if (!is_array($a)) {
            continue;
        }
        $type = (string) ($a['action_type'] ?? '');
        if (in_array($type, $prefer, true)) {
            $sum += (float) ($a['value'] ?? 0);
            $matched = true;
        }
    }
    if ($matched) {
        return $sum;
    }
    // Fallback: all actions
    foreach ($actions as $a) {
        if (is_array($a)) {
            $sum += (float) ($a['value'] ?? 0);
        }
    }
    return $sum;
}

function metaAdsSumActionValues(?array $actionValues): float
{
    if (!is_array($actionValues)) {
        return 0.0;
    }
    $prefer = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'];
    $sum = 0.0;
    $matched = false;
    foreach ($actionValues as $a) {
        if (!is_array($a)) {
            continue;
        }
        $type = (string) ($a['action_type'] ?? '');
        if (in_array($type, $prefer, true)) {
            $sum += (float) ($a['value'] ?? 0);
            $matched = true;
        }
    }
    if ($matched) {
        return $sum;
    }
    foreach ($actionValues as $a) {
        if (is_array($a)) {
            $sum += (float) ($a['value'] ?? 0);
        }
    }
    return $sum;
}

function metaAdsExtractRoas(?array $row, float $spend, float $conversionValue): float
{
    foreach (['purchase_roas', 'website_purchase_roas'] as $key) {
        if (!empty($row[$key]) && is_array($row[$key])) {
            foreach ($row[$key] as $r) {
                if (is_array($r) && isset($r['value'])) {
                    return (float) $r['value'];
                }
            }
        }
    }
    if ($spend > 0 && $conversionValue > 0) {
        return $conversionValue / $spend;
    }
    return 0.0;
}

/**
 * Refresh token if expiring within 7 days. Returns usable access token.
 */
function metaAdsGetValidAccessToken(PDO $db, array $connection): string
{
    $token = metaAdsDecryptToken($connection);
    $expiresAt = trim((string) ($connection['token_expires_at'] ?? ''));
    $needsRefresh = false;
    if ($expiresAt !== '') {
        $ts = strtotime($expiresAt);
        if ($ts !== false && $ts < time() + 7 * 86400) {
            $needsRefresh = true;
        }
    }
    if (!$needsRefresh) {
        return $token;
    }
    try {
        $ex = metaAdsExchangeLongLived($token);
        $newToken = (string) $ex['access_token'];
        $enc = metaAdsEncryptToken($newToken, (string) $connection['org_id']);
        $expiresIn = (int) ($ex['expires_in'] ?? 5184000);
        $newExp = date('Y-m-d H:i:s', time() + max(3600, $expiresIn));
        $db->prepare(
            'UPDATE meta_ads_connections
             SET token_ciphertext=?, token_nonce=?, token_tag=?, token_expires_at=?, status=?, last_error=NULL, updated_at=NOW()
             WHERE id=?'
        )->execute([
            $enc['ciphertext'], $enc['nonce'], $enc['tag'], $newExp, 'active', $connection['id'],
        ]);
        return $newToken;
    } catch (Throwable $e) {
        $db->prepare(
            'UPDATE meta_ads_connections SET status=?, last_error=?, updated_at=NOW() WHERE id=?'
        )->execute(['expired', $e->getMessage(), $connection['id']]);
        throw $e;
    }
}

/**
 * Upsert campaign daily insights for one ad account between since/until (inclusive dates Y-m-d).
 * @return array{upserted:int,pages:int}
 */
function metaAdsSyncAccountInsights(
    PDO $db,
    string $orgId,
    string $adAccountId,
    string $accessToken,
    string $since,
    string $until,
    ?string $currency = null
): array {
    $act = $adAccountId;
    if (!str_starts_with($act, 'act_')) {
        $act = 'act_' . preg_replace('/\D+/', '', $act);
    }
    $fields = 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,actions,action_values,purchase_roas,website_purchase_roas,date_start,date_stop';
    $query = [
        'level' => 'campaign',
        'time_increment' => 1,
        'time_range' => json_encode(['since' => $since, 'until' => $until]),
        'fields' => $fields,
        'limit' => 500,
    ];
    $path = $act . '/insights';
    $upserted = 0;
    $pages = 0;
    $nextUrl = null;

    while (true) {
        $pages++;
        if ($nextUrl) {
            $res = metaAdsHttp('GET', $nextUrl);
            metaAdsRespectRateLimit($res['headers']);
        } else {
            $res = metaAdsGraphGet($path, $accessToken, $query);
        }
        if (!$res['ok']) {
            throw new RuntimeException($res['error'] ?? 'Insights fetch failed');
        }
        $data = $res['json']['data'] ?? [];
        if (!is_array($data)) {
            $data = [];
        }
        foreach ($data as $row) {
            if (!is_array($row)) {
                continue;
            }
            $campaignId = trim((string) ($row['campaign_id'] ?? ''));
            if ($campaignId === '') {
                continue;
            }
            $insightDate = trim((string) ($row['date_start'] ?? $row['date_stop'] ?? ''));
            if ($insightDate === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $insightDate)) {
                continue;
            }
            $spend = (float) ($row['spend'] ?? 0);
            $impressions = (int) ($row['impressions'] ?? 0);
            $clicks = (int) ($row['clicks'] ?? 0);
            $ctr = (float) ($row['ctr'] ?? 0);
            $cpc = (float) ($row['cpc'] ?? 0);
            $conversions = metaAdsSumConversions(is_array($row['actions'] ?? null) ? $row['actions'] : null);
            $conversionValue = metaAdsSumActionValues(is_array($row['action_values'] ?? null) ? $row['action_values'] : null);
            $roas = metaAdsExtractRoas($row, $spend, $conversionValue);
            $id = generateUUID();
            $raw = json_encode($row, JSON_UNESCAPED_UNICODE);
            $sql = 'INSERT INTO meta_ads_campaign_insights
                (id, org_id, ad_account_id, campaign_id, campaign_name, insight_date,
                 spend, impressions, clicks, ctr, cpc, conversions, conversion_value, roas, currency, raw_json, synced_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
                ON DUPLICATE KEY UPDATE
                  campaign_name=VALUES(campaign_name),
                  spend=VALUES(spend),
                  impressions=VALUES(impressions),
                  clicks=VALUES(clicks),
                  ctr=VALUES(ctr),
                  cpc=VALUES(cpc),
                  conversions=VALUES(conversions),
                  conversion_value=VALUES(conversion_value),
                  roas=VALUES(roas),
                  currency=VALUES(currency),
                  raw_json=VALUES(raw_json),
                  synced_at=NOW()';
            $db->prepare($sql)->execute([
                $id, $orgId, $act, $campaignId,
                (string) ($row['campaign_name'] ?? ''),
                $insightDate,
                $spend, $impressions, $clicks, $ctr, $cpc,
                $conversions, $conversionValue, $roas,
                $currency,
                $raw,
            ]);
            $upserted++;
        }
        $paging = $res['json']['paging']['next'] ?? null;
        if (is_string($paging) && $paging !== '') {
            $nextUrl = $paging;
            continue;
        }
        break;
    }

    return ['upserted' => $upserted, 'pages' => $pages];
}

/**
 * Sync all enabled accounts for all active connections (cron).
 * @return array{orgs:int,accounts:int,upserted:int,errors:array<int,string>}
 */
function metaAdsRunHourlySync(PDO $db, int $lookbackDays = 30): array
{
    metaAdsEnsureSchema($db);
    $since = date('Y-m-d', strtotime('-' . max(1, $lookbackDays) . ' days'));
    $until = date('Y-m-d');
    $stmt = $db->query(
        "SELECT a.*, c.token_ciphertext, c.token_nonce, c.token_tag, c.token_expires_at, c.status AS conn_status, c.id AS conn_id
         FROM meta_ads_accounts a
         INNER JOIN meta_ads_connections c ON c.id = a.connection_id
         WHERE a.is_enabled = 1 AND c.status IN ('active','error','expired')"
    );
    $rows = $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    $orgs = [];
    $accounts = 0;
    $upserted = 0;
    $leadsImported = 0;
    $errors = [];

    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $accounts++;
        $orgId = (string) $row['org_id'];
        $orgs[$orgId] = true;
        $acctId = (string) $row['ad_account_id'];
        try {
            $conn = [
                'id' => $row['conn_id'] ?? $row['connection_id'],
                'org_id' => $orgId,
                'token_ciphertext' => $row['token_ciphertext'],
                'token_nonce' => $row['token_nonce'],
                'token_tag' => $row['token_tag'],
                'token_expires_at' => $row['token_expires_at'],
            ];
            $token = metaAdsGetValidAccessToken($db, $conn);
            $result = metaAdsSyncAccountInsights(
                $db,
                $orgId,
                $acctId,
                $token,
                $since,
                $until,
                $row['currency'] ?? null
            );
            $upserted += (int) $result['upserted'];
            try {
                $leadResult = metaAdsSyncAccountLeads($db, $orgId, $acctId, $token);
                $leadsImported += (int) ($leadResult['imported'] ?? 0);
            } catch (Throwable $le) {
                $errors[] = "{$acctId} leads: " . $le->getMessage();
            }
            $db->prepare(
                'UPDATE meta_ads_accounts SET last_synced_at=NOW(), last_sync_error=NULL, updated_at=NOW() WHERE id=?'
            )->execute([$row['id']]);
        } catch (Throwable $e) {
            $msg = $e->getMessage();
            $errors[] = "{$acctId}: {$msg}";
            $db->prepare(
                'UPDATE meta_ads_accounts SET last_sync_error=?, updated_at=NOW() WHERE id=?'
            )->execute([mb_substr($msg, 0, 1000), $row['id']]);
            error_log('[meta_ads_sync] ' . $acctId . ' ' . $msg);
        }
    }

    return [
        'orgs' => count($orgs),
        'accounts' => $accounts,
        'upserted' => $upserted,
        'leads_imported' => $leadsImported,
        'errors' => $errors,
        'since' => $since,
        'until' => $until,
    ];
}

/**
 * Pull Meta Lead Ads into CRM leads. One card per ad (tags meta_ad: / meta_ad_name:).
 * Lead forms live on Facebook Pages ({page-id}/leadgen_forms), not on AdAccount.
 * @return array{imported:int,skipped:int,forms:int}
 */
function metaAdsSyncAccountLeads(PDO $db, string $orgId, string $adAccountId, string $accessToken): array
{
    if (function_exists('ensureLeadsSourceColumnVarchar')) {
        ensureLeadsSourceColumnVarchar($db);
    }

    $forms = metaAdsCollectLeadgenForms($accessToken, $adAccountId);
    if ($forms === null) {
        // Permission / scope failure already thrown inside collector.
        return ['imported' => 0, 'skipped' => 0, 'forms' => 0];
    }
    if ($forms === []) {
        return ['imported' => 0, 'skipped' => 0, 'forms' => 0];
    }

    $imported = 0;
    $skipped = 0;

    foreach ($forms as $form) {
        if (!is_array($form)) {
            continue;
        }
        $formId = trim((string) ($form['id'] ?? ''));
        $formName = trim((string) ($form['name'] ?? 'Lead form'));
        if ($formId === '') {
            continue;
        }
        $nextUrl = null;
        $query = [
            'fields' => 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,field_data,is_organic',
            'limit' => 100,
        ];
        while (true) {
            if ($nextUrl) {
                $res = metaAdsHttp('GET', $nextUrl);
                metaAdsRespectRateLimit($res['headers']);
            } else {
                $res = metaAdsGraphGet($formId . '/leads', $accessToken, $query);
            }
            if (!$res['ok']) {
                $raw = (string) ($res['error'] ?? 'fail');
                error_log('[meta_ads leads] form ' . $formId . ': ' . $raw);
                $low = strtolower($raw);
                if (
                    str_contains($low, 'permission')
                    || str_contains($low, 'oauth')
                    || str_contains($low, 'leads_retrieval')
                    || $res['status'] === 403
                    || $res['status'] === 400
                ) {
                    throw new RuntimeException(
                        'Cannot read leads for form ' . $formId . ': ' . mb_substr($raw, 0, 280)
                        . ' — approve leads_retrieval + Pages permissions, set META_ADS_OAUTH_SCOPES=ads_read,leads_retrieval,pages_show_list,pages_manage_metadata,pages_read_engagement, reconnect, then sync.'
                    );
                }
                break;
            }
            $leads = is_array($res['json']['data'] ?? null) ? $res['json']['data'] : [];
            foreach ($leads as $lead) {
                if (!is_array($lead)) {
                    continue;
                }
                $ok = metaAdsUpsertCrmLead($db, $orgId, $lead, $formId, $formName);
                if ($ok === true) {
                    $imported++;
                } elseif ($ok === null) {
                    $skipped++;
                }
            }
            $paging = $res['json']['paging']['next'] ?? null;
            if (is_string($paging) && $paging !== '') {
                $nextUrl = $paging;
                continue;
            }
            break;
        }
    }

    return ['imported' => $imported, 'skipped' => $skipped, 'forms' => count($forms)];
}

/**
 * Collect leadgen forms from Pages the token can access (and optionally promote pages for the ad account).
 * @return list<array<string,mixed>>|null  null = hard failure already thrown
 */
function metaAdsCollectLeadgenForms(string $accessToken, string $adAccountId): array
{
    $byId = [];
    $pageErrors = [];

    // 1) Pages the user manages
    $pagesRes = metaAdsGraphGet('me/accounts', $accessToken, [
        'fields' => 'id,name,access_token',
        'limit' => 100,
    ]);
    if (!$pagesRes['ok']) {
        $raw = (string) ($pagesRes['error'] ?? 'Failed to list Pages');
        $err = strtolower($raw);
        if (
            str_contains($err, 'permission')
            || str_contains($err, 'oauth')
            || str_contains($err, 'pages_show_list')
            || str_contains($err, '(#200)')
            || $pagesRes['status'] === 403
            || $pagesRes['status'] === 400
        ) {
            throw new RuntimeException(
                'Lead Ads blocked: cannot list Facebook Pages (need pages_show_list / pages_manage_metadata). '
                . 'In Meta App Review approve pages_show_list, pages_manage_metadata, pages_read_engagement, leads_retrieval; set '
                . 'META_ADS_OAUTH_SCOPES=ads_read,leads_retrieval,pages_show_list,pages_manage_metadata,pages_read_engagement; reconnect, then sync. '
                . 'Graph: ' . mb_substr($raw, 0, 240)
            );
        }
        $pageErrors[] = $raw;
    } else {
        $pages = is_array($pagesRes['json']['data'] ?? null) ? $pagesRes['json']['data'] : [];
        foreach ($pages as $page) {
            if (!is_array($page)) {
                continue;
            }
            $pageId = trim((string) ($page['id'] ?? ''));
            if ($pageId === '') {
                continue;
            }
            $pageToken = trim((string) ($page['access_token'] ?? ''));
            $tokenForPage = $pageToken !== '' ? $pageToken : $accessToken;
            $formsRes = metaAdsGraphGet($pageId . '/leadgen_forms', $tokenForPage, [
                'fields' => 'id,name,status',
                'limit' => 100,
            ]);
            if (!$formsRes['ok']) {
                $raw = (string) ($formsRes['error'] ?? 'fail');
                error_log('[meta_ads] page ' . $pageId . ' leadgen_forms: ' . $raw);
                $pageErrors[] = $raw;
                continue;
            }
            $forms = is_array($formsRes['json']['data'] ?? null) ? $formsRes['json']['data'] : [];
            foreach ($forms as $form) {
                if (!is_array($form)) {
                    continue;
                }
                $fid = trim((string) ($form['id'] ?? ''));
                if ($fid !== '') {
                    $byId[$fid] = $form;
                }
            }
        }
    }

    // 2) Fallback: promote pages linked to this ad account (when available)
    $act = $adAccountId;
    if (!str_starts_with($act, 'act_')) {
        $act = 'act_' . preg_replace('/\D+/', '', $act);
    }
    $promoteRes = metaAdsGraphGet($act . '/promote_pages', $accessToken, [
        'fields' => 'id,name',
        'limit' => 50,
    ]);
    if ($promoteRes['ok']) {
        $promotePages = is_array($promoteRes['json']['data'] ?? null) ? $promoteRes['json']['data'] : [];
        foreach ($promotePages as $page) {
            if (!is_array($page)) {
                continue;
            }
            $pageId = trim((string) ($page['id'] ?? ''));
            if ($pageId === '') {
                continue;
            }
            $formsRes = metaAdsGraphGet($pageId . '/leadgen_forms', $accessToken, [
                'fields' => 'id,name,status',
                'limit' => 100,
            ]);
            if (!$formsRes['ok']) {
                continue;
            }
            $forms = is_array($formsRes['json']['data'] ?? null) ? $formsRes['json']['data'] : [];
            foreach ($forms as $form) {
                if (!is_array($form)) {
                    continue;
                }
                $fid = trim((string) ($form['id'] ?? ''));
                if ($fid !== '') {
                    $byId[$fid] = $form;
                }
            }
        }
    }

    if ($byId === [] && $pageErrors !== []) {
        $joined = strtolower(implode(' | ', $pageErrors));
        if (
            str_contains($joined, 'leads_retrieval')
            || str_contains($joined, 'permission')
            || str_contains($joined, 'oauth')
            || str_contains($joined, '(#200)')
            || str_contains($joined, 'nonexisting field')
        ) {
            throw new RuntimeException(
                'Lead Ads blocked: Meta did not grant leads_retrieval (or Page access). '
                . 'Approve leads_retrieval, pages_show_list, pages_manage_metadata, pages_read_engagement; set '
                . 'META_ADS_OAUTH_SCOPES=ads_read,leads_retrieval,pages_show_list,pages_manage_metadata,pages_read_engagement; '
                . 'reconnect, then sync. Graph: ' . mb_substr(implode(' | ', $pageErrors), 0, 280)
            );
        }
    }

    return array_values($byId);
}

/**
 * @return true inserted, null skipped duplicate, false failed
 */
function metaAdsUpsertCrmLead(PDO $db, string $orgId, array $lead, string $formId, string $formName): ?bool
{
    $metaLeadId = trim((string) ($lead['id'] ?? ''));
    if ($metaLeadId === '') {
        return false;
    }
    $chk = $db->prepare(
        "SELECT id FROM leads WHERE org_id = ? AND (
            tags LIKE ? OR notes LIKE ?
         ) LIMIT 1"
    );
    $needle = '%meta_lead_id:' . $metaLeadId . '%';
    $chk->execute([$orgId, $needle, $needle]);
    if ($chk->fetchColumn()) {
        return null;
    }

    $fields = [];
    if (is_array($lead['field_data'] ?? null)) {
        foreach ($lead['field_data'] as $fd) {
            if (!is_array($fd)) {
                continue;
            }
            $name = strtolower(trim((string) ($fd['name'] ?? '')));
            $values = $fd['values'] ?? [];
            $val = is_array($values) ? trim((string) ($values[0] ?? '')) : trim((string) $values);
            if ($name !== '' && $val !== '') {
                $fields[$name] = $val;
            }
        }
    }

    $fullName = $fields['full_name']
        ?? $fields['full name']
        ?? trim(($fields['first_name'] ?? $fields['firstname'] ?? '') . ' ' . ($fields['last_name'] ?? $fields['lastname'] ?? ''));
    if ($fullName === '') {
        $fullName = $fields['name'] ?? 'Meta Lead';
    }
    $email = $fields['email'] ?? $fields['email_address'] ?? null;
    $phone = $fields['phone_number'] ?? $fields['phone'] ?? $fields['mobile_number'] ?? null;

    $adId = trim((string) ($lead['ad_id'] ?? ''));
    $adName = trim((string) ($lead['ad_name'] ?? ''));
    if ($adName === '') {
        $adName = $formName !== '' ? $formName : 'Meta Ad';
    }
    if ($adId === '') {
        $adId = 'form_' . $formId;
    }

    $tags = [
        'meta_lead_id:' . $metaLeadId,
        'meta_ad:' . $adId,
        'meta_ad_name:' . $adName,
        'meta_form_id:' . $formId,
    ];
    if (!empty($lead['campaign_id'])) {
        $tags[] = 'meta_campaign_id:' . $lead['campaign_id'];
    }
    if (!empty($lead['campaign_name'])) {
        $tags[] = 'meta_campaign_name:' . $lead['campaign_name'];
    }
    $tagsJson = json_encode($tags, JSON_UNESCAPED_UNICODE);

    $notes = 'Imported from Meta Lead Ads'
        . ($adName !== '' ? " · Ad: {$adName}" : '')
        . ($formName !== '' ? " · Form: {$formName}" : '')
        . " · meta_lead_id:{$metaLeadId}";

    $id = generateUUID();
    try {
        $stmt = $db->prepare(
            'INSERT INTO leads (id, name, email, phone, source, notes, tags, org_id, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $id,
            mb_substr($fullName, 0, 255),
            $email !== null && $email !== '' ? mb_substr($email, 0, 255) : null,
            $phone !== null && $phone !== '' ? mb_substr(preg_replace('/\s+/', '', $phone) ?? $phone, 0, 40) : null,
            'facebook',
            $notes,
            $tagsJson,
            $orgId,
            'new',
        ]);
        return true;
    } catch (Throwable $e) {
        error_log('[meta_ads upsert lead] ' . $e->getMessage());
        return false;
    }
}
