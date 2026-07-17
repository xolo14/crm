<?php

use PHPMailer\PHPMailer\Exception as MailerException;
use PHPMailer\PHPMailer\PHPMailer;

require_once __DIR__ . '/org_email_service.php';

/**
 * Load Composer autoload (dompdf / PHPMailer). Vendor lives in php-backend/vendor.
 */
function syncpediaLoadComposerAutoload(): bool
{
    static $loaded = null;
    if ($loaded !== null) {
        return $loaded;
    }
    $paths = [
        __DIR__ . '/../vendor/autoload.php', // public/vendor when API is under public/api
        dirname(__DIR__) . '/vendor/autoload.php',
        __DIR__ . '/../../vendor/autoload.php',
        __DIR__ . '/../../public/vendor/autoload.php', // php-backend/api → public/vendor
        __DIR__ . '/../../php-backend/vendor/autoload.php',
        __DIR__ . '/../../../php-backend/vendor/autoload.php',
    ];
    foreach ($paths as $path) {
        if (is_file($path)) {
            require_once $path;
            $loaded = true;
            return true;
        }
    }
    $loaded = false;
    return false;
}

function syncpediaSmtpEnabled(): bool
{
    $flag = getenv('SYNCPIEDIA_SMTP_ENABLED');
    if ($flag !== false && $flag !== '') {
        $v = strtolower(trim((string) $flag));
        if (in_array($v, ['0', 'false', 'off', 'no'], true)) {
            return false;
        }
        if (in_array($v, ['1', 'true', 'on', 'yes'], true)) {
            return true;
        }
    }
    if (defined('SMTP_ENABLED')) {
        return (bool) SMTP_ENABLED;
    }
    return false;
}

function syncpediaSmtpHost(): string
{
    $e = getenv('SYNCPIEDIA_SMTP_HOST');
    if ($e !== false && trim($e) !== '') {
        return trim($e);
    }
    return defined('SMTP_HOST') ? (string) SMTP_HOST : 'smtp.gmail.com';
}

function syncpediaSmtpPort(): int
{
    $e = getenv('SYNCPIEDIA_SMTP_PORT');
    if ($e !== false && trim($e) !== '') {
        return (int) $e;
    }
    return defined('SMTP_PORT') ? (int) SMTP_PORT : 587;
}

/** @return 'tls'|'ssl'|'' */
function syncpediaSmtpEncryption(): string
{
    $e = getenv('SYNCPIEDIA_SMTP_ENCRYPTION');
    if ($e !== false && trim($e) !== '') {
        return strtolower(trim($e));
    }
    if (defined('SMTP_ENCRYPTION')) {
        return strtolower((string) SMTP_ENCRYPTION);
    }
    return 'tls';
}

/**
 * Pick SMTP login: HR mailbox vs support mailbox from the From address.
 *
 * @return 'hr'|'support'
 */
function syncpediaSmtpAccountForFrom(string $fromEmail): string
{
    $from = strtolower(trim($fromEmail));
    $hrDefault = getenv('SYNCPIEDIA_HR_DIGEST_FROM');
    $hrAddr = ($hrDefault !== false && trim($hrDefault) !== '')
        ? strtolower(trim($hrDefault))
        : (defined('SMTP_HR_USER') ? strtolower(trim((string) SMTP_HR_USER)) : 'hr@syncpedia.in');

    if ($from === $hrAddr || str_contains($from, 'hr@')) {
        return 'hr';
    }
    return 'support';
}

/**
 * @return array{user: string, pass: string}|null
 */
/** Strip accidental quotes/whitespace from config.php mailbox passwords. */
function syncpediaSmtpSanitizeSecret(string $pass): string
{
    $pass = trim($pass);
    if (strlen($pass) >= 2) {
        $q = $pass[0];
        if (($q === '"' || $q === "'") && substr($pass, -1) === $q) {
            $pass = substr($pass, 1, -1);
        }
    }
    return $pass;
}

