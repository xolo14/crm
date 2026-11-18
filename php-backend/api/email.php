<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/email_phase_templates.php';
cors();

$action = isset($_GET['action']) ? trim((string) $_GET['action']) : '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($action === 'phase_update' && $method === 'POST') {
    $tokenData = verifyToken();
    requireRole($tokenData, ['hr', 'admin', 'super_admin', 'org', 'manager']);

    $body = getInput();
    $payload = is_array($body['payload'] ?? null) ? $body['payload'] : null;
    if ($payload === null) {
        respond(['success' => false, 'message' => 'Missing payload'], 400);
    }

    $email = trim((string) ($payload['memberEmail'] ?? ''));
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(['success' => false, 'message' => 'Invalid memberEmail'], 400);
    }

    // Once-only per (member email, phase, phase start, trigger day) across ALL browsers.
    // The trigger runs when anyone opens Fresher Salary; the browser's own localStorage
    // dedupe alone let every other admin/device re-send the same progress email.
    $phase = is_array($payload['phase'] ?? null) ? $payload['phase'] : [];
    $dedupeKey = hash('sha256', implode('|', [
        strtolower($email),
        (string) ($phase['phaseNumber'] ?? ''),
        (string) ($phase['startDate'] ?? ''),
        (string) ($payload['triggerDay'] ?? ''),
    ]));
    $db = (new Database())->getConnection();
    try {
        $db->exec(
            'CREATE TABLE IF NOT EXISTS phase_email_log (
                dedupe_key CHAR(64) NOT NULL PRIMARY KEY,
                member_email VARCHAR(255) NOT NULL,
                sent_by CHAR(36) DEFAULT NULL,
                sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        // Claim the slot first; a duplicate key means it was already sent.
        $claim = $db->prepare('INSERT IGNORE INTO phase_email_log (dedupe_key, member_email, sent_by) VALUES (?, ?, ?)');
        $claim->execute([$dedupeKey, $email, (string) ($tokenData['user_id'] ?? '') ?: null]);
        if ($claim->rowCount() === 0) {
            respond(['success' => true, 'already_sent' => true, 'message' => 'Already sent']);
        }
    } catch (Throwable $e) {
        error_log('[phase_email] dedupe: ' . $e->getMessage());
    }

    $subject = phaseEmailSubject($payload);
    $html = phaseEmailHtml($payload);
    $from = defined('SMTP_HR_USER') && SMTP_HR_USER !== ''
        ? SMTP_HR_USER
        : (defined('SMTP_SUPPORT_USER') ? SMTP_SUPPORT_USER : 'hr@syncpedia.in');

    syncpediaSetMailCategory('hr_updates');
    $result = syncpediaDeliverHtmlEmail(
        $email,
        $subject,
        $html,
        $from,
        'SYNCPedia HR',
    );

    if (!$result['ok']) {
        // Release the claim so a later page view can retry the failed send.
        try {
            $db->prepare('DELETE FROM phase_email_log WHERE dedupe_key = ?')->execute([$dedupeKey]);
        } catch (Throwable $e) {
            error_log('[phase_email] release: ' . $e->getMessage());
        }
        respond([
            'success' => false,
            'message' => $result['error'] ?? 'Failed to send email',
        ], 500);
    }

    respond(['success' => true, 'message' => 'Email sent successfully']);
}

respond(['success' => false, 'error' => 'Not found'], 404);
