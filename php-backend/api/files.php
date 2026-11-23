<?php
/**
 * Authenticated download for private uploads (resumes, call recordings, form attachments).
 * Direct /uploads/* web access should remain denied via .htaccess.
 *
 * GET /api/files.php?path=/uploads/resumes/...
 */
require_once __DIR__ . '/helpers.php';
cors();

$db = (new Database())->getConnection();
$tokenData = verifyToken();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method !== 'GET') {
    respond(['error' => 'Method not allowed'], 405);
}

$rawPath = trim((string) ($_GET['path'] ?? ''));
if ($rawPath === '') {
    respond(['error' => 'path is required'], 400);
}
if ($rawPath[0] !== '/') {
    $rawPath = '/' . $rawPath;
}
if (strpos($rawPath, '..') !== false) {
    respond(['error' => 'Invalid path'], 400);
}
if (syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? '')) === 'assessment_viewer') {
    if (strpos($rawPath, '/uploads/assessment_answers/') !== 0) {
        respond(['error' => 'This account can only open assignment results'], 403);
    }
}

$allowedPrefixes = [
    '/uploads/resumes/',
    '/uploads/call_recordings/',
    '/uploads/form_attachments/',
    '/uploads/form_leads/',
    '/uploads/hr_resumes/',
    '/uploads/assessment_answers/',
    '/uploads/certificate_assets/',
    '/uploads/payment_proofs/',
    '/uploads/org_logos/',
    '/uploads/org_payment_qr/',
    '/uploads/recordings/',
    '/uploads/video_intros/',
];
$okPrefix = false;
foreach ($allowedPrefixes as $prefix) {
    if (strpos($rawPath, $prefix) === 0) {
        $okPrefix = true;
        break;
    }
}
if (!$okPrefix) {
    respond(['error' => 'Path not allowed'], 403);
}

$relUploads = str_replace('/', DIRECTORY_SEPARATOR, $rawPath);
$candidates = [
    dirname(__DIR__) . $relUploads,
    dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . str_replace('/', DIRECTORY_SEPARATOR, substr($rawPath, strlen('/uploads'))),
    dirname(__DIR__, 2) . $relUploads,
    dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'public' . $relUploads,
    dirname(__DIR__) . DIRECTORY_SEPARATOR . 'public' . $relUploads,
];

$abs = null;
foreach ($candidates as $candidate) {
    $resolved = realpath($candidate);
    if ($resolved === false || !is_file($resolved)) {
        continue;
    }
    $norm = str_replace('\\', '/', $resolved);
    if (strpos($norm, '/uploads/') === false) {
        continue;
    }
    $abs = $resolved;
    break;
}
$isCallRecordingPath = strpos($rawPath, '/uploads/call_recordings/') === 0
    || strpos($rawPath, '/uploads/recordings/') === 0;
// Call recordings may need basename / DB-path fallback before giving up.
if ($abs === null && !$isCallRecordingPath) {
    respond(['error' => 'File not found'], 404);
}

$userId = (string) ($tokenData['user_id'] ?? '');
$role = syncpediaNormalizeRoleKey((string) ($tokenData['role'] ?? ''));