function syncpediaSmtpCredentialsForAccount(string $account): ?array
{
    if ($account === 'hr') {
        $user = getenv('SYNCPIEDIA_SMTP_HR_USER');
        if ($user === false || trim($user) === '') {
            $user = defined('SMTP_HR_USER') ? (string) SMTP_HR_USER : 'hr@syncpedia.in';
        }
        $pass = getenv('SYNCPIEDIA_SMTP_HR_PASS');
        if ($pass === false || $pass === '') {
            $pass = defined('SMTP_HR_PASS') ? (string) SMTP_HR_PASS : '';
        }
    } else {
        $user = getenv('SYNCPIEDIA_SMTP_SUPPORT_USER');
        if ($user === false || trim($user) === '') {
            $user = defined('SMTP_SUPPORT_USER') ? (string) SMTP_SUPPORT_USER : 'support@syncpedia.in';
        }
        $pass = getenv('SYNCPIEDIA_SMTP_SUPPORT_PASS');
        if ($pass === false || $pass === '') {
            $pass = defined('SMTP_SUPPORT_PASS') ? (string) SMTP_SUPPORT_PASS : '';
        }
    }
    $user = strtolower(trim((string) $user));
    $pass = syncpediaSmtpSanitizeSecret((string) $pass);
    if ($user === '' || $pass === '') {
        return null;
    }
    return ['user' => $user, 'pass' => $pass];
}

function syncpediaSmtpIsReady(): bool
{
    if (!syncpediaSmtpEnabled()) {
        return false;
    }
    if (syncpediaSmtpHost() === '') {
        return false;
    }
    if (!syncpediaLoadComposerAutoload()) {
        return false;
    }
    if (syncpediaSmtpCredentialsForAccount('support') !== null) {
        return true;
    }
    return syncpediaSmtpCredentialsForAccount('hr') !== null;
}

/** Human-readable reason when transactional email cannot send via SMTP. */
function syncpediaSmtpNotReadyReason(): string
{
    if (!syncpediaSmtpEnabled()) {
        return 'SMTP_ENABLED is false in api/config.php';
    }
    if (syncpediaSmtpHost() === '') {
        return 'SMTP_HOST is empty in api/config.php';
    }
    if (!syncpediaLoadComposerAutoload()) {
        return 'PHPMailer not found — upload the vendor/ folder next to api/ (or run composer install in php-backend)';
    }
    if (syncpediaSmtpCredentialsForAccount('support') === null && syncpediaSmtpCredentialsForAccount('hr') === null) {
        return 'Set SMTP_SUPPORT_USER and SMTP_SUPPORT_PASS in api/config.php (Hostinger email password for support@…). Empty password disables OTP and welcome emails';
    }
    return 'SMTP is not configured';
}

/**
 * @return list<array{host: string, port: int, enc: string}>
 */
function syncpediaSmtpTransportProfiles(): array
{
    $primary = [
        'host' => syncpediaSmtpHost(),
        'port' => syncpediaSmtpPort(),
        'enc' => syncpediaSmtpEncryption(),
    ];
    $alts = [
        ['host' => 'smtp.hostinger.com', 'port' => 587, 'enc' => 'tls'],
        ['host' => 'smtp.hostinger.com', 'port' => 465, 'enc' => 'ssl'],
        ['host' => 'smtp.titan.email', 'port' => 465, 'enc' => 'ssl'],
        ['host' => 'smtp.titan.email', 'port' => 587, 'enc' => 'tls'],
    ];
    $out = [];
    $seen = [];
    foreach (array_merge([$primary], $alts) as $p) {
        $key = strtolower($p['host']) . ':' . (int) $p['port'] . ':' . strtolower($p['enc']);
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $out[] = $p;
    }
    return $out;
}

