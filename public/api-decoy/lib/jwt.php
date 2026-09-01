<?php
/**
 * DECOY-ONLY JWT (HS256) — uses DECOY_JWT_SECRET only.
 */
function decoyB64UrlEncode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function decoyB64UrlDecode(string $data): string
{
    $remainder = strlen($data) % 4;
    if ($remainder) {
        $data .= str_repeat('=', 4 - $remainder);
    }
    return (string) base64_decode(strtr($data, '-_', '+/'));
}

function decoyJwtEncode(array $payload): string
{
    $header = ['typ' => 'JWT', 'alg' => 'HS256'];
    $segments = [
        decoyB64UrlEncode(json_encode($header, JSON_UNESCAPED_UNICODE)),
        decoyB64UrlEncode(json_encode($payload, JSON_UNESCAPED_UNICODE)),
    ];
    $signing = implode('.', $segments);
    $sig = hash_hmac('sha256', $signing, (string) DECOY_JWT_SECRET, true);
    $segments[] = decoyB64UrlEncode($sig);
    return implode('.', $segments);
}

function decoyJwtDecode(string $token): ?array
{
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        return null;
    }
    [$h, $p, $s] = $parts;
    $expected = decoyB64UrlEncode(hash_hmac('sha256', $h . '.' . $p, (string) DECOY_JWT_SECRET, true));
    if (!hash_equals($expected, $s)) {
        return null;
    }
    $payload = json_decode(decoyB64UrlDecode($p), true);
    if (!is_array($payload)) {
        return null;
    }
    if (isset($payload['exp']) && (int) $payload['exp'] < time()) {
        return null;
    }
    return $payload;
}