if (strpos($rawPath, '/uploads/assessment_answers/') === 0) {
    $found = false;
    // Escape % and _ so a crafted path cannot wildcard-match someone else's answer file.
    $like = '%' . sqlLikeEscape($rawPath) . '%';
    try {
        if ($role === 'assessment_viewer') {
            ensureUsersResultAssessmentColumn($db);
            $mineStmt = $db->prepare(
                "SELECT result_assessment_id FROM users WHERE id = ? AND role = 'assessment_viewer' LIMIT 1"
            );
            $mineStmt->execute([$userId]);
            $mine = trim((string) ($mineStmt->fetchColumn() ?: ''));
            if ($mine !== '') {
                $st = $db->prepare(
                    "SELECT ans.id
                     FROM peaklyy_attempt_answers ans
                     INNER JOIN peaklyy_attempts att ON att.id = ans.attempt_id
                     WHERE ans.answer_json LIKE ? AND att.assessment_id = ?
                     LIMIT 1"
                );
                $st->execute([$like, $mine]);
                $found = (bool) $st->fetch(PDO::FETCH_ASSOC);
            }
        } elseif ($role === 'super_admin') {
            $st = $db->prepare(
                "SELECT id FROM peaklyy_attempt_answers
                 WHERE answer_json LIKE ? LIMIT 1"
            );
            $st->execute([$like]);
            $found = (bool) $st->fetch(PDO::FETCH_ASSOC);
        }
    } catch (Throwable $e) {
        $found = false;
    }
    if ($role !== 'super_admin' && $role !== 'assessment_viewer') {
        respond(['error' => 'Forbidden'], 403);
    }
    if (!$found) {
        respond(['error' => $role === 'assessment_viewer' ? 'Forbidden' : 'File not found'], $role === 'assessment_viewer' ? 403 : 404);
    }
} elseif (strpos($rawPath, '/uploads/call_recordings/') === 0 || strpos($rawPath, '/uploads/recordings/') === 0) {
    $log = null;
    $pathVariants = array_values(array_unique(array_filter([
        $rawPath,
        ltrim($rawPath, '/'),
        '/' . ltrim($rawPath, '/'),
    ], static fn ($p) => is_string($p) && $p !== '')));
    foreach ($pathVariants as $variant) {
        $st = $db->prepare('SELECT * FROM call_logs WHERE attachment_path = ? LIMIT 1');
        $st->execute([$variant]);
        $log = $st->fetch(PDO::FETCH_ASSOC) ?: null;
        if ($log) {
            break;
        }
    }
    if (!$log) {
        // Same file stored under a different folder prefix: match the exact file name only.
        // The name is escaped so % or _ in the request can never wildcard-match another
        // organisation's recording, and the match is re-checked in PHP.
        $baseName = basename($rawPath);
        if ($baseName !== '' && $baseName !== '.' && $baseName !== '..' && preg_match('/^[A-Za-z0-9._-]+$/', $baseName)) {
            try {
                $st = $db->prepare('SELECT * FROM call_logs WHERE attachment_path LIKE ? ORDER BY id DESC LIMIT 5');
                $st->execute(['%/' . sqlLikeEscape($baseName)]);
                foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $candidateLog) {
                    if (basename((string) ($candidateLog['attachment_path'] ?? '')) === $baseName) {
                        $log = $candidateLog;
                        break;
                    }
                }
            } catch (Throwable $e) {
                $log = null;
            }
        }
    }
    if (!$log) {
        respond(['error' => 'File not found'], 404);
    }
    // Prefer the DB path for disk lookup when basename match found a different stored path.
    $dbPath = trim((string) ($log['attachment_path'] ?? ''));
    if ($dbPath !== '' && $dbPath !== $rawPath) {
        if ($dbPath[0] !== '/') {
            $dbPath = '/' . $dbPath;
        }
        if (strpos($dbPath, '/uploads/') === 0) {
            $rawPath = $dbPath;
            $relUploads = str_replace('/', DIRECTORY_SEPARATOR, $rawPath);
            $candidates = [
                dirname(__DIR__) . $relUploads,
                dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . str_replace('/', DIRECTORY_SEPARATOR, substr($rawPath, strlen('/uploads'))),
                dirname(__DIR__, 2) . $relUploads,
                dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'public' . $relUploads,
                dirname(__DIR__) . DIRECTORY_SEPARATOR . 'public' . $relUploads,
            ];
            $abs = null;
            foreach ($candidates as $candidate) {
                $resolved = realpath($candidate);
                if ($resolved === false || !is_file($resolved)) {
                    continue;
                }
                $norm = str_replace('\\', '/', $resolved);
                if (strpos($norm, '/uploads/') === false) {
                    continue;
                }
                $abs = $resolved;
                break;
            }
        }
    }
    if ($abs === null) {
        // Last resort: find file by basename under recordings / call_recordings.
        $baseName = basename($rawPath);
        $searchRoots = [
            dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'recordings',
            dirname(__DIR__) . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'call_recordings',
        ];
        foreach ($searchRoots as $root) {
            if ($baseName === '' || !is_dir($root)) {
                continue;
            }
            try {
                $it = new RecursiveIteratorIterator(
                    new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)
                );
                foreach ($it as $fileInfo) {
                    if (!$fileInfo->isFile()) {
                        continue;
                    }
                    if (strcasecmp($fileInfo->getFilename(), $baseName) !== 0) {
                        continue;
                    }
                    $abs = $fileInfo->getPathname();
                    break 2;
                }
            } catch (Throwable $e) {
            }
        }
    }
    if ($abs === null) {
        respond(['error' => 'Recording file missing on disk'], 404);
    }
    if ($role !== 'super_admin') {
        // Default deny, same rules as the Call Log list: your own calls; org admins any call
        // in their organisation; managers calls by their team. Every other role: own only.
        $repId = trim((string) ($log['sales_rep_id'] ?? ''));
        $logOrg = trim((string) ($log['org_id'] ?? ''));
        $callerOrg = trim((string) (resolveCreatorOrgId($db, $tokenData) ?? ''));
        $sameOrg = $callerOrg !== '' && $logOrg !== '' && $logOrg === $callerOrg;
        $allowed = false;
        if ($repId !== '' && $repId === $userId) {
            $allowed = true;
        } elseif (in_array($role, ['admin', 'org'], true)) {
            $allowed = $sameOrg;
        } elseif ($role === 'manager') {
            $allowed = $sameOrg
                && in_array($repId, callLogsVisibleOrgMemberIds($db, $tokenData, $userId, $callerOrg), true);
        }
        if (!$allowed) {
            respond(['error' => 'Forbidden'], 403);
        }
    }
} elseif (strpos($rawPath, '/uploads/payment_proofs/') === 0) {
    $st = $db->prepare('SELECT * FROM manual_payments WHERE proof_path = ? LIMIT 1');
    $st->execute([$rawPath]);
    $mp = $st->fetch(PDO::FETCH_ASSOC);
    if (!$mp) {
        respond(['error' => 'File not found'], 404);
    }
    if ($role !== 'super_admin') {
        $submitter = (string) ($mp['submitted_by'] ?? '');
        $mpOrg = trim((string) ($mp['org_id'] ?? ''));
        $callerOrg = resolveCreatorOrgId($db, $tokenData);
        if ($submitter === $userId) {
            // owner ok
        } elseif (in_array($role, ['admin', 'org', 'operational_manager'], true)) {
            // Operational managers review and approve org manual payments, so they need the proof.
            if ($callerOrg === null || $callerOrg === '' || ($mpOrg !== '' && $mpOrg !== $callerOrg)) {
                respond(['error' => 'Forbidden'], 403);
            }
        } elseif ($role === 'manager') {
            $visible = hierarchyGetVisibleUserIds($db, $tokenData);
            if (!in_array($submitter, $visible, true)) {
                respond(['error' => 'Forbidden'], 403);
            }
            if ($callerOrg === null || $callerOrg === '' || ($mpOrg !== '' && $mpOrg !== $callerOrg)) {
                respond(['error' => 'Forbidden'], 403);
            }
        } else {
            respond(['error' => 'Forbidden'], 403);
        }
    }
} elseif (strpos($rawPath, '/uploads/certificate_assets/') === 0) {
    if (!certificateAssetAccessibleByUser($db, $tokenData, $rawPath)) {
        respond(['error' => 'Forbidden'], 403);
    }
} elseif (strpos($rawPath, '/uploads/org_logos/') === 0) {
    // Branding assets — any authenticated user may load (sidebar / company profile).
} elseif (strpos($rawPath, '/uploads/org_payment_qr/') === 0) {
    // Org payment QR — any authenticated user in session may view (Payment Records).
} elseif (
    strpos($rawPath, '/uploads/resumes/') === 0
    || strpos($rawPath, '/uploads/form_attachments/') === 0
    || strpos($rawPath, '/uploads/form_leads/') === 0
    || strpos($rawPath, '/uploads/hr_resumes/') === 0
) {
    // Always require a DB ownership row — never allow path-only downloads (IDOR / cross-tenant).
    $st = $db->prepare('SELECT * FROM leads WHERE resume_path = ? LIMIT 1');
    $st->execute([$rawPath]);
    $lead = $st->fetch(PDO::FETCH_ASSOC);

    $hrLead = null;
    if (!$lead) {
        try {
            $hst = $db->prepare('SELECT * FROM hr_leads WHERE resume_path = ? LIMIT 1');
            $hst->execute([$rawPath]);
            $hrLead = $hst->fetch(PDO::FETCH_ASSOC) ?: null;
        } catch (Throwable $e) {
            $hrLead = null;
        }
    }

    if ($lead) {
        if ($role !== 'super_admin' && !userCanUpdateLeadForCallLog($db, $tokenData, $userId, $role, $lead)) {
            $scope = tenantLeadsScopeSql($db, $tokenData, 'l');
            $chk = $db->prepare("SELECT l.id FROM leads l WHERE l.id = ?{$scope['sql']} LIMIT 1");
            $chk->execute(array_merge([(string) $lead['id']], $scope['params']));
            if (!$chk->fetch()) {
                respond(['error' => 'Forbidden'], 403);
            }
        }
    } elseif ($hrLead) {
        if ($role !== 'super_admin') {
            $hrOrg = trim((string) ($hrLead['org_id'] ?? ''));
            $callerOrg = resolveCreatorOrgId($db, $tokenData);
            $hrOwner = trim((string) ($hrLead['hr_id'] ?? $hrLead['assigned_to'] ?? ''));
            if ($role === 'hr') {
                if ($hrOwner !== '' && $hrOwner !== $userId) {
                    respond(['error' => 'Forbidden'], 403);
                }
                if ($callerOrg === null || $callerOrg === '' || ($hrOrg !== '' && $hrOrg !== $callerOrg)) {
                    respond(['error' => 'Forbidden'], 403);
                }
            } elseif (in_array($role, ['admin', 'org', 'manager'], true)) {
                if ($callerOrg === null || $callerOrg === '' || $hrOrg !== $callerOrg) {
                    respond(['error' => 'Forbidden'], 403);
                }
            } else {
                respond(['error' => 'Forbidden'], 403);
            }
        }
    } else {
        respond(['error' => 'File not found'], 404);
    }
}