function syncpediaSmtpAuthFailedMessage(string $user): string
{
    return 'SMTP could not authenticate as ' . $user
        . '. Fix api/config.php: SMTP_SUPPORT_USER must be the full mailbox (e.g. support@syncpedia.in) and SMTP_SUPPORT_PASS must be that mailbox password from Hostinger → Emails → Email Accounts (not your hPanel login). Use single quotes around the password. If webmail is Titan, set SMTP_HOST to smtp.titan.email, SMTP_PORT 465, SMTP_ENCRYPTION ssl.';
}

/**
 * @param array{user: string, pass: string} $creds
 * @param list<array{path: string, name?: string}> $attachments
 * @return array{ok: bool, error?: string}
 */
function syncpediaSmtpSendOnce(
    string $to,
    string $subject,
    string $htmlBody,
    string $fromAddr,
    string $fromDisplayName,
    array $creds,
    string $host,
    int $port,
    string $enc,
    string $cc = '',
    string $bcc = '',
    array $attachments = [],
    string $altBody = '',
): array {
    $parseList = static function (string $raw): array {
        $out = [];
        foreach (preg_split('/[,;]/', $raw) as $part) {
            $addr = trim($part);
            if ($addr === '') {
                continue;
            }
            if (filter_var($addr, FILTER_VALIDATE_EMAIL)) {
                $out[] = $addr;
            }
        }
        return $out;
    };

    $mail = new PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host = $host;
        $mail->SMTPAuth = true;
        $mail->AuthType = 'LOGIN';
        $mail->Username = $creds['user'];
        $mail->Password = $creds['pass'];
        $mail->Port = $port;
        $enc = strtolower($enc);
        if ($enc === 'ssl') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
        } elseif ($enc === 'tls') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        } else {
            $mail->SMTPSecure = '';
            $mail->SMTPAutoTLS = false;
        }
        $mail->CharSet = PHPMailer::CHARSET_UTF8;
        // Hostinger requires From to match the authenticated mailbox
        $fromAddr = $creds['user'];
        $disp = trim($fromDisplayName) !== '' ? trim($fromDisplayName) : 'Syncpedia';
        $mail->setFrom($fromAddr, $disp);
        $mail->addReplyTo($fromAddr, $disp);
        $mail->addAddress($to);
        foreach ($parseList($cc) as $ccAddr) {
            $mail->addCC($ccAddr);
        }
        foreach ($parseList($bcc) as $bccAddr) {
            $mail->addBCC($bccAddr);
        }
        foreach ($attachments as $file) {
            $path = trim((string) ($file['path'] ?? ''));
            if ($path === '' || !is_file($path) || !is_readable($path)) {
                continue;
            }
            $name = trim((string) ($file['name'] ?? ''));
            if ($name !== '') {
                $mail->addAttachment($path, $name);
            } else {
                $mail->addAttachment($path);
            }
        }
        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body = $htmlBody;
        $mail->AltBody = $altBody !== '' ? $altBody : trim(strip_tags($htmlBody));
        $mail->send();
        return ['ok' => true, 'from' => $creds['user']];
    } catch (MailerException $e) {
        error_log('[smtp] send failed (' . $host . ':' . $port . '/' . $enc . ' as ' . $creds['user'] . '): ' . $e->getMessage());
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}

/**
 * Send HTML email via SMTP (Hostinger / Titan / Google).
 *
 * @return array{ok: bool, error?: string}
 */
