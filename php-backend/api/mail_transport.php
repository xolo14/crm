<?php

use PHPMailer\PHPMailer\Exception as MailerException;
use PHPMailer\PHPMailer\PHPMailer;

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
        __DIR__ . '/../vendor/autoload.php',
        dirname(__DIR__) . '/vendor/autoload.php',
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
    $user = trim((string) $user);
    $pass = (string) $pass;
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

/**
 * Send HTML email via SMTP (Gmail / Google Workspace). No Hostinger mailbox required.
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
    if (!syncpediaSmtpIsReady()) {
        return ['ok' => false, 'error' => 'SMTP is not configured'];
    }

    $account = syncpediaSmtpAccountForFrom($fromAddr);
    $creds = syncpediaSmtpCredentialsForAccount($account);
    if ($creds === null) {
        $other = $account === 'hr' ? 'support' : 'hr';
        $creds = syncpediaSmtpCredentialsForAccount($other);
    }
    if ($creds === null) {
        return ['ok' => false, 'error' => 'SMTP credentials missing for ' . $account];
    }

    $mail = new PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host = syncpediaSmtpHost();
        $mail->SMTPAuth = true;
        $mail->Username = $creds['user'];
        $mail->Password = $creds['pass'];
        $mail->Port = syncpediaSmtpPort();
        $enc = syncpediaSmtpEncryption();
        if ($enc === 'ssl') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
        } elseif ($enc === 'tls') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        } else {
            $mail->SMTPSecure = '';
            $mail->SMTPAutoTLS = false;
        }
        $mail->CharSet = PHPMailer::CHARSET_UTF8;
        $disp = trim($fromDisplayName) !== '' ? trim($fromDisplayName) : 'Syncpedia';
        $mail->setFrom($fromAddr, $disp);
        $mail->addReplyTo($fromAddr, $disp);
        $mail->addAddress($to);
        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body = $htmlBody;
        $mail->AltBody = trim(strip_tags($htmlBody));
        $mail->send();
        return ['ok' => true];
    } catch (MailerException $e) {
        return ['ok' => false, 'error' => 'SMTP send failed: ' . $e->getMessage()];
    }
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
    if (!syncpediaSmtpIsReady()) {
        return ['ok' => false, 'error' => 'SMTP is not configured'];
    }

    $account = syncpediaSmtpAccountForFrom($fromAddr);
    $creds = syncpediaSmtpCredentialsForAccount($account);
    if ($creds === null) {
        $other = $account === 'hr' ? 'support' : 'hr';
        $creds = syncpediaSmtpCredentialsForAccount($other);
    }
    if ($creds === null) {
        return ['ok' => false, 'error' => 'SMTP credentials missing for ' . $account];
    }

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
        $mail->Host = syncpediaSmtpHost();
        $mail->SMTPAuth = true;
        $mail->Username = $creds['user'];
        $mail->Password = $creds['pass'];
        $mail->Port = syncpediaSmtpPort();
        $enc = syncpediaSmtpEncryption();
        if ($enc === 'ssl') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
        } elseif ($enc === 'tls') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        } else {
            $mail->SMTPSecure = '';
            $mail->SMTPAutoTLS = false;
        }
        $mail->CharSet = PHPMailer::CHARSET_UTF8;
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
        return ['ok' => true];
    } catch (MailerException $e) {
        return ['ok' => false, 'error' => 'SMTP send failed: ' . $e->getMessage()];
    }
}