if ($abs === null || !is_file((string) $abs)) {
    respond(['error' => 'File not found'], 404);
}

/**
 * Prefer real file content over wrong extensions (Android often labels AMR as .wav).
 */
function syncpediaSniffUploadMime(string $abs): ?string
{
    $fh = @fopen($abs, 'rb');
    if ($fh === false) {
        return null;
    }
    $head = fread($fh, 32);
    fclose($fh);
    if (!is_string($head) || strlen($head) < 4) {
        return null;
    }
    if (strncmp($head, 'RIFF', 4) === 0 && strlen($head) >= 12 && substr($head, 8, 4) === 'WAVE') {
        return 'audio/wav';
    }
    if (strncmp($head, '#!AMR', 5) === 0) {
        return 'audio/amr';
    }
    if (strncmp($head, 'OggS', 4) === 0) {
        return 'audio/ogg';
    }
    if (strncmp($head, 'fLaC', 4) === 0) {
        return 'audio/flac';
    }
    if (strncmp($head, 'ID3', 3) === 0) {
        return 'audio/mpeg';
    }
    $b0 = ord($head[0]);
    $b1 = ord($head[1]);
    if ($b0 === 0xFF && ($b1 & 0xE0) === 0xE0) {
        return 'audio/mpeg';
    }
    if (strlen($head) >= 12 && substr($head, 4, 4) === 'ftyp') {
        $brand = strtolower(substr($head, 8, 4));
        if (str_starts_with($brand, '3g') || in_array($brand, ['3gp4', '3gp5', '3g2a'], true)) {
            return 'audio/3gpp';
        }
        return 'audio/mp4';
    }
    if (strncmp($head, '%PDF', 4) === 0) {
        return 'application/pdf';
    }
    return null;
}