function syncpediaSendHtmlEmailViaSmtp(
    string $to,
    string $subject,
    string $htmlBody,
    string $fromAddr,
    string $fromDisplayName,
): array {
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Invalid recipient email'];
    }
    $fromAddr = trim($fromAddr);
    if (!filter_var($fromAddr, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Invalid from email'];
    }
    $account = syncpediaSmtpAccountForFrom($fromAddr);
    $resolved = syncpediaResolveTenantSmtp($account);
    if (empty($resolved['ok'])) {
        return ['ok' => false, 'error' => $resolved['error'] ?? 'Email not configured for your organization'];
    }
    if (!syncpediaLoadComposerAutoload()) {
        return ['ok' => false, 'error' => 'PHPMailer is not installed'];
    }
    $creds = ['user' => (string) $resolved['user'], 'pass' => (string) $resolved['pass']];
    if (!empty($resolved['from_name'])) $fromDisplayName = (string) $resolved['from_name'];

    $lastError = '';
    foreach (($resolved['profiles'] ?? []) as $profile) {
        $res = syncpediaSmtpSendOnce(
            $to,
            $subject,
            $htmlBody,
            $fromAddr,
            $fromDisplayName,
            $creds,
            $profile['host'],
            (int) $profile['port'],
            $profile['enc'],
        );
        if ($res['ok']) {
            return $res;
        }
        $lastError = (string) ($res['error'] ?? 'SMTP send failed');
        // Only try alternate hosts/ports when auth/connect looks wrong
        if (!preg_match('/authenticat|login|credentials|password|535|534|530/i', $lastError)) {
            break;
        }
    }

    if (preg_match('/authenticat|login|credentials|password|535|534|530/i', $lastError)) {
        $message = !empty($resolved['tenant'])
            ? 'Gmail SMTP could not authenticate as ' . $creds['user'] . '. Generate a new Google App Password in Settings → Email Setup.'
            : syncpediaSmtpAuthFailedMessage($creds['user']);
        return ['ok' => false, 'error' => $message];
    }
    return ['ok' => false, 'error' => 'SMTP send failed: ' . $lastError];
}

/**
 * @param list<array{path: string, name?: string}> $attachments
 * @return array{ok: bool, error?: string}
 */
function syncpediaSendHtmlEmailViaSmtpWithOptions(
    string $to,
    string $subject,
    string $htmlBody,
    string $fromAddr,
    string $fromDisplayName,
    string $cc = '',
    string $bcc = '',
    array $attachments = [],
    string $altBody = '',
): array {
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Invalid recipient email'];
    }
    $fromAddr = trim($fromAddr);
    if (!filter_var($fromAddr, FILTER_VALIDATE_EMAIL)) {
        return ['ok' => false, 'error' => 'Invalid from email'];
    }
    $account = syncpediaSmtpAccountForFrom($fromAddr);
    $resolved = syncpediaResolveTenantSmtp($account);
    if (empty($resolved['ok'])) {
        return ['ok' => false, 'error' => $resolved['error'] ?? 'Email not configured for your organization'];
    }
    if (!syncpediaLoadComposerAutoload()) {
        return ['ok' => false, 'error' => 'PHPMailer is not installed'];
    }
    $creds = ['user' => (string) $resolved['user'], 'pass' => (string) $resolved['pass']];
    if (!empty($resolved['from_name'])) $fromDisplayName = (string) $resolved['from_name'];

    $lastError = '';
    foreach (($resolved['profiles'] ?? []) as $profile) {
        $res = syncpediaSmtpSendOnce(
            $to,
            $subject,
            $htmlBody,
            $fromAddr,
            $fromDisplayName,
            $creds,
            $profile['host'],
            (int) $profile['port'],
            $profile['enc'],
            $cc,
            $bcc,
            $attachments,
            $altBody,
        );
        if ($res['ok']) {
            return $res;
        }
        $lastError = (string) ($res['error'] ?? 'SMTP send failed');
        if (!preg_match('/authenticat|login|credentials|password|535|534|530/i', $lastError)) {
            break;
        }
    }

    if (preg_match('/authenticat|login|credentials|password|535|534|530/i', $lastError)) {
        $message = !empty($resolved['tenant'])
            ? 'Gmail SMTP could not authenticate as ' . $creds['user'] . '. Generate a new Google App Password in Settings → Email Setup.'
            : syncpediaSmtpAuthFailedMessage($creds['user']);
        return ['ok' => false, 'error' => $message];
    }
    return ['ok' => false, 'error' => 'SMTP send failed: ' . $lastError];
}
