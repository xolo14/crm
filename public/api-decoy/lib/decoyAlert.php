<?php
/**
 * DECOY-ONLY — fire-and-forget alerts. Never throws into the HTTP response.
 */
function decoyClientIp(): string
{
    $keys = ['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'];
    foreach ($keys as $k) {
        $v = trim((string) ($_SERVER[$k] ?? ''));
        if ($v === '') {
            continue;
        }
        if ($k === 'HTTP_X_FORWARDED_FOR') {
            $parts = explode(',', $v);
            return trim($parts[0]);
        }
        return $v;
    }
    return '';
}

function decoyAlert(string $action, array $extra = []): void
{
    try {
        $url = defined('DECOY_ALERT_WEBHOOK_URL') ? trim((string) DECOY_ALERT_WEBHOOK_URL) : '';
        $payload = array_merge([
            'source' => 'syncpedia-decoy-layer1',
            'action' => $action,
            'ts' => gmdate('c'),
            'ip' => decoyClientIp(),
            'ua' => substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 500),
            'path' => (string) ($_SERVER['REQUEST_URI'] ?? ''),
        ], $extra);

        error_log('[api-decoy][alert] ' . json_encode($payload, JSON_UNESCAPED_UNICODE));

        if ($url === '') {
            return;
        }

        $body = json_encode($payload, JSON_UNESCAPED_UNICODE);
        if ($body === false) {
            return;
        }

        // Non-blocking where possible
        if (function_exists('fastcgi_finish_request')) {
            // Caller may finish response first; still attempt webhook
        }

        $ctx = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\nContent-Length: " . strlen($body) . "\r\n",
                'content' => $body,
                'timeout' => 2,
                'ignore_errors' => true,
            ],
        ]);
        @file_get_contents($url, false, $ctx);
    } catch (Throwable $e) {
        error_log('[api-decoy] alert swallow: ' . $e->getMessage());
    }
}