$mime = 'application/octet-stream';
$sniffed = syncpediaSniffUploadMime($abs);
if (is_string($sniffed) && $sniffed !== '') {
    $mime = $sniffed;
} elseif (function_exists('mime_content_type')) {
    $detected = @mime_content_type($abs);
    if (is_string($detected) && $detected !== '') {
        $mime = $detected;
    }
}
// Hosts often detect AMR/3GP/M4A as octet-stream — fix from extension as last resort.
if ($mime === 'application/octet-stream' || $mime === 'text/plain' || $mime === 'inode/x-empty') {
    $ext = strtolower(pathinfo($abs, PATHINFO_EXTENSION));
    $byExt = [
        'mp3' => 'audio/mpeg',
        'wav' => 'audio/wav',
        'ogg' => 'audio/ogg',
        'opus' => 'audio/ogg',
        'm4a' => 'audio/mp4',
        'mp4a' => 'audio/mp4',
        'aac' => 'audio/mp4',
        'mp4' => 'audio/mp4',
        'webm' => 'audio/webm',
        'amr' => 'audio/amr',
        '3gp' => 'audio/3gpp',
        '3gpp' => 'audio/3gpp',
        'flac' => 'audio/flac',
        'pdf' => 'application/pdf',
    ];
    if (isset($byExt[$ext])) {
        $mime = $byExt[$ext];
    }
}

