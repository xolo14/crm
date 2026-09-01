<?php
/**
 * DECOY-ONLY PII masking — apply at render/export, not in DB storage.
 */
function decoyMaskPhone(?string $phone): string
{
    $digits = preg_replace('/\D+/', '', (string) $phone) ?? '';
    if ($digits === '') {
        return '';
    }
    $len = strlen($digits);
    if ($len <= 4) {
        return str_repeat('*', $len);
    }
    $prefix = substr($digits, 0, 2);
    $suffix = substr($digits, -4);
    $mid = max(0, $len - 6);
    return $prefix . str_repeat('X', $mid) . $suffix;
}

function decoyMaskEmail(?string $email): string
{
    $email = trim((string) $email);
    if ($email === '' || !str_contains($email, '@')) {
        return $email === '' ? '' : '**@**';
    }
    [$local, $domain] = explode('@', $email, 2);
    $keep = min(2, strlen($local));
    $head = substr($local, 0, $keep);
    return $head . '***@' . $domain;
}

function decoyMaskLeadRow(array $row): array
{
    $out = $row;
    if (array_key_exists('phone', $out)) {
        $out['phone'] = decoyMaskPhone($out['phone'] ?? null);
    }
    if (array_key_exists('email', $out)) {
        $out['email'] = decoyMaskEmail($out['email'] ?? null);
    }
    // Never expose notes that might contain raw PII in decoy UI
    if (isset($out['notes']) && is_string($out['notes']) && $out['notes'] !== '') {
        $out['notes'] = '[redacted]';
    }
    return $out;
}
