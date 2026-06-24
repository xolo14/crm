<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/email_phase_templates.php';
cors();

$action = isset($_GET['action']) ? trim((string) $_GET['action']) : '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($action === 'phase_update' && $method === 'POST') {
    verifyToken();

    $body = getInput();
    $payload = is_array($body['payload'] ?? null) ? $body['payload'] : null;
    if ($payload === null) {
        respond(['success' => false, 'message' => 'Missing payload'], 400);
    }

    $email = trim((string) ($payload['memberEmail'] ?? ''));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(['success' => false, 'message' => 'Invalid memberEmail'], 400);
    }

    if (!syncpediaSmtpIsReady() && !function_exists('mail')) {
        respond([
            'success' => false,
            'message' => 'Email not configured. Set SMTP_* in api/config.php',
        ], 500);
    }

    $subject = phaseEmailSubject($payload);
    $html = phaseEmailHtml($payload);
    $from = defined('SMTP_HR_USER') && SMTP_HR_USER !== ''
        ? SMTP_HR_USER
        : (defined('SMTP_SUPPORT_USER') ? SMTP_SUPPORT_USER : 'hr@syncpedia.in');

    $result = syncpediaDeliverHtmlEmail(
        $email,
        $subject,
        $html,
        $from,
        'SYNCPedia HR',
    );

    if (!$result['ok']) {
        respond([
            'success' => false,
            'message' => $result['error'] ?? 'Failed to send email',
        ], 500);
    }

    respond(['success' => true, 'message' => 'Email sent successfully']);
}

respond(['success' => false, 'error' => 'Not found'], 404);