// Real HTTP Range support (206 Partial Content). We used to advertise Accept-Ranges but
// always send the whole file, which Safari / iOS reject for <audio>, so recordings would
// not play or seek there. Cache privately for an hour instead of no-store so replays and
// seeks don't re-download the whole recording (the URL still needs the login cookie).
$size = (int) filesize($abs);
$start = 0;
$end = $size - 1;
$partial = false;
$rangeHeader = (string) ($_SERVER['HTTP_RANGE'] ?? '');
if ($size > 0 && preg_match('/^bytes=(\d*)-(\d*)$/', trim($rangeHeader), $rm)) {
    if ($rm[1] === '' && $rm[2] !== '') {
        // "bytes=-N": the last N bytes
        $start = max(0, $size - (int) $rm[2]);
    } else {
        $start = (int) $rm[1];
        if ($rm[2] !== '') {
            $end = min((int) $rm[2], $size - 1);
        }
    }
    if ($start > $end || $start >= $size) {
        if (ob_get_level() > 0) {
            @ob_end_clean();
        }
        http_response_code(416);
        header('Content-Range: bytes */' . $size);
        exit;
    }
    $partial = true;
}

while (ob_get_level() > 0) {
    @ob_end_clean();
}
header('Content-Type: ' . $mime);
header('X-Content-Type-Options: nosniff');
header('Content-Disposition: inline; filename="' . basename($abs) . '"');
header('Accept-Ranges: bytes');
header_remove('Pragma');
header('Cache-Control: private, max-age=3600');
if ($partial) {
    http_response_code(206);
    header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
}
$length = $end - $start + 1;
header('Content-Length: ' . (string) max(0, $length));

$fh = @fopen($abs, 'rb');
if ($fh === false) {
    http_response_code(500);
    exit;
}
if ($start > 0) {
    fseek($fh, $start);
}
$remaining = $length;
while ($remaining > 0 && !feof($fh)) {
    $chunk = fread($fh, (int) min(65536, $remaining));
    if ($chunk === false || $chunk === '') {
        break;
    }
    echo $chunk;
    $remaining -= strlen($chunk);
    flush();
}
fclose($fh);
exit;
