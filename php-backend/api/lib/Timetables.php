<?php
/**
 * Timetables — weekly/monthly class schedules + poster-style email HTML.
 */

function timetablesEnsureSchema(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        $db->exec("
            CREATE TABLE IF NOT EXISTS timetables (
              id CHAR(36) NOT NULL,
              org_id CHAR(36) NOT NULL,
              title VARCHAR(255) NOT NULL DEFAULT 'Class Timetable',
              period_type ENUM('week','month') NOT NULL DEFAULT 'week',
              period_start DATE NOT NULL,
              period_end DATE NOT NULL,
              batch_id CHAR(36) DEFAULT NULL,
              course_id CHAR(36) DEFAULT NULL,
              created_by CHAR(36) DEFAULT NULL,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              INDEX idx_tt_org (org_id),
              INDEX idx_tt_batch (batch_id),
              INDEX idx_tt_period (period_start, period_end)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
        $db->exec("
            CREATE TABLE IF NOT EXISTS timetable_sessions (
              id CHAR(36) NOT NULL,
              timetable_id CHAR(36) NOT NULL,
              session_date DATE NOT NULL,
              course_id CHAR(36) DEFAULT NULL,
              course_name VARCHAR(255) NOT NULL DEFAULT '',
              start_time TIME NOT NULL,
              end_time TIME NOT NULL,
              sort_order INT NOT NULL DEFAULT 0,
              created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              INDEX idx_ts_timetable (timetable_id),
              INDEX idx_ts_date (session_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
        $db->exec("
            CREATE TABLE IF NOT EXISTS timetable_sends (
              id CHAR(36) NOT NULL,
              timetable_id CHAR(36) NOT NULL,
              recipient_email VARCHAR(255) NOT NULL,
              recipient_name VARCHAR(255) DEFAULT NULL,
              batch_id CHAR(36) DEFAULT NULL,
              status VARCHAR(32) NOT NULL DEFAULT 'sent',
              sent_by CHAR(36) DEFAULT NULL,
              sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (id),
              INDEX idx_tsend_tt (timetable_id),
              INDEX idx_tsend_email (recipient_email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");
    } catch (Throwable $e) {
        error_log('[timetables] schema: ' . $e->getMessage());
    }
}

function timetablesAllowedRoles(): array
{
    return ['super_admin', 'admin', 'org', 'operational_manager'];
}

function timetablesRequireAccess(array $tokenData): void
{
    $role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));
    if (in_array($role, timetablesAllowedRoles(), true)) {
        return;
    }
    respond(['error' => 'Forbidden — Timetables access is restricted to Org Admin and Operational Manager'], 403);
}

/**
 * Resolve org logo for email HTML: prefer embedded data URI so preview/send
 * work even when /uploads is blocked from direct browser access.
 */
function timetablesResolveLogoForEmail(string $logoUrl): string
{
    $logo = trim($logoUrl);
    if ($logo === '') {
        return '';
    }
    if (str_starts_with($logo, 'data:image/')) {
        return $logo;
    }

    $path = $logo;
    if (preg_match('#^https?://#i', $logo)) {
        $parts = parse_url($logo);
        $path = is_array($parts) ? (string) ($parts['path'] ?? '') : '';
    }
    $uploadsIdx = strpos($path, '/uploads/');
    if ($uploadsIdx === false) {
        return preg_match('#^https?://#i', $logo) ? $logo : '';
    }
    $rawPath = substr($path, $uploadsIdx);
    if (strpos($rawPath, '..') !== false || !str_starts_with($rawPath, '/uploads/org_logos/')) {
        return '';
    }

    $relUploads = str_replace('/', DIRECTORY_SEPARATOR, $rawPath);
    // This file lives in api/lib/ — site root is two levels up (public/ or php-backend/).
    $siteRoot = dirname(__DIR__, 2);
    $apiDir = dirname(__DIR__);
    $candidates = [
        $siteRoot . $relUploads,
        $siteRoot . DIRECTORY_SEPARATOR . 'public' . $relUploads,
        $apiDir . DIRECTORY_SEPARATOR . 'uploads' . str_replace('/', DIRECTORY_SEPARATOR, substr($rawPath, strlen('/uploads'))),
        dirname($siteRoot) . DIRECTORY_SEPARATOR . 'public' . $relUploads,
        dirname($siteRoot) . DIRECTORY_SEPARATOR . 'php-backend' . $relUploads,
    ];
    $abs = null;
    foreach ($candidates as $candidate) {
        $resolved = realpath($candidate);
        if ($resolved !== false && is_file($resolved)) {
            $norm = str_replace('\\', '/', $resolved);
            if (strpos($norm, '/uploads/org_logos/') !== false) {
                $abs = $resolved;
                break;
            }
        }
    }

    $host = trim((string) ($_SERVER['HTTP_HOST'] ?? 'crm.syncpedia.in'));
    $publicUrl = 'https://' . $host . $rawPath;
    if ($abs === null) {
        return $publicUrl;
    }

    $bin = @file_get_contents($abs);
    if ($bin === false || $bin === '' || strlen($bin) > 400 * 1024) {
        return $publicUrl;
    }

    $mime = 'image/png';
    if (function_exists('mime_content_type')) {
        $detected = @mime_content_type($abs);
        if (is_string($detected) && str_starts_with($detected, 'image/')) {
            $mime = $detected;
        }
    } else {
        $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));
        $byExt = [
            'jpg' => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'webp' => 'image/webp',
            'svg' => 'image/svg+xml',
            'gif' => 'image/gif',
        ];
        if (isset($byExt[$ext])) {
            $mime = $byExt[$ext];
        }
    }
    return 'data:' . $mime . ';base64,' . base64_encode($bin);
}

/** @return array<string, mixed> */
function timetablesFetchOrgBranding(PDO $db, string $orgId): array
{
    ensureOrganizationsProfileColumn($db);
    $st = $db->prepare('SELECT name, logo_url, profile_json FROM organizations WHERE id = ? LIMIT 1');
    $st->execute([$orgId]);
    $row = $st->fetch(PDO::FETCH_ASSOC) ?: [];
    $profile = organizationsDecodeProfile(isset($row['profile_json']) ? (string) $row['profile_json'] : null);
    $parts = array_filter([
        trim((string) ($profile['street'] ?? '')),
        trim((string) ($profile['city'] ?? '')),
        trim((string) ($profile['postal_code'] ?? '')),
    ], static fn($p) => $p !== '');
    $address = implode(', ', $parts);
    if ($address === '') {
        $address = '4th Floor, Plot No 853, Road No 45, Madhapur, 500081';
    }
    $logo = timetablesResolveLogoForEmail(trim((string) ($row['logo_url'] ?? '')));
    return [
        'org_name' => trim((string) ($row['name'] ?? 'Syncpedia')) ?: 'Syncpedia',
        'logo_url' => $logo,
        'support_email' => trim((string) ($profile['support_email'] ?? 'info@syncpedia.in')) ?: 'info@syncpedia.in',
        'support_phone' => trim((string) ($profile['support_phone'] ?? '')) ?: '9032452123',
        'address' => $address,
    ];
}

function timetablesFormatTime12(string $time): string
{
    $ts = strtotime('1970-01-01 ' . trim($time));
    if ($ts === false) {
        return trim($time);
    }
    return date('g:i A', $ts);
}

function timetablesDayLabel(string $dateYmd): string
{
    $ts = strtotime($dateYmd . ' 12:00:00');
    if ($ts === false) {
        return strtoupper($dateYmd);
    }
    return strtoupper(date('l', $ts));
}

function timetablesShortDate(string $dateYmd): string
{
    $ts = strtotime($dateYmd . ' 12:00:00');
    if ($ts === false) {
        return $dateYmd;
    }
    return date('M j', $ts);
}

/**
 * Build poster-style HTML email (table layout for clients).
 *
 * @param list<array<string,mixed>> $sessions
 */
function timetablesBuildPosterHtml(array $branding, string $title, array $sessions): string
{
    $orgName = htmlspecialchars((string) ($branding['org_name'] ?? 'Syncpedia'), ENT_QUOTES, 'UTF-8');
    $logo = trim((string) ($branding['logo_url'] ?? ''));
    $address = htmlspecialchars((string) ($branding['address'] ?? ''), ENT_QUOTES, 'UTF-8');
    $email = htmlspecialchars((string) ($branding['support_email'] ?? ''), ENT_QUOTES, 'UTF-8');
    $phone = htmlspecialchars((string) ($branding['support_phone'] ?? ''), ENT_QUOTES, 'UTF-8');
    $titleSafe = htmlspecialchars($title !== '' ? $title : 'Offline Class Timetable', ENT_QUOTES, 'UTF-8');

    usort($sessions, static function ($a, $b) {
        $da = (string) ($a['session_date'] ?? '');
        $db = (string) ($b['session_date'] ?? '');
        if ($da !== $db) {
            return strcmp($da, $db);
        }
        return strcmp((string) ($a['start_time'] ?? ''), (string) ($b['start_time'] ?? ''));
    });

    /** @var array<string, list<array<string,mixed>>> $byDate */
    $byDate = [];
    foreach ($sessions as $s) {
        if (!is_array($s)) {
            continue;
        }
        $d = (string) ($s['session_date'] ?? '');
        if ($d === '') {
            continue;
        }
        $byDate[$d][] = $s;
    }

    $dayCards = '';
    foreach ($byDate as $dateYmd => $daySessions) {
        $dayLabel = htmlspecialchars(timetablesDayLabel($dateYmd), ENT_QUOTES, 'UTF-8');
        $dateShort = htmlspecialchars(timetablesShortDate($dateYmd), ENT_QUOTES, 'UTF-8');
        $blocks = '';
        foreach ($daySessions as $sess) {
            $course = htmlspecialchars(strtoupper(trim((string) ($sess['course_name'] ?? 'Session'))), ENT_QUOTES, 'UTF-8');
            $start = timetablesFormatTime12((string) ($sess['start_time'] ?? ''));
            $end = timetablesFormatTime12((string) ($sess['end_time'] ?? ''));
            $timeRange = htmlspecialchars(trim($start . ' - ' . $end), ENT_QUOTES, 'UTF-8');
            $blocks .= '
              <div style="margin-bottom:14px;text-align:center;">
                <div style="font-size:13px;font-weight:800;color:#111827;letter-spacing:0.06em;margin:8px 0 6px;">' . $course . '</div>
                <div style="width:36px;height:3px;background:#f97316;margin:0 auto 8px;border-radius:2px;"></div>
                <div style="font-size:12px;color:#374151;font-weight:600;">' . $timeRange . '</div>
              </div>';
        }
        $dayCards .= '
        <td style="vertical-align:top;padding:6px;width:25%;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#ffffff;">
            <tr>
              <td style="background:#f97316;color:#ffffff;font-weight:800;font-size:11px;letter-spacing:0.08em;text-align:center;padding:10px 6px;">'
                . $dayLabel . '<br><span style="font-weight:600;font-size:10px;opacity:0.95;">' . $dateShort . '</span></td>
            </tr>
            <tr>
              <td style="padding:16px 10px 14px;">' . $blocks . '</td>
            </tr>
          </table>
        </td>';
    }

    if ($dayCards === '') {
        $dayCards = '<td style="padding:24px;text-align:center;color:#6b7280;font-size:14px;">No sessions scheduled yet.</td>';
    }

    $logoBlock = $logo !== ''
        ? '<img src="' . htmlspecialchars($logo, ENT_QUOTES, 'UTF-8') . '" alt="' . $orgName . '" height="40" style="height:40px;max-width:180px;object-fit:contain;display:block;" />'
        : '<div style="font-size:22px;font-weight:900;color:#111827;letter-spacing:0.04em;">' . $orgName . '</div>';

    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#faf8f5;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">
        <tr>
          <td style="padding:28px 28px 8px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:top;">' . $logoBlock . '</td>
                <td style="width:80px;text-align:right;vertical-align:top;">
                  <div style="width:64px;height:64px;border-radius:999px;background:#f97316;margin-left:auto;display:inline-block;opacity:0.15;"></div>
                </td>
              </tr>
            </table>
            <div style="margin-top:18px;font-size:34px;line-height:1.05;font-weight:900;color:#111827;letter-spacing:-0.02em;">OFFLINE CLASS</div>
            <div style="font-size:34px;line-height:1.05;font-weight:900;color:#f97316;letter-spacing:-0.02em;">TIME TABLE</div>
            <div style="margin-top:6px;font-size:13px;color:#6b7280;font-weight:600;">' . $titleSafe . '</div>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 20px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' . $dayCards . '</tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 20px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e7eb;padding-top:20px;">
              <tr>
                <td style="width:33%;vertical-align:top;padding:8px;text-align:center;">
                  <div style="width:36px;height:36px;border-radius:999px;background:#f97316;margin:0 auto 8px;line-height:36px;color:#fff;font-size:16px;">📍</div>
                  <div style="font-size:10px;font-weight:800;color:#111827;letter-spacing:0.08em;">ADDRESS</div>
                  <div style="font-size:11px;color:#4b5563;margin-top:4px;line-height:1.45;">' . $address . '</div>
                </td>
                <td style="width:33%;vertical-align:top;padding:8px;text-align:center;">
                  <div style="width:36px;height:36px;border-radius:999px;background:#f97316;margin:0 auto 8px;line-height:36px;color:#fff;font-size:16px;">✉</div>
                  <div style="font-size:10px;font-weight:800;color:#111827;letter-spacing:0.08em;">EMAIL</div>
                  <div style="font-size:11px;color:#4b5563;margin-top:4px;">' . $email . '</div>
                </td>
                <td style="width:33%;vertical-align:top;padding:8px;text-align:center;">
                  <div style="width:36px;height:36px;border-radius:999px;background:#f97316;margin:0 auto 8px;line-height:36px;color:#fff;font-size:16px;">☎</div>
                  <div style="font-size:10px;font-weight:800;color:#111827;letter-spacing:0.08em;">CONTACT</div>
                  <div style="font-size:11px;color:#4b5563;margin-top:4px;">' . $phone . '</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>';
}

/** @return array<string,mixed>|null */
function timetablesFetchOne(PDO $db, array $tokenData, string $id): ?array
{
    $org = orgFilter($tokenData, 't', $db);
    $params = array_merge([$id], $org['params']);
    $st = $db->prepare("
        SELECT t.*, b.name AS batch_name, c.name AS course_name
        FROM timetables t
        LEFT JOIN batches b ON t.batch_id = b.id
        LEFT JOIN courses c ON t.course_id = c.id
        WHERE t.id = ? AND {$org['where']}
        LIMIT 1
    ");
    $st->execute($params);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/** @return list<array<string,mixed>> */
function timetablesFetchSessions(PDO $db, string $timetableId): array
{
    $st = $db->prepare('SELECT * FROM timetable_sessions WHERE timetable_id = ? ORDER BY session_date ASC, start_time ASC, sort_order ASC');
    $st->execute([$timetableId]);
    return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

/** @param list<array<string,mixed>> $sessionsInput */
function timetablesReplaceSessions(PDO $db, string $timetableId, array $sessionsInput): void
{
    $db->prepare('DELETE FROM timetable_sessions WHERE timetable_id = ?')->execute([$timetableId]);
    $ins = $db->prepare(
        'INSERT INTO timetable_sessions (id, timetable_id, session_date, course_id, course_name, start_time, end_time, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $order = 0;
    foreach ($sessionsInput as $s) {
        if (!is_array($s)) {
            continue;
        }
        $date = trim((string) ($s['session_date'] ?? ''));
        $start = trim((string) ($s['start_time'] ?? ''));
        $end = trim((string) ($s['end_time'] ?? ''));
        if ($date === '' || $start === '' || $end === '') {
            continue;
        }
        $courseName = trim((string) ($s['course_name'] ?? ''));
        $courseId = trim((string) ($s['course_id'] ?? ''));
        $ins->execute([
            generateUUID(),
            $timetableId,
            $date,
            $courseId !== '' ? $courseId : null,
            $courseName !== '' ? $courseName : 'Session',
            $start,
            $end,
            $order++,
        ]);
    }
}

function timetablesNormalizePeriod(string $periodType, string $anchorDate): array
{
    $periodType = strtolower(trim($periodType)) === 'month' ? 'month' : 'week';
    $ts = strtotime($anchorDate . ' 12:00:00');
    if ($ts === false) {
        respond(['error' => 'Invalid period_start date'], 400);
    }
    if ($periodType === 'month') {
        $start = date('Y-m-01', $ts);
        $end = date('Y-m-t', $ts);
    } else {
        $dow = (int) date('N', $ts);
        $monday = strtotime('-' . ($dow - 1) . ' days', $ts);
        $start = date('Y-m-d', $monday);
        $end = date('Y-m-d', strtotime('+6 days', $monday));
    }
    return ['period_type' => $periodType, 'period_start' => $start, 'period_end' => $end];
}

/** @return list<string> */
function timetablesDatesInPeriod(string $start, string $end): array
{
    $out = [];
    $cur = strtotime($start . ' 12:00:00');
    $endTs = strtotime($end . ' 12:00:00');
    if ($cur === false || $endTs === false) {
        return $out;
    }
    while ($cur <= $endTs) {
        $out[] = date('Y-m-d', $cur);
        $cur = strtotime('+1 day', $cur);
    }
    return $out;
}
