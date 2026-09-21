<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/lib/PeaklyyQuestions.php';
require_once __DIR__ . '/lib/SyncpediaFresherBasics.php';
cors();

$db = (new Database())->getConnection();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';
$input = getInput();

function peaklyyEnsureTables(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $files = [
        __DIR__ . '/../migrations/peaklyy_assessments_2026_07_22.sql',
        __DIR__ . '/../../php-backend/migrations/peaklyy_assessments_2026_07_22.sql',
        __DIR__ . '/../migrations/peaklyy_custom_questions_2026_07_22.sql',
        __DIR__ . '/../../php-backend/migrations/peaklyy_custom_questions_2026_07_22.sql',
    ];
    foreach ($files as $migration) {
        if (!is_readable($migration)) {
            continue;
        }
        $sql = file_get_contents($migration);
        foreach (array_filter(array_map('trim', explode(';', (string) $sql))) as $stmt) {
            if ($stmt === '' || str_starts_with($stmt, '--')) {
                continue;
            }
            try {
                $db->exec($stmt);
            } catch (Throwable $e) {
                // ignore already-exists / unsupported IF NOT EXISTS variants
            }
        }
    }
    try {
        $db->exec("ALTER TABLE peaklyy_assessments ADD COLUMN source_mode VARCHAR(20) NOT NULL DEFAULT 'domain_bank'");
    } catch (Throwable $e) {
        // column exists
    }
    try {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS peaklyy_assessment_questions (
              id CHAR(36) PRIMARY KEY,
              assessment_id CHAR(36) NOT NULL,
              q_type ENUM('mcq','task') NOT NULL DEFAULT 'mcq',
              prompt TEXT NOT NULL,
              options_json JSON NULL,
              correct_option CHAR(1) NULL,
              task_schema_json JSON NULL,
              points INT NOT NULL DEFAULT 5,
              sort_order INT NOT NULL DEFAULT 0,
              is_active TINYINT(1) NOT NULL DEFAULT 1,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_peaklyy_aq_assess (assessment_id, is_active, sort_order)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
    } catch (Throwable $e) {
        // exists
    }
    try {
        $db->exec("ALTER TABLE peaklyy_attempts ADD COLUMN attempt_phase VARCHAR(20) NOT NULL DEFAULT 'mcq'");
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_attempts ADD COLUMN mcq_questions_json JSON NULL');
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_attempts ADD COLUMN task_questions_json JSON NULL');
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_attempts ADD COLUMN timeline_json JSON NULL');
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_attempts ADD COLUMN mcq_submitted_at DATETIME NULL');
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_attempts ADD COLUMN graduation_year VARCHAR(20) NULL');
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_attempts ADD COLUMN interest_selected_json JSON NULL');
    } catch (Throwable $e) {
    }
    try {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS peaklyy_assessment_assignments (
              id CHAR(36) PRIMARY KEY,
              assessment_id VARCHAR(64) NOT NULL,
              user_id VARCHAR(64) NOT NULL,
              assigned_by VARCHAR(64) NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uq_paa_assess_user (assessment_id, user_id),
              INDEX idx_paa_user (user_id),
              INDEX idx_paa_assess (assessment_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_assessment_assignments MODIFY assessment_id VARCHAR(64) NOT NULL');
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_assessment_assignments MODIFY user_id VARCHAR(64) NOT NULL');
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_assessment_assignments MODIFY assigned_by VARCHAR(64) NULL');
    } catch (Throwable $e) {
    }
    try {
        $db->exec("ALTER TABLE peaklyy_assessments ADD COLUMN ui_theme VARCHAR(32) NOT NULL DEFAULT 'peaklyy'");
    } catch (Throwable $e) {
    }
    $done = true;
}

function peaklyyIsSystemAssignmentSlug(string $slug): bool
{
    $s = strtolower(trim($slug));
    return $s === 'syncpedia-fresher-basics' || $s === 'syncpedia-assignment';
}

function peaklyyEnsureApiKeys(PDO $db): void
{
    try {
        $q = $db->query("SELECT id, slug FROM peaklyy_assessments WHERE result_api_key IS NULL OR result_api_key = ''");
        if (!$q) {
            return;
        }
        $rows = $q->fetchAll(PDO::FETCH_ASSOC);
        if (!$rows) {
            return;
        }
        $upd = $db->prepare('UPDATE peaklyy_assessments SET result_api_key = ? WHERE id = ?');
        foreach ($rows as $r) {
            $upd->execute([peaklyyGenerateApiKey(), $r['id']]);
        }
    } catch (Throwable $e) {
        error_log('[assessments] ensure api keys: ' . $e->getMessage());
    }
}

function peaklyyInsertCustomQuestions(PDO $db, string $assessmentId, array $questions): int
{
    $ins = $db->prepare(
        'INSERT INTO peaklyy_assessment_questions
         (id, assessment_id, q_type, prompt, options_json, correct_option, task_schema_json, points, sort_order, is_active)
         VALUES (?,?,?,?,?,?,?,?,?,1)'
    );
    $n = 0;
    foreach ($questions as $i => $q) {
        if (!is_array($q)) {
            continue;
        }
        $prompt = trim((string) ($q['prompt'] ?? ''));
        if ($prompt === '') {
            continue;
        }
        $type = strtolower(trim((string) ($q['q_type'] ?? 'mcq')));
        if (!in_array($type, ['mcq', 'task'], true)) {
            $type = 'mcq';
        }
        $allowNotepad = !empty($q['allow_notepad']) || $type === 'task' || !empty($q['notepad']);
        $allowUpload = !empty($q['allow_upload']) || !empty($q['upload']);
        // Explicit response_mode from admin UI
        $mode = strtolower(trim((string) ($q['response_mode'] ?? '')));
        if ($mode === 'notepad') {
            $type = 'task';
            $allowNotepad = true;
            $allowUpload = false;
        } elseif ($mode === 'upload') {
            $type = 'task';
            $allowNotepad = false;
            $allowUpload = true;
        } elseif ($mode === 'notepad_upload') {
            $type = 'task';
            $allowNotepad = true;
            $allowUpload = true;
        } elseif ($mode === 'mcq') {
            $type = 'mcq';
        }
        if ($type === 'task' && !$allowNotepad && !$allowUpload) {
            $allowNotepad = true;
        }

        $options = null;
        $correct = null;
        $points = max(0, (int) ($q['points'] ?? ($type === 'task' ? 0 : 5)));
        $schema = [
            'allow_notepad' => (bool) $allowNotepad,
            'allow_upload' => (bool) $allowUpload,
        ];
        $dk = trim((string) ($q['domain_key'] ?? ''));
        if ($dk !== '') {
            $schema['domain_key'] = $dk;
        }
        $diff = trim((string) ($q['difficulty'] ?? ''));
        if ($diff !== '') {
            $schema['difficulty'] = $diff;
        }

        if ($type === 'mcq') {
            $options = $q['options'] ?? null;
            if (!is_array($options)) {
                $options = [
                    'a' => (string) ($q['option_a'] ?? ''),
                    'b' => (string) ($q['option_b'] ?? ''),
                    'c' => (string) ($q['option_c'] ?? ''),
                    'd' => (string) ($q['option_d'] ?? ''),
                ];
            }
            $correct = strtolower(trim((string) ($q['correct_option'] ?? 'a')));
            if (!in_array($correct, ['a', 'b', 'c', 'd'], true)) {
                $correct = 'a';
            }
            if (trim((string) ($options['a'] ?? '')) === '' || trim((string) ($options['b'] ?? '')) === '') {
                continue;
            }
            // MCQ can optionally allow an extra file upload
            $schema['allow_notepad'] = false;
            $schema['allow_upload'] = (bool) $allowUpload;
            if ($points < 1) {
                $points = 5;
            }
        } else {
            $options = null;
            $correct = null;
        }

        $ins->execute([
            generateUUID(),
            $assessmentId,
            $type,
            $prompt,
            $options ? json_encode($options, JSON_UNESCAPED_UNICODE) : null,
            $correct,
            json_encode($schema, JSON_UNESCAPED_UNICODE),
            $points,
            (int) ($q['sort_order'] ?? ($i + 1)),
        ]);
        $n++;
    }
    return $n;
}

function peaklyyQuestionStoredDomainKey(array $row): string
{
    $schema = $row['task_schema_json'] ?? null;
    if (is_string($schema)) {
        $schema = json_decode($schema, true);
    }
    if (is_array($schema) && !empty($schema['domain_key'])) {
        return trim((string) $schema['domain_key']);
    }
    return trim((string) ($row['domain_key'] ?? ''));
}

function peaklyyPickCustomQuestions(PDO $db, string $assessmentId, int $count, ?string $domainKey = null): array
{
    $stmt = $db->prepare(
        "SELECT * FROM peaklyy_assessment_questions
         WHERE assessment_id = ? AND is_active = 1
         ORDER BY sort_order ASC"
    );
    $stmt->execute([$assessmentId]);
    $all = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (!$all) {
        return [];
    }
    $domainKey = $domainKey !== null ? trim($domainKey) : '';
    if ($domainKey !== '' && $domainKey !== 'custom') {
        $filtered = [];
        foreach ($all as $row) {
            if (peaklyyQuestionStoredDomainKey($row) === $domainKey) {
                $filtered[] = $row;
            }
        }
        $all = $filtered;
    }
    foreach ($all as &$row) {
        $stored = peaklyyQuestionStoredDomainKey($row);
        $row['domain_key'] = $stored !== '' ? $stored : ($domainKey !== '' ? $domainKey : 'custom');
        $row['level_key'] = 'custom';
    }
    unset($row);
    if ($count > 0 && count($all) > $count) {
        return array_slice($all, 0, $count);
    }
    return $all;
}

/** Resolve notepad/upload flags for a public question. */
function peaklyyQuestionResponseFlags(array $row, ?array $schema = null): array
{
    $qType = strtolower((string) ($row['q_type'] ?? 'mcq'));
    if ($schema === null) {
        $schema = $row['task_schema_json'] ?? null;
        if (is_string($schema)) {
            $schema = json_decode($schema, true);
        }
    }
    if (!is_array($schema)) {
        $schema = [];
    }
    $allowNotepad = array_key_exists('allow_notepad', $schema)
        ? !empty($schema['allow_notepad'])
        : ($qType === 'task');
    $allowUpload = array_key_exists('allow_upload', $schema)
        ? !empty($schema['allow_upload'])
        : ($qType === 'task');
    return [
        'allow_notepad' => (bool) $allowNotepad,
        'allow_upload' => (bool) $allowUpload,
    ];
}

function peaklyyLoadScoringRows(PDO $db, array $ids): array
{
    $bank = [];
    if (!$ids) {
        return $bank;
    }
    $in = implode(',', array_fill(0, count($ids), '?'));
    $b = $db->prepare("SELECT * FROM peaklyy_question_bank WHERE id IN ($in)");
    $b->execute($ids);
    foreach ($b->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $bank[$row['id']] = $row;
    }
    $c = $db->prepare("SELECT * FROM peaklyy_assessment_questions WHERE id IN ($in)");
    $c->execute($ids);
    foreach ($c->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $bank[$row['id']] = $row;
    }
    return $bank;
}

function peaklyySeedBank(PDO $db): void
{
    $defs = peaklyyQuestionDefinitions();
    $expected = count($defs);
    $activeCount = 0;
    $newDomainCount = 0;
    try {
        $activeCount = (int) $db->query('SELECT COUNT(*) FROM peaklyy_question_bank WHERE is_active = 1')->fetchColumn();
        $newDomainCount = (int) $db->query(
            "SELECT COUNT(*) FROM peaklyy_question_bank WHERE domain_key = 'java' AND is_active = 1"
        )->fetchColumn();
    } catch (Throwable $e) {
        return;
    }
    // Already on current bank (MCQs + tasks)
    if ($activeCount === $expected && $newDomainCount > 0) {
        return;
    }

    // Never hard-delete bank rows while attempts are open — in-flight scoring uses frozen IDs.
    $openAttempts = 0;
    try {
        $openAttempts = (int) $db->query(
            "SELECT COUNT(*) FROM peaklyy_attempts WHERE status IN ('registered','in_progress')"
        )->fetchColumn();
    } catch (Throwable $e) {
        $openAttempts = 0;
    }
    if ($openAttempts > 0) {
        error_log('[peaklyy] skip question bank reseed: ' . $openAttempts . ' open attempt(s)');
        return;
    }

    // Soft-deactivate old rows, then insert the new bank (keeps historical IDs for submitted attempts).
    try {
        $db->exec('UPDATE peaklyy_question_bank SET is_active = 0');
    } catch (Throwable $e) {
        return;
    }

    $ins = $db->prepare(
        'INSERT INTO peaklyy_question_bank
         (id, domain_key, level_key, q_type, prompt, options_json, correct_option, task_schema_json, points, sort_order, is_active)
         VALUES (?,?,?,?,?,?,?,?,?,?,1)'
    );
    foreach ($defs as $q) {
        $ins->execute([
            generateUUID(),
            $q['domain_key'],
            $q['level_key'],
            $q['q_type'],
            $q['prompt'],
            $q['options'] ? json_encode($q['options'], JSON_UNESCAPED_UNICODE) : null,
            $q['correct_option'],
            $q['task_schema'] ? json_encode($q['task_schema'], JSON_UNESCAPED_UNICODE) : null,
            (int) $q['points'],
            (int) $q['sort_order'],
        ]);
    }
}

/** Domain-bank assessments: 15 beginner MCQs + 1 task, untimed (duration 0). */
function peaklyyNormalizeDomainAssessments(PDO $db): void
{
    $qCount = (int) peaklyyDomainQuestionCount();
    try {
        $db->exec(
            "UPDATE peaklyy_assessments
             SET duration_minutes = 0, question_count = {$qCount}
             WHERE COALESCE(source_mode, 'domain_bank') = 'domain_bank'"
        );
    } catch (Throwable $e) {
        try {
            $db->exec("UPDATE peaklyy_assessments SET duration_minutes = 0, question_count = {$qCount}");
        } catch (Throwable $e2) {
        }
    }
}

function peaklyyGenerateApiKey(): string
{
    return 'pkly_' . bin2hex(random_bytes(24));
}

function peaklyyPublicBase(): string
{
    if (defined('CRM_PUBLIC_URL') && CRM_PUBLIC_URL !== '') {
        return rtrim((string) CRM_PUBLIC_URL, '/');
    }
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    return $host !== '' ? ($scheme . '://' . $host) : '';
}

function peaklyyOpenUrl(string $slug, string $apiKey): string
{
    $base = peaklyyPublicBase();
    // Fragment keeps the key out of access logs / Referer (SPA reads hash → sends X-Assessment-Api-Key).
    $path = '/assessment/' . rawurlencode($slug) . ($apiKey !== '' ? ('#key=' . rawurlencode($apiKey)) : '');
    return $base !== '' ? ($base . $path) : $path;
}

/**
 * Append a timeline event on an attempt (best-effort).
 * @param array<string,mixed> $detail
 */
function peaklyyAppendTimeline(PDO $db, string $attemptId, string $event, string $label, array $detail = []): void
{
    try {
        $stmt = $db->prepare('SELECT timeline_json FROM peaklyy_attempts WHERE id = ? LIMIT 1');
        $stmt->execute([$attemptId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return;
        }
        $events = [];
        if (!empty($row['timeline_json'])) {
            $decoded = json_decode((string) $row['timeline_json'], true);
            if (is_array($decoded)) {
                $events = $decoded;
            }
        }
        foreach ($events as $existing) {
            if (is_array($existing) && ($existing['event'] ?? '') === $event) {
                return; // keep first occurrence of each event type
            }
        }
        $events[] = [
            'at' => date('c'),
            'event' => $event,
            'label' => $label,
            'detail' => $detail ?: null,
        ];
        $db->prepare('UPDATE peaklyy_attempts SET timeline_json = ? WHERE id = ?')->execute([
            json_encode($events, JSON_UNESCAPED_UNICODE),
            $attemptId,
        ]);
    } catch (Throwable $e) {
        // column may not exist yet on older DBs
    }
}

/**
 * Build a display timeline from stored events + timestamp fallbacks.
 * @return list<array{at:?string,event:string,label:string,detail?:mixed}>
 */
function peaklyyBuildAttemptTimeline(array $attempt): array
{
    $events = [];
    if (!empty($attempt['timeline_json'])) {
        $decoded = is_string($attempt['timeline_json'])
            ? json_decode((string) $attempt['timeline_json'], true)
            : $attempt['timeline_json'];
        if (is_array($decoded)) {
            foreach ($decoded as $e) {
                if (!is_array($e)) {
                    continue;
                }
                $events[] = [
                    'at' => $e['at'] ?? null,
                    'event' => (string) ($e['event'] ?? ''),
                    'label' => (string) ($e['label'] ?? ($e['event'] ?? 'Event')),
                    'detail' => $e['detail'] ?? null,
                ];
            }
        }
    }
    if ($events) {
        return $events;
    }
    // Legacy fallback from columns
    $fallback = [];
    if (!empty($attempt['created_at'])) {
        $fallback[] = ['at' => $attempt['created_at'], 'event' => 'registered', 'label' => 'Registered', 'detail' => null];
    }
    if (!empty($attempt['started_at'])) {
        $fallback[] = ['at' => $attempt['started_at'], 'event' => 'started', 'label' => 'Assignment started', 'detail' => null];
    }
    if (!empty($attempt['mcq_submitted_at'])) {
        $fallback[] = [
            'at' => $attempt['mcq_submitted_at'],
            'event' => 'mcq_submitted',
            'label' => 'Part 1 MCQ submitted',
            'detail' => [
                'score' => $attempt['score'] ?? null,
                'stars' => $attempt['stars'] ?? null,
                'passed' => $attempt['passed'] ?? null,
            ],
        ];
    }
    if (!empty($attempt['submitted_at']) && in_array(strtolower((string) ($attempt['attempt_phase'] ?? '')), ['done', 'task', ''], true)) {
        $phase = strtolower((string) ($attempt['attempt_phase'] ?? ''));
        if ($phase === 'done' || ($attempt['status'] ?? '') === 'submitted') {
            $fallback[] = [
                'at' => $attempt['submitted_at'],
                'event' => 'completed',
                'label' => $phase === 'done' || !empty($attempt['mcq_submitted_at'])
                    ? 'Part 2 tasks submitted / completed'
                    : 'Assignment submitted',
                'detail' => null,
            ];
        }
    }
    if (!empty($attempt['webhook_sent_at'])) {
        $fallback[] = [
            'at' => $attempt['webhook_sent_at'],
            'event' => 'webhook',
            'label' => 'Results webhook sent',
            'detail' => ['status' => $attempt['webhook_status'] ?? null],
        ];
    }
    return $fallback;
}

function peaklyyTimelineToText(array $timeline): string
{
    $parts = [];
    foreach ($timeline as $e) {
        $at = (string) ($e['at'] ?? '');
        $label = (string) ($e['label'] ?? $e['event'] ?? '');
        $parts[] = trim($at . ' — ' . $label);
    }
    return implode(' | ', $parts);
}

/** Assessment API key from header only (never query/body — avoids access-log leakage). */
function peaklyyRequestApiKey(): string
{
    $key = trim((string) ($_SERVER['HTTP_X_ASSESSMENT_API_KEY'] ?? ''));
    if ($key !== '') {
        return $key;
    }
    $key = trim((string) ($_SERVER['HTTP_X_PEAKLYY_API_KEY'] ?? ''));
    if ($key !== '') {
        return $key;
    }
    $key = trim((string) ($_SERVER['HTTP_X_API_KEY'] ?? ''));
    if ($key !== '') {
        return $key;
    }
    $auth = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (preg_match('/^\s*Bearer\s+(\S+)/i', $auth, $m)) {
        return trim($m[1]);
    }
    return '';
}

function peaklyyLeadSourceKey(string $assessmentId): string
{
    return 'peaklyy:' . $assessmentId;
}

function peaklyyResolveLeadOrgId(PDO $db, array $assessment): ?string
{
    $creatorId = (string) ($assessment['created_by'] ?? '');
    return resolveCreatorOrgId($db, [
        'user_id' => $creatorId,
        'role' => 'super_admin',
        'org_id' => null,
    ]);
}

function peaklyyLeadTagsList($raw): array
{
    if (is_string($raw)) {
        $decoded = json_decode($raw, true);
        $raw = is_array($decoded) ? $decoded : [];
    }
    if (!is_array($raw)) {
        return [];
    }
    $out = [];
    $isList = array_keys($raw) === range(0, count($raw) - 1);
    if ($isList) {
        foreach ($raw as $t) {
            if (is_string($t) || is_numeric($t)) {
                $out[] = (string) $t;
            }
        }
        return $out;
    }
    foreach ($raw as $k => $v) {
        if (is_string($k) && !is_numeric($k)) {
            $out[] = $k . ':' . (is_scalar($v) ? (string) $v : json_encode($v));
        } elseif (is_string($v) || is_numeric($v)) {
            $out[] = (string) $v;
        }
    }
    return $out;
}

function peaklyyTagValue(array $tags, string $prefix): ?string
{
    foreach ($tags as $t) {
        $t = (string) $t;
        if (str_starts_with($t, $prefix)) {
            return substr($t, strlen($prefix));
        }
    }
    return null;
}

function peaklyyTagSet(array $tags, string $prefix, string $value): array
{
    $out = [];
    $found = false;
    foreach ($tags as $t) {
        $t = (string) $t;
        if (str_starts_with($t, $prefix)) {
            $out[] = $prefix . $value;
            $found = true;
        } else {
            $out[] = $t;
        }
    }
    if (!$found) {
        $out[] = $prefix . $value;
    }
    return $out;
}

function peaklyyFindAssessmentLead(PDO $db, ?string $orgId, string $source, string $email): ?array
{
    $email = strtolower(trim($email));
    if ($email === '' || $source === '') {
        return null;
    }
    if ($orgId) {
        $st = $db->prepare(
            'SELECT * FROM leads WHERE org_id = ? AND source = ? AND email IS NOT NULL AND LOWER(TRIM(email)) = ? LIMIT 1'
        );
        $st->execute([$orgId, $source, $email]);
    } else {
        $st = $db->prepare(
            'SELECT * FROM leads WHERE source = ? AND email IS NOT NULL AND LOWER(TRIM(email)) = ? LIMIT 1'
        );
        $st->execute([$source, $email]);
    }
    $row = $st->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/**
 * First attempt for this email + assessment → create lead.
 * Later attempts → increment peaklyy_attempts tag only (no new lead).
 */
function peaklyyUpsertLeadFromRegister(PDO $db, array $assessment, array $candidate): ?string
{
    ensureLeadsSourceColumnVarchar($db);
    ensureLeadsCreatedByColumn($db);
    $orgId = peaklyyResolveLeadOrgId($db, $assessment);
    $assessmentId = (string) ($assessment['id'] ?? '');
    $source = peaklyyLeadSourceKey($assessmentId);
    $email = strtolower(trim((string) ($candidate['email'] ?? '')));
    $phone = preg_replace('/\D+/', '', (string) ($candidate['phone'] ?? '')) ?: '';
    $name = trim((string) ($candidate['full_name'] ?? ''));
    if ($assessmentId === '' || $email === '' || $name === '') {
        return null;
    }
    $title = trim((string) ($assessment['title'] ?? 'Peaklyy Assignment')) ?: 'Peaklyy Assignment';
    $slug = (string) ($assessment['slug'] ?? '');
    $domain = (string) ($candidate['domain_key'] ?? '');
    $degree = trim((string) ($candidate['degree_branch'] ?? ''));
    $college = trim((string) ($candidate['college_name'] ?? ''));
    $domainLabel = peaklyyDomainCatalog()[$domain] ?? ($domain === 'custom' ? 'Custom' : $domain);
    $existing = peaklyyFindAssessmentLead($db, $orgId, $source, $email);
    if ($existing) {
        $tags = peaklyyLeadTagsList($existing['tags'] ?? []);
        $attempts = max(1, (int) (peaklyyTagValue($tags, 'peaklyy_attempts:') ?? '1')) + 1;
        $tags = peaklyyTagSet($tags, 'peaklyy_attempts:', (string) $attempts);
        $tags = peaklyyTagSet($tags, 'peaklyy_title:', $title);
        $tags = peaklyyTagSet($tags, 'peaklyy_slug:', $slug);
        $tags = peaklyyTagSet($tags, 'peaklyy_id:', $assessmentId);
        $tags = peaklyyTagSet($tags, 'peaklyy_domain:', $domain);
        if (!in_array('peaklyy', $tags, true)) {
            $tags[] = 'peaklyy';
        }
        $notes = trim((string) ($existing['notes'] ?? ''));
        $line = 'Attempt #' . $attempts . ' · ' . $domainLabel . ($degree !== '' ? ' · ' . $degree : '');
        $notes = $notes === '' ? $line : ($notes . "\n" . $line);
        $db->prepare('UPDATE leads SET tags = ?, notes = ?, updated_at = NOW() WHERE id = ?')->execute([
            json_encode(array_values($tags), JSON_UNESCAPED_UNICODE),
            $notes,
            $existing['id'],
        ]);
        return (string) $existing['id'];
    }
    $leadId = generateUUID();
    $tags = [
        'peaklyy',
        'peaklyy_id:' . $assessmentId,
        'peaklyy_slug:' . $slug,
        'peaklyy_title:' . $title,
        'peaklyy_attempts:1',
        'peaklyy_domain:' . $domain,
    ];
    $notes = 'Peaklyy assessment · ' . $title . "\nDomain: " . $domainLabel
        . ($degree !== '' ? "\nDegree: " . $degree : '')
        . ($college !== '' ? "\nCollege: " . $college : '')
        . "\nAttempts: 1";
    $createdBy = (string) ($assessment['created_by'] ?? '') ?: null;
    $nameSafe = mb_substr($name, 0, 100);
    $phoneSafe = $phone !== '' ? mb_substr($phone, 0, 20) : null;
    $collegeSafe = $college !== '' ? mb_substr($college, 0, 200) : null;
    $courseSafe = $domainLabel !== '' ? mb_substr($domainLabel, 0, 255) : null;
    $params = [
        $leadId,
        $nameSafe,
        $email,
        $phoneSafe,
        $collegeSafe,
        $courseSafe,
        $source,
        $notes,
        json_encode($tags, JSON_UNESCAPED_UNICODE),
        $orgId,
        $createdBy,
    ];
    try {
        $db->prepare(
            'INSERT INTO leads (id, name, email, phone, college, course_interest, source, status, notes, tags, org_id, created_by, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,\'new\',?,?,?,?,NOW(),NOW())'
        )->execute($params);
    } catch (Throwable $e) {
        // Retry without created_by if FK fails
        $db->prepare(
            'INSERT INTO leads (id, name, email, phone, college, course_interest, source, status, notes, tags, org_id, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,\'new\',?,?,?,NOW(),NOW())'
        )->execute([
            $leadId,
            $nameSafe,
            $email,
            $phoneSafe,
            $collegeSafe,
            $courseSafe,
            $source,
            $notes,
            json_encode($tags, JSON_UNESCAPED_UNICODE),
            $orgId,
        ]);
    }
    return $leadId;
}

function peaklyyUpdateLeadOnSubmit(PDO $db, array $assessment, array $attempt, int $score, int $stars, int $passed): void
{
    ensureLeadsSourceColumnVarchar($db);
    $orgId = peaklyyResolveLeadOrgId($db, $assessment);
    $source = peaklyyLeadSourceKey((string) ($assessment['id'] ?? ''));
    $email = strtolower(trim((string) ($attempt['email'] ?? '')));
    $lead = peaklyyFindAssessmentLead($db, $orgId, $source, $email);
    if (!$lead) {
        return;
    }
    $tags = peaklyyLeadTagsList($lead['tags'] ?? []);
    $tags = peaklyyTagSet($tags, 'peaklyy_score:', (string) $score);
    $tags = peaklyyTagSet($tags, 'peaklyy_stars:', (string) $stars);
    $tags = peaklyyTagSet($tags, 'peaklyy_passed:', $passed ? '1' : '0');
    $line = 'Latest result: score ' . $score . ' · ' . $stars . '★ · ' . ($passed ? 'PASS' : 'FAIL');
    $notes = trim((string) ($lead['notes'] ?? ''));
    $notes = $notes === '' ? $line : ($notes . "\n" . $line);
    try {
        $db->prepare('UPDATE leads SET score = ?, notes = ?, tags = ?, updated_at = NOW() WHERE id = ?')->execute([
            $score,
            $notes,
            json_encode(array_values($tags), JSON_UNESCAPED_UNICODE),
            $lead['id'],
        ]);
    } catch (Throwable $e) {
        $db->prepare('UPDATE leads SET notes = ?, tags = ?, updated_at = NOW() WHERE id = ?')->execute([
            $notes,
            json_encode(array_values($tags), JSON_UNESCAPED_UNICODE),
            $lead['id'],
        ]);
    }
}

function peaklyyStars(int $score): int
{
    if ($score >= 100) {
        return 4;
    }
    if ($score >= 90) {
        return 3;
    }
    if ($score >= 80) {
        return 2;
    }
    if ($score >= 70) {
        return 1;
    }
    return 0;
}

function peaklyyPublicQuestion(array $row): array
{
    $options = $row['options_json'] ?? null;
    if (is_string($options)) {
        $options = json_decode($options, true);
    }
    $qType = strtolower((string) ($row['q_type'] ?? 'mcq'));
    if (!in_array($qType, ['mcq', 'task'], true)) {
        $qType = 'mcq';
    }
    $schema = $row['task_schema_json'] ?? null;
    if (is_string($schema)) {
        $schema = json_decode($schema, true);
    }
    if (!is_array($schema)) {
        $schema = [];
    }
    $flags = peaklyyQuestionResponseFlags($row, $schema);
    $schema['allow_notepad'] = $flags['allow_notepad'];
    $schema['allow_upload'] = $flags['allow_upload'];
    return [
        'id' => $row['id'],
        'domain_key' => $row['domain_key'] ?? 'custom',
        'level_key' => $row['level_key'] ?? 'custom',
        'q_type' => $qType,
        'prompt' => $row['prompt'],
        'options' => is_array($options) ? $options : null,
        'task_schema' => $schema,
        'allow_notepad' => $flags['allow_notepad'],
        'allow_upload' => $flags['allow_upload'],
        'points' => (int) ($row['points'] ?? ($qType === 'task' ? 0 : 5)),
    ];
}

/**
 * Shuffle MCQ option texts among a/b/c/d for this attempt.
 * Stores correct_option on the attempt question (never send that key to the client).
 */
function peaklyyShuffleMcqOptions(array $publicQ, string $bankCorrect): array
{
    $qType = strtolower((string) ($publicQ['q_type'] ?? 'mcq'));
    $options = $publicQ['options'] ?? null;
    if ($qType === 'task' || !is_array($options) || $options === []) {
        return $publicQ;
    }
    $bankCorrect = strtolower(trim($bankCorrect));
    if (!in_array($bankCorrect, ['a', 'b', 'c', 'd'], true)) {
        $bankCorrect = 'a';
    }
    $pairs = [];
    foreach (['a', 'b', 'c', 'd'] as $letter) {
        if (!array_key_exists($letter, $options)) {
            continue;
        }
        $text = trim((string) $options[$letter]);
        if ($text === '') {
            continue;
        }
        $pairs[] = ['from' => $letter, 'text' => (string) $options[$letter]];
    }
    if (count($pairs) < 2) {
        $publicQ['correct_option'] = $bankCorrect;
        return $publicQ;
    }
    shuffle($pairs);
    $newOptions = [];
    $newCorrect = $bankCorrect;
    $letters = ['a', 'b', 'c', 'd'];
    foreach ($pairs as $i => $pair) {
        $key = $letters[$i];
        $newOptions[$key] = $pair['text'];
        if ($pair['from'] === $bankCorrect) {
            $newCorrect = $key;
        }
    }
    $publicQ['options'] = $newOptions;
    $publicQ['correct_option'] = $newCorrect;
    return $publicQ;
}

/** Build public questions for a new attempt: shuffle MCQ options per candidate. */
function peaklyyPublicQuestionsForAttempt(array $bankRows): array
{
    $out = [];
    foreach ($bankRows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $pq = peaklyyPublicQuestion($row);
        $pq = peaklyyShuffleMcqOptions($pq, (string) ($row['correct_option'] ?? 'a'));
        $out[] = $pq;
    }
    return $out;
}

/** Strip scoring fields before returning questions to the candidate. */
function peaklyyQuestionsForClient(array $questions): array
{
    $out = [];
    foreach ($questions as $q) {
        if (!is_array($q)) {
            continue;
        }
        unset($q['correct_option'], $q['_correct_option'], $q['correct']);
        $out[] = $q;
    }
    return $out;
}

/**
 * Domain MCQ attempt: all beginner MCQs for the selected domain.
 */
function peaklyyPickMcqQuestions(PDO $db, string $domain, ?int $mcqCount = null): array
{
    $mcqCount = $mcqCount ?? peaklyyDomainMcqCount();
    $mcqCount = max(1, $mcqCount);
    $stmt = $db->prepare(
        "SELECT * FROM peaklyy_question_bank
         WHERE domain_key = ? AND is_active = 1 AND q_type = 'mcq'
         ORDER BY sort_order ASC"
    );
    $stmt->execute([$domain]);
    $all = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (!$all) {
        return [];
    }
    $byLevel = ['easy' => [], 'medium' => [], 'hard' => []];
    foreach ($all as $row) {
        $lvl = strtolower((string) ($row['level_key'] ?? 'easy'));
        if (!isset($byLevel[$lvl])) {
            $byLevel[$lvl] = [];
        }
        $byLevel[$lvl][] = $row;
    }
    $targetEasy = (int) max(1, round($mcqCount * 0.4));
    $targetMed = (int) max(1, round($mcqCount * 0.35));
    $targetHard = max(1, $mcqCount - $targetEasy - $targetMed);
    $pick = static function (array $pool, int $n): array {
        if ($n <= 0 || !$pool) {
            return [];
        }
        shuffle($pool);
        return array_slice($pool, 0, min($n, count($pool)));
    };
    $selected = array_merge(
        $pick($byLevel['easy'], $targetEasy),
        $pick($byLevel['medium'], $targetMed),
        $pick($byLevel['hard'], $targetHard)
    );
    if (count($selected) < $mcqCount) {
        $ids = array_column($selected, 'id');
        $rest = array_values(array_filter($all, static fn($r) => !in_array($r['id'], $ids, true)));
        shuffle($rest);
        $selected = array_merge($selected, array_slice($rest, 0, $mcqCount - count($selected)));
    }
    shuffle($selected);
    return array_slice($selected, 0, $mcqCount);
}

/**
 * Domain practical task — notepad + upload, manual grading.
 */
function peaklyyPickTaskQuestions(PDO $db, string $domain, ?int $taskLimit = null): array
{
    $taskLimit = max(1, $taskLimit ?? peaklyyDomainTaskCount());
    $taskStmt = $db->prepare(
        "SELECT * FROM peaklyy_question_bank
         WHERE domain_key = ? AND is_active = 1 AND q_type = 'task'
         ORDER BY sort_order ASC
         LIMIT " . (int) $taskLimit
    );
    $taskStmt->execute([$domain]);
    return $taskStmt->fetchAll(PDO::FETCH_ASSOC);
}

/** @deprecated Prefer peaklyyPickMcqQuestions + peaklyyPickTaskQuestions */
function peaklyyPickQuestions(PDO $db, string $domain, int $count): array
{
    $taskLimit = peaklyyDomainTaskCount();
    $mcqCount = max(1, $count > $taskLimit ? ($count - $taskLimit) : $count);
    return array_merge(
        peaklyyPickMcqQuestions($db, $domain, $mcqCount),
        peaklyyPickTaskQuestions($db, $domain, $taskLimit)
    );
}

function peaklyyAssertSafeWebhookUrl(string $url): ?string
{
    $url = trim($url);
    if ($url === '') {
        return 'Webhook URL is empty';
    }
    if (!filter_var($url, FILTER_VALIDATE_URL)) {
        return 'Webhook URL is invalid';
    }
    $parts = parse_url($url);
    if (!is_array($parts)) {
        return 'Webhook URL could not be parsed';
    }
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    if ($scheme !== 'https') {
        return 'Webhook URL must use HTTPS';
    }
    $host = strtolower((string) ($parts['host'] ?? ''));
    if ($host === '' || $host === 'localhost' || str_ends_with($host, '.localhost') || $host === '127.0.0.1' || $host === '::1') {
        return 'Webhook URL host is not allowed';
    }
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        if (!filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return 'Webhook URL must not target private or reserved IPs';
        }
    }
    return null;
}

function peaklyyApiPublicBase(): string
{
    if (function_exists('peaklyyPublicBase')) {
        return peaklyyPublicBase();
    }
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    return $host !== '' ? ($scheme . '://' . $host) : '';
}

/**
 * Build score + MCQ summary + task notepad/uploads for partner API / webhook.
 */
function peaklyyCollectAttemptPartnerPayload(PDO $db, array $assessment, array $attempt): array
{
    $attemptId = (string) $attempt['id'];
    $qById = [];
    foreach (['mcq_questions_json', 'task_questions_json', 'questions_json'] as $col) {
        if (empty($attempt[$col])) {
            continue;
        }
        $decoded = json_decode((string) $attempt[$col], true);
        if (!is_array($decoded)) {
            continue;
        }
        foreach ($decoded as $q) {
            $qid = (string) ($q['id'] ?? '');
            if ($qid === '' || isset($qById[$qid])) {
                continue;
            }
            $part = (($q['q_type'] ?? '') === 'task' || $col === 'task_questions_json') ? 'task' : 'mcq';
            $q['_part'] = $part;
            $qById[$qid] = $q;
        }
    }

    $mcqAnswers = [];
    $taskUploads = [];
    $ansStmt = $db->prepare(
        'SELECT question_id, answer_option, answer_json, is_correct, points_awarded
         FROM peaklyy_attempt_answers WHERE attempt_id = ?'
    );
    $ansStmt->execute([$attemptId]);
    $base = rtrim(peaklyyApiPublicBase(), '/');
    $apiPath = $base !== '' ? ($base . '/api/assessments.php') : '/api/assessments.php';

    foreach ($ansStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $qid = (string) $row['question_id'];
        $pq = $qById[$qid] ?? null;
        $part = $pq['_part'] ?? ((($pq['q_type'] ?? '') === 'task') ? 'task' : 'mcq');
        $aj = $row['answer_json'] ?? null;
        if (is_string($aj)) {
            $aj = json_decode($aj, true);
        }
        if (!is_array($aj)) {
            $aj = [];
        }
        $text = (string) ($aj['text'] ?? '');
        $filePath = (string) ($aj['file_path'] ?? '');
        $fileName = (string) ($aj['file_name'] ?? '');
        if ($part === 'task' || ($pq['q_type'] ?? '') === 'task' || $filePath !== '' || ($text !== '' && empty($pq['options']))) {
            $item = [
                'question_id' => $qid,
                'prompt' => (string) ($pq['prompt'] ?? ''),
                'q_type' => (string) ($pq['q_type'] ?? 'task'),
                'text' => $text,
                'file_name' => $fileName,
                'file_path' => $filePath,
            ];
            if ($filePath !== '') {
                $item['download_url'] = $apiPath . '?action=partner_file&attempt_id=' . rawurlencode($attemptId)
                    . '&question_id=' . rawurlencode($qid);
                $item['download_header'] = 'X-Assessment-Api-Key: <your permanent API key>';
            }
            $taskUploads[] = $item;
        } else {
            $mcqAnswers[] = [
                'question_id' => $qid,
                'prompt' => (string) ($pq['prompt'] ?? ''),
                'answer_option' => $row['answer_option'],
                'is_correct' => (int) $row['is_correct'] === 1,
                'points_awarded' => (int) $row['points_awarded'],
            ];
        }
    }

    $phase = strtolower((string) ($attempt['attempt_phase'] ?? ''));
    $tasksDone = in_array($phase, ['done', 'task'], true) && ($attempt['status'] ?? '') === 'submitted'
        || $phase === 'done'
        || count($taskUploads) > 0 && ($attempt['status'] ?? '') === 'submitted';

    return [
        'assessment_id' => (string) ($assessment['id'] ?? ''),
        'assessment_slug' => (string) ($assessment['slug'] ?? ''),
        'attempt_id' => $attemptId,
        'attempt_phase' => $phase ?: null,
        'status' => (string) ($attempt['status'] ?? ''),
        'candidate' => [
            'full_name' => $attempt['full_name'] ?? '',
            'email' => $attempt['email'] ?? '',
            'phone' => $attempt['phone'] ?? '',
            'domain_key' => $attempt['domain_key'] ?? '',
            'domain_label' => peaklyyDomainCatalog()[$attempt['domain_key'] ?? ''] ?? ($attempt['domain_key'] ?? ''),
            'degree_branch' => $attempt['degree_branch'] ?? null,
            'college_name' => $attempt['college_name'] ?? null,
        ],
        'score' => [
            'score' => (int) ($attempt['score'] ?? 0),
            'stars' => (int) ($attempt['stars'] ?? 0),
            'passed' => !empty($attempt['passed']),
            'part' => 'mcq',
            'time_taken_seconds' => (int) ($attempt['time_taken_seconds'] ?? 0),
            'submitted_at' => $attempt['submitted_at'] ?? null,
        ],
        'mcq_answers' => $mcqAnswers,
        'uploads' => $taskUploads,
        'tasks' => $taskUploads,
        'tasks_complete' => (bool) $tasksDone,
        'fetch_hint' => 'GET assessments.php?action=partner_result&attempt_id=… with header X-Assessment-Api-Key (or Authorization: Bearer). Response includes score + uploads[]. Download files via partner_file with the same header.',
    ];
}

/**
 * @param array<string,mixed> $extra merged into webhook JSON
 */
function peaklyySendWebhook(array $assessment, array $attempt, string $event = 'peaklyy.assessment.passed', array $extra = [], bool $requirePassed = true): array
{
    $url = trim((string) ($assessment['result_webhook_url'] ?? ''));
    $key = trim((string) ($assessment['result_api_key'] ?? ''));
    if ($url === '') {
        return ['sent' => false, 'status' => 'skipped'];
    }
    if ($requirePassed && empty($attempt['passed'])) {
        return ['sent' => false, 'status' => 'skipped'];
    }
    $unsafe = peaklyyAssertSafeWebhookUrl($url);
    if ($unsafe !== null) {
        error_log('[peaklyy] webhook blocked: ' . $unsafe . ' url=' . $url);
        return ['sent' => false, 'status' => 'blocked_ssrf', 'response' => $unsafe];
    }
    $payload = array_merge([
        'event' => $event,
        'assessment_id' => $assessment['id'],
        'assessment_slug' => $assessment['slug'],
        'attempt_id' => $attempt['id'],
        'api_key' => $key,
        'test_part' => $extra['test_part'] ?? 'mcq',
        'candidate' => [
            'full_name' => $attempt['full_name'],
            'email' => $attempt['email'],
            'phone' => $attempt['phone'],
            'domain_key' => $attempt['domain_key'],
            'domain_label' => peaklyyDomainCatalog()[$attempt['domain_key']] ?? $attempt['domain_key'],
            'degree_branch' => $attempt['degree_branch'],
            'college_name' => $attempt['college_name'],
        ],
        'result' => [
            'score' => (int) $attempt['score'],
            'stars' => (int) $attempt['stars'],
            'passed' => (bool) $attempt['passed'],
            'time_taken_seconds' => (int) ($attempt['time_taken_seconds'] ?? 0),
            'submitted_at' => $attempt['submitted_at'],
            'part' => $extra['test_part'] ?? 'mcq',
        ],
        'redirect_hint' => true,
    ], $extra);
    // If URL looks like a page (no /api/ path), also support GET-style handoff via redirect
    $redirectWithResults = $url . (str_contains($url, '?') ? '&' : '?') . http_build_query([
        'peaklyy' => '1',
        'api_key' => $key,
        'score' => (int) $attempt['score'],
        'stars' => (int) $attempt['stars'],
        'passed' => !empty($attempt['passed']) ? 1 : 0,
        'part' => $extra['test_part'] ?? 'mcq',
        'email' => $attempt['email'],
        'name' => $attempt['full_name'],
        'domain' => $attempt['domain_key'],
        'attempt_id' => $attempt['id'],
        'uploads' => !empty($extra['uploads']) ? count((array) $extra['uploads']) : 0,
    ]);
    $ch = curl_init($url);
    $headers = ['Content-Type: application/json', 'Accept: application/json'];
    if ($key !== '') {
        $headers[] = 'Authorization: Bearer ' . $key;
        $headers[] = 'X-API-Key: ' . $key;
        $headers[] = 'X-Assessment-Api-Key: ' . $key;
    }
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => defined('CURLPROTO_HTTPS') ? CURLPROTO_HTTPS : 2,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    $jr = is_string($body) ? json_decode($body, true) : null;
    $finalRedirect = $redirectWithResults;
    if (is_array($jr) && !empty($jr['redirect_url'])) {
        $redir = trim((string) $jr['redirect_url']);
        if (peaklyyAssertSafeWebhookUrl($redir) === null) {
            $finalRedirect = $redir;
        }
    }
    return [
        'sent' => ($code >= 200 && $code < 300),
        'status' => $code ? ('http_' . $code) : ('curl_' . ($err !== '' ? $err : 'failed')),
        'response' => is_string($body) ? mb_substr($body, 0, 2000) : '',
        'redirect_url' => $finalRedirect,
    ];
}

try {
    peaklyyEnsureTables($db);
    peaklyySeedBank($db);
    peaklyyNormalizeDomainAssessments($db);
    peaklyyEnsureApiKeys($db);
    syncpediaEnsureFresherBasicsAssessment($db);
} catch (Throwable $e) {
    error_log('[assessments] bootstrap: ' . $e->getMessage());
}

// ── Meta (public) ──
if ($action === 'meta' && $method === 'GET') {
    respond([
        'domains' => peaklyyDomainCatalog(),
        'degrees' => peaklyyDegreeOptions(),
        'star_rules' => [
            'pass_at' => 70,
            'stars' => ['70+' => 1, '80+' => 2, '90+' => 3, '100' => 4],
        ],
    ]);
}

// ── Admin list/create ──
if ($action === 'list' && $method === 'GET') {
    $token = verifyToken();
    requireRole($token, ['super_admin', 'org', 'manager', 'sales_representative', 'marketing', 'operational_manager']);
    $role = syncpediaNormalizeRoleKey((string) ($token['role'] ?? ''));
    $userId = (string) ($token['user_id'] ?? $token['id'] ?? '');
    try {
    if ($role === 'super_admin') {
        $q = $db->query('SELECT * FROM peaklyy_assessments ORDER BY created_at DESC');
        $rows = $q ? $q->fetchAll(PDO::FETCH_ASSOC) : [];
        try {
            $stmtAssigned = $db->query('SELECT assessment_id, user_id FROM peaklyy_assessment_assignments');
            $allAssignments = $stmtAssigned ? $stmtAssigned->fetchAll(PDO::FETCH_ASSOC) : [];
            $assignmentMap = [];
            foreach ($allAssignments as $aRow) {
                $aidKey = trim((string) ($aRow['assessment_id'] ?? ''));
                $uidKey = trim((string) ($aRow['user_id'] ?? ''));
                if ($aidKey === '' || $uidKey === '') {
                    continue;
                }
                $assignmentMap[$aidKey][] = $uidKey;
            }
            foreach ($rows as &$r) {
                $r['assigned_user_ids'] = $assignmentMap[trim((string) ($r['id'] ?? ''))] ?? [];
            }
            unset($r);
        } catch (Throwable $e) {
            foreach ($rows as &$r) {
                $r['assigned_user_ids'] = [];
            }
            unset($r);
        }
    } else {
        $stmt = $db->prepare(
            'SELECT a.* FROM peaklyy_assessments a
             INNER JOIN peaklyy_assessment_assignments paa ON paa.assessment_id = a.id
             WHERE TRIM(paa.user_id) = TRIM(?) AND a.is_active = 1
             ORDER BY a.created_at DESC'
        );
        $stmt->execute([$userId]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
    if (!is_array($rows)) {
        $rows = [];
    }
    foreach ($rows as &$r) {
        $key = trim((string) ($r['result_api_key'] ?? ''));
        $r['open_url'] = $key !== ''
            ? peaklyyOpenUrl((string) $r['slug'], $key)
            : (peaklyyPublicBase() . '/assessment/' . rawurlencode((string) $r['slug']));
    }
    unset($r);
    $domainsOut = peaklyyDomainCatalog();
    if (function_exists('syncpediaBasicsDomainCatalog')) {
        $domainsOut = array_merge($domainsOut, syncpediaBasicsDomainCatalog());
    }
    respond(['data' => $rows, 'domains' => $domainsOut]);
    } catch (Throwable $e) {
        error_log('[assessments] list: ' . $e->getMessage());
        respond(['error' => 'Could not load assignments', 'detail' => $e->getMessage()], 500);
    }
}

if ($action === 'create' && $method === 'POST') {
    $token = verifyToken();
    requireRole($token, ['super_admin']);
    $title = trim((string) ($input['title'] ?? 'Syncpedia Assignment'));
    $slug = trim((string) ($input['slug'] ?? ''));
    if ($slug === '') {
        $slug = strtolower(preg_replace('/[^a-z0-9]+/i', '-', $title) ?: 'peaklyy-assessment');
        $slug = trim($slug, '-') . '-' . substr(generateUUID(), 0, 6);
    }
    $id = generateUUID();
    $apiKey = trim((string) ($input['result_api_key'] ?? ''));
    if ($apiKey === '') {
        $apiKey = peaklyyGenerateApiKey();
    }
    $sourceMode = strtolower(trim((string) ($input['source_mode'] ?? 'domain_bank')));
    if (!in_array($sourceMode, ['domain_bank', 'custom'], true)) {
        $sourceMode = 'domain_bank';
    }
    $customQs = is_array($input['questions'] ?? null) ? $input['questions'] : [];
    $duration = max(0, (int) ($input['duration_minutes'] ?? 30));
    $qCount = max(1, min(50, (int) ($input['question_count'] ?? 30)));
    if ($sourceMode === 'domain_bank') {
        $duration = 0;
        $qCount = peaklyyDomainQuestionCount();
    }
    if ($sourceMode === 'custom') {
        if (count($customQs) < 1) {
            respond(['error' => 'Add at least one question'], 400);
        }
        $qCount = count($customQs);
        $duration = max(5, $duration);
    }
    $webhook = trim((string) ($input['result_webhook_url'] ?? '')) ?: null;
    if ($webhook !== null) {
        $badHook = peaklyyAssertSafeWebhookUrl($webhook);
        if ($badHook !== null) {
            respond(['error' => $badHook], 400);
        }
    }
    $brandName = trim((string) ($input['brand_name'] ?? 'Syncpedia')) ?: 'Syncpedia';
    $brandTagline = trim((string) ($input['brand_tagline'] ?? 'Cybersecurity · Ethical Hacking · AI — basics')) ?: 'Cybersecurity · Ethical Hacking · AI — basics';
    $uiTheme = strtolower(trim((string) ($input['ui_theme'] ?? 'syncpedia')));
    if ($uiTheme === '') {
        $uiTheme = 'syncpedia';
    }
    try {
        $db->prepare(
            'INSERT INTO peaklyy_assessments
             (id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, source_mode, pass_score, once_per_candidate, anti_cheat, result_webhook_url, result_api_key, is_active, created_by, ui_theme)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)'
        )->execute([
            $id, $slug, $title, $brandName, $brandTagline,
            $duration, $qCount, $sourceMode, 70,
            !empty($input['once_per_candidate']) || !isset($input['once_per_candidate']) ? 1 : 0,
            !empty($input['anti_cheat']) || !isset($input['anti_cheat']) ? 1 : 0,
            $webhook, $apiKey, $token['user_id'] ?? null, $uiTheme,
        ]);
    } catch (Throwable $e) {
        $db->prepare(
            'INSERT INTO peaklyy_assessments
             (id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, pass_score, once_per_candidate, anti_cheat, result_webhook_url, result_api_key, is_active, created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)'
        )->execute([
            $id, $slug, $title, $brandName, $brandTagline,
            $duration, $qCount, 70,
            !empty($input['once_per_candidate']) || !isset($input['once_per_candidate']) ? 1 : 0,
            !empty($input['anti_cheat']) || !isset($input['anti_cheat']) ? 1 : 0,
            $webhook, $apiKey, $token['user_id'] ?? null,
        ]);
        try {
            $db->prepare('UPDATE peaklyy_assessments SET source_mode = ? WHERE id = ?')->execute([$sourceMode, $id]);
        } catch (Throwable $e2) {
        }
        try {
            $db->prepare('UPDATE peaklyy_assessments SET ui_theme = ? WHERE id = ?')->execute([$uiTheme, $id]);
        } catch (Throwable $e3) {
        }
    }
    $inserted = 0;
    if ($sourceMode === 'custom') {
        $inserted = peaklyyInsertCustomQuestions($db, $id, $customQs);
        if ($inserted < 1) {
            $db->prepare('DELETE FROM peaklyy_assessments WHERE id = ?')->execute([$id]);
            respond(['error' => 'No valid custom questions saved'], 400);
        }
        $db->prepare('UPDATE peaklyy_assessments SET question_count = ? WHERE id = ?')->execute([$inserted, $id]);
        $qCount = $inserted;
    }
    $openUrl = peaklyyOpenUrl($slug, $apiKey);
    respond([
        'id' => $id,
        'slug' => $slug,
        'public_url' => $openUrl,
        'open_url' => $openUrl,
        'result_api_key' => $apiKey,
        'duration_minutes' => $duration,
        'question_count' => $qCount,
        'source_mode' => $sourceMode,
        'custom_questions' => $inserted,
        'message' => 'Assignment created with permanent API key',
    ], 201);
}

if ($action === 'regenerate_api_key' && $method === 'POST') {
    $token = verifyToken();
    requireRole($token, ['super_admin']);
    $id = trim((string) ($input['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'id required'], 400);
    }
    $stmt = $db->prepare('SELECT id, slug FROM peaklyy_assessments WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Not found'], 404);
    }
    $apiKey = peaklyyGenerateApiKey();
    $db->prepare('UPDATE peaklyy_assessments SET result_api_key = ? WHERE id = ?')->execute([$apiKey, $id]);
    respond([
        'id' => $id,
        'result_api_key' => $apiKey,
        'open_url' => peaklyyOpenUrl((string) $row['slug'], $apiKey),
        'message' => 'API key regenerated',
    ]);
}

if ($action === 'update' && $method === 'POST') {
    $token = verifyToken();
    requireRole($token, ['super_admin']);
    $id = trim((string) ($input['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'id required'], 400);
    }
    $fields = [
        'title', 'brand_name', 'brand_tagline', 'duration_minutes', 'question_count',
        'once_per_candidate', 'anti_cheat', 'result_webhook_url', 'result_api_key', 'is_active',
    ];
    $sets = [];
    $params = [];
    foreach ($fields as $f) {
        if (!array_key_exists($f, $input)) {
            continue;
        }
        if ($f === 'result_webhook_url') {
            $hook = trim((string) $input[$f]);
            if ($hook !== '') {
                $badHook = peaklyyAssertSafeWebhookUrl($hook);
                if ($badHook !== null) {
                    respond(['error' => $badHook], 400);
                }
            }
            $sets[] = "$f = ?";
            $params[] = $hook !== '' ? $hook : null;
            continue;
        }
        $sets[] = "$f = ?";
        $params[] = $input[$f];
    }
    if (!$sets) {
        respond(['error' => 'Nothing to update'], 400);
    }
    $params[] = $id;
    $db->prepare('UPDATE peaklyy_assessments SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
    respond(['message' => 'Updated']);
}

if ($action === 'delete' && ($method === 'POST' || $method === 'DELETE')) {
    $token = verifyToken();
    requireRole($token, ['super_admin']);
    $id = trim((string) ($input['id'] ?? $_GET['id'] ?? ''));
    if ($id === '') {
        respond(['error' => 'id required'], 400);
    }
    $stmt = $db->prepare('SELECT id, slug FROM peaklyy_assessments WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Not found'], 404);
    }
    if (peaklyyIsSystemAssignmentSlug((string) ($row['slug'] ?? ''))) {
        respond(['error' => 'This built-in assignment cannot be deleted'], 400);
    }
    try {
        $att = $db->prepare('SELECT id FROM peaklyy_attempts WHERE assessment_id = ?');
        $att->execute([$id]);
        $attemptIds = $att->fetchAll(PDO::FETCH_COLUMN);
        if ($attemptIds) {
            $in = implode(',', array_fill(0, count($attemptIds), '?'));
            try {
                $db->prepare("DELETE FROM peaklyy_attempt_answers WHERE attempt_id IN ($in)")->execute($attemptIds);
            } catch (Throwable $e) {
            }
            $db->prepare('DELETE FROM peaklyy_attempts WHERE assessment_id = ?')->execute([$id]);
        }
    } catch (Throwable $e) {
    }
    try {
        $db->prepare('DELETE FROM peaklyy_assessment_questions WHERE assessment_id = ?')->execute([$id]);
    } catch (Throwable $e) {
    }
    try {
        $db->prepare('DELETE FROM peaklyy_assessment_assignments WHERE assessment_id = ?')->execute([$id]);
    } catch (Throwable $e) {
    }
    $db->prepare('DELETE FROM peaklyy_assessments WHERE id = ?')->execute([$id]);
    respond(['message' => 'Assignment deleted', 'id' => $id]);
}

// ── Delete candidate attempt (SuperAdmin only) ──
if ($action === 'delete_attempt' && ($method === 'POST' || $method === 'DELETE')) {
    $token = verifyToken();
    requireRole($token, ['super_admin']);
    $attemptId = trim((string) ($input['attempt_id'] ?? $_GET['attempt_id'] ?? ''));
    if ($attemptId === '') {
        respond(['error' => 'attempt_id required'], 400);
    }
    try {
        $db->prepare('DELETE FROM peaklyy_attempt_answers WHERE attempt_id = ?')->execute([$attemptId]);
    } catch (Throwable $e) {
    }
    $db->prepare('DELETE FROM peaklyy_attempts WHERE id = ?')->execute([$attemptId]);
    respond(['message' => 'Candidate attempt deleted', 'attempt_id' => $attemptId]);
}

// ── Assignment user allocation (SuperAdmin only) ──
if ($action === 'assign_users' && $method === 'POST') {
    $token = verifyToken();
    requireRole($token, ['super_admin']);
    $aid = trim((string) ($input['assessment_id'] ?? $_GET['assessment_id'] ?? ''));
    if ($aid === '') {
        respond(['error' => 'assessment_id required'], 400);
    }
    $userIds = $input['user_ids'] ?? $input['userIds'] ?? [];
    if (!is_array($userIds)) {
        $userIds = [];
    }
    $userIds = array_values(array_unique(array_filter(array_map(static function ($id) {
        return trim((string) $id);
    }, $userIds), static function ($id) {
        return $id !== '';
    })));
    $myId = (string) ($token['user_id'] ?? $token['id'] ?? '');
    if ($myId === '') {
        $myId = null;
    }

    try {
        peaklyyEnsureTables($db);
        $db->prepare('DELETE FROM peaklyy_assessment_assignments WHERE assessment_id = ?')->execute([$aid]);
        if (!empty($userIds)) {
            $ins = $db->prepare('INSERT INTO peaklyy_assessment_assignments (id, assessment_id, user_id, assigned_by) VALUES (?, ?, ?, ?)');
            foreach ($userIds as $uid) {
                if ($uid === '') continue;
                $ins->execute([generateUUID(), $aid, $uid, $myId]);
            }
        }
        respond(['message' => 'Assignments saved', 'count' => count($userIds), 'user_ids' => $userIds]);
    } catch (Throwable $e) {
        respond(['error' => 'Database error: ' . $e->getMessage()], 500);
    }
}

// ── Get users assigned to this assessment ──
if ($action === 'assigned_users' && $method === 'GET') {
    $token = verifyToken();
    requireRole($token, ['super_admin', 'org', 'manager', 'sales_representative', 'marketing', 'operational_manager']);
    $aid = trim((string) ($_GET['assessment_id'] ?? ''));
    if ($aid === '') {
        respond(['error' => 'assessment_id required'], 400);
    }
    try {
        peaklyyEnsureTables($db);
        $stmt = $db->prepare(
            'SELECT TRIM(paa.user_id) AS user_id, u.full_name, u.email, u.role
             FROM peaklyy_assessment_assignments paa
             LEFT JOIN users u ON TRIM(u.id) = TRIM(paa.user_id)
             WHERE TRIM(paa.assessment_id) = TRIM(?)'
        );
        $stmt->execute([$aid]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        respond(['data' => $rows]);
    } catch (Throwable $e) {
        respond(['data' => []]);
    }
}

// ── Get assignments assigned to current user (for dashboard & sidebar) ──
if ($action === 'my_assignments' && $method === 'GET') {
    $token = verifyToken();
    requireRole($token, ['super_admin', 'org', 'manager', 'sales_representative', 'marketing', 'operational_manager']);
    $userId = (string) ($token['user_id'] ?? $token['id'] ?? '');
    $role = (string) ($token['role'] ?? '');

    try {
        peaklyyEnsureTables($db);
        if ($role === 'super_admin') {
            $stmt = $db->query('SELECT * FROM peaklyy_assessments WHERE is_active = 1 ORDER BY created_at DESC');
        } else {
            $stmt = $db->prepare(
                'SELECT a.* FROM peaklyy_assessments a
                 INNER JOIN peaklyy_assessment_assignments paa ON paa.assessment_id = a.id
                 WHERE TRIM(paa.user_id) = TRIM(?) AND a.is_active = 1
                 ORDER BY a.created_at DESC'
            );
            $stmt->execute([$userId]);
        }
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$r) {
            $key = trim((string) ($r['result_api_key'] ?? ''));
            $r['open_url'] = $key !== ''
                ? peaklyyOpenUrl((string) $r['slug'], $key)
                : (peaklyyPublicBase() . '/assessment/' . rawurlencode((string) $r['slug']));
        }
        unset($r);
        respond(['data' => $rows]);
    } catch (Throwable $e) {
        respond(['data' => []]);
    }
}

if ($action === 'attempts' && $method === 'GET') {
    $token = verifyToken();
    requireRole($token, ['super_admin', 'org', 'manager', 'sales_representative', 'marketing', 'operational_manager']);
    $aid = trim((string) ($_GET['assessment_id'] ?? ''));
    if ($aid === '') {
        respond(['error' => 'assessment_id required'], 400);
    }
    $role = (string) ($token['role'] ?? '');
    $userId = (string) ($token['user_id'] ?? $token['id'] ?? '');
    if ($role !== 'super_admin') {
        $chkAssign = $db->prepare('SELECT 1 FROM peaklyy_assessment_assignments WHERE assessment_id = ? AND user_id = ? LIMIT 1');
        $chkAssign->execute([$aid, $userId]);
        if (!$chkAssign->fetch()) {
            respond(['error' => 'You are not assigned to this assignment'], 403);
        }
    }
    $stmt = $db->prepare(
        'SELECT id, full_name, email, phone, domain_key, degree_branch, college_name, graduation_year, interest_selected_json, status, attempt_phase,
                score, stars, passed, time_taken_seconds, violation_count, started_at, submitted_at, mcq_submitted_at,
                webhook_status, webhook_sent_at, timeline_json, created_at
         FROM peaklyy_attempts WHERE assessment_id = ? ORDER BY created_at DESC LIMIT 500'
    );
    try {
        $stmt->execute([$aid]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        $stmt = $db->prepare(
            'SELECT id, full_name, email, phone, domain_key, degree_branch, college_name, status, attempt_phase,
                    score, stars, passed, time_taken_seconds, violation_count, started_at, submitted_at, mcq_submitted_at,
                    webhook_status, webhook_sent_at, timeline_json, created_at
             FROM peaklyy_attempts WHERE assessment_id = ? ORDER BY created_at DESC LIMIT 500'
        );
        try {
            $stmt->execute([$aid]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Throwable $e2) {
            $stmt = $db->prepare(
                'SELECT id, full_name, email, phone, domain_key, degree_branch, college_name, status, score, stars, passed,
                        time_taken_seconds, violation_count, started_at, submitted_at, webhook_status, created_at
                 FROM peaklyy_attempts WHERE assessment_id = ? ORDER BY created_at DESC LIMIT 500'
            );
            $stmt->execute([$aid]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        }
    }
    $out = [];
    foreach ($rows as $r) {
        $timeline = peaklyyBuildAttemptTimeline($r);
        unset($r['timeline_json']);
        $r['timeline'] = $timeline;
        $r['timeline_text'] = peaklyyTimelineToText($timeline);

        // Auto-extract graduation_year if empty
        if (empty($r['graduation_year']) && !empty($r['degree_branch'])) {
            if (preg_match('/\b(20\d{2})\b/', $r['degree_branch'], $m)) {
                $r['graduation_year'] = $m[1];
            }
        }
        // Extract interest topics
        $topics = [];
        if (!empty($r['interest_selected_json'])) {
            $decoded = is_string($r['interest_selected_json']) ? json_decode($r['interest_selected_json'], true) : $r['interest_selected_json'];
            if (is_array($decoded)) {
                $topics = $decoded;
            }
        }
        if (empty($topics) && !empty($timeline)) {
            foreach ($timeline as $evt) {
                if (($evt['event'] ?? '') === 'interests_saved' && !empty($evt['detail']['interests']) && is_array($evt['detail']['interests'])) {
                    $topics = $evt['detail']['interests'];
                    break;
                }
            }
        }
        $r['interest_topics'] = $topics;
        $out[] = $r;
    }
    respond(['data' => $out]);
}

if ($action === 'attempt_detail' && $method === 'GET') {
    $token = verifyToken();
    requireRole($token, ['super_admin', 'org', 'manager', 'sales_representative', 'marketing', 'operational_manager']);
    $attemptId = trim((string) ($_GET['attempt_id'] ?? ''));
    if ($attemptId === '') {
        respond(['error' => 'attempt_id required'], 400);
    }
    $stmt = $db->prepare(
        'SELECT id, assessment_id, full_name, email, phone, domain_key, degree_branch, college_name, graduation_year, interest_selected_json, status,
                score, stars, passed, time_taken_seconds, violation_count, started_at, submitted_at, mcq_submitted_at,
                webhook_status, webhook_sent_at, questions_json, attempt_phase, mcq_questions_json, task_questions_json,
                timeline_json, created_at
         FROM peaklyy_attempts WHERE id = ? LIMIT 1'
    );
    try {
        $stmt->execute([$attemptId]);
        $attempt = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        $stmt = $db->prepare(
            'SELECT id, assessment_id, full_name, email, phone, domain_key, degree_branch, college_name, status,
                    score, stars, passed, time_taken_seconds, violation_count, started_at, submitted_at,
                    webhook_status, questions_json, attempt_phase, mcq_questions_json, task_questions_json, timeline_json, created_at
             FROM peaklyy_attempts WHERE id = ? LIMIT 1'
        );
        try {
            $stmt->execute([$attemptId]);
            $attempt = $stmt->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $e2) {
            $stmt = $db->prepare(
                'SELECT id, assessment_id, full_name, email, phone, domain_key, degree_branch, college_name, status,
                        score, stars, passed, time_taken_seconds, violation_count, started_at, submitted_at,
                        webhook_status, questions_json, created_at
                 FROM peaklyy_attempts WHERE id = ? LIMIT 1'
            );
            $stmt->execute([$attemptId]);
            $attempt = $stmt->fetch(PDO::FETCH_ASSOC);
        }
    }
    if (!$attempt) {
        respond(['error' => 'Attempt not found'], 404);
    }
    $questions = [];
    foreach (['mcq_questions_json', 'task_questions_json', 'questions_json'] as $col) {
        if (empty($attempt[$col])) {
            continue;
        }
        $decoded = json_decode((string) $attempt[$col], true);
        if (!is_array($decoded)) {
            continue;
        }
        foreach ($decoded as $q) {
            $qid = (string) ($q['id'] ?? '');
            if ($qid === '' || isset($questions[$qid])) {
                continue;
            }
            $q['_part'] = ($q['q_type'] ?? '') === 'task' || $col === 'task_questions_json' ? 'task' : 'mcq';
            $questions[$qid] = $q;
        }
    }
    $qById = $questions;
    $ansStmt = $db->prepare(
        'SELECT question_id, answer_option, answer_json, is_correct, points_awarded
         FROM peaklyy_attempt_answers WHERE attempt_id = ?'
    );
    $ansStmt->execute([$attemptId]);
    $answersOut = [];
    foreach ($ansStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $qid = (string) $row['question_id'];
        $aj = $row['answer_json'] ?? null;
        if (is_string($aj)) {
            $aj = json_decode($aj, true);
        }
        if (!is_array($aj)) {
            $aj = [];
        }
        $pq = $qById[$qid] ?? null;
        $qNum = peaklyyQuestionNumberOnAttempt($attempt, $qid);
        $answersOut[] = [
            'question_id' => $qid,
            'question_number' => $qNum,
            'prompt' => $pq['prompt'] ?? '',
            'q_type' => $pq['q_type'] ?? 'mcq',
            'part' => $pq['_part'] ?? ((($pq['q_type'] ?? '') === 'task') ? 'task' : 'mcq'),
            'allow_notepad' => !empty($pq['allow_notepad']),
            'allow_upload' => !empty($pq['allow_upload']),
            'answer_option' => $row['answer_option'],
            'text' => (string) ($aj['text'] ?? ''),
            'file_path' => (string) ($aj['file_path'] ?? ''),
            'file_name' => (string) ($aj['file_name'] ?? ''),
            'notepad_file_path' => (string) ($aj['notepad_file_path'] ?? ''),
            'notepad_file_name' => (string) ($aj['notepad_file_name'] ?? ''),
            'is_correct' => (int) $row['is_correct'],
            'points_awarded' => (int) $row['points_awarded'],
        ];
    }
    unset($attempt['questions_json'], $attempt['mcq_questions_json'], $attempt['task_questions_json']);
    $timeline = peaklyyBuildAttemptTimeline($attempt);
    unset($attempt['timeline_json']);

    // Auto-extract graduation_year if empty
    if (empty($attempt['graduation_year']) && !empty($attempt['degree_branch'])) {
        if (preg_match('/\b(20\d{2})\b/', $attempt['degree_branch'], $m)) {
            $attempt['graduation_year'] = $m[1];
        }
    }
    // Extract interest topics
    $topics = [];
    if (!empty($attempt['interest_selected_json'])) {
        $decoded = is_string($attempt['interest_selected_json']) ? json_decode($attempt['interest_selected_json'], true) : $attempt['interest_selected_json'];
        if (is_array($decoded)) {
            $topics = $decoded;
        }
    }
    if (empty($topics) && !empty($timeline)) {
        foreach ($timeline as $evt) {
            if (($evt['event'] ?? '') === 'interests_saved' && !empty($evt['detail']['interests']) && is_array($evt['detail']['interests'])) {
                $topics = $evt['detail']['interests'];
                break;
            }
        }
    }
    $attempt['interest_topics'] = $topics;

    respond([
        'data' => $attempt,
        'answers' => $answersOut,
        'mcq_answers' => array_values(array_filter($answersOut, static fn($a) => ($a['part'] ?? '') === 'mcq')),
        'task_answers' => array_values(array_filter($answersOut, static fn($a) => ($a['part'] ?? '') === 'task')),
        'timeline' => $timeline,
        'timeline_text' => peaklyyTimelineToText($timeline),
    ]);
}

// ── Admin: download all task files for one attempt as ZIP ──
if ($action === 'download_tasks_zip' && $method === 'GET') {
    $token = verifyToken();
    requireRole($token, ['super_admin']);
    $attemptId = trim((string) ($_GET['attempt_id'] ?? ''));
    if ($attemptId === '') {
        respond(['error' => 'attempt_id required'], 400);
    }
    if (!class_exists('ZipArchive')) {
        respond(['error' => 'ZIP support is not available on this server'], 500);
    }
    $stmt = $db->prepare('SELECT * FROM peaklyy_attempts WHERE id = ? LIMIT 1');
    $stmt->execute([$attemptId]);
    $attempt = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$attempt) {
        respond(['error' => 'Attempt not found'], 404);
    }

    $qById = [];
    foreach (['task_questions_json', 'questions_json', 'mcq_questions_json'] as $col) {
        if (empty($attempt[$col])) {
            continue;
        }
        $decoded = json_decode((string) $attempt[$col], true);
        if (!is_array($decoded)) {
            continue;
        }
        foreach ($decoded as $q) {
            $qid = (string) ($q['id'] ?? '');
            if ($qid === '' || isset($qById[$qid])) {
                continue;
            }
            $qById[$qid] = $q;
        }
    }

    $ansStmt = $db->prepare(
        'SELECT question_id, answer_json FROM peaklyy_attempt_answers WHERE attempt_id = ?'
    );
    $ansStmt->execute([$attemptId]);
    $candidateBase = peaklyySanitizeCandidateFileBase((string) ($attempt['full_name'] ?? 'Candidate'));
    $tmpZip = tempnam(sys_get_temp_dir(), 'pkzip_');
    if ($tmpZip === false) {
        respond(['error' => 'Could not create temp file'], 500);
    }
    $zipPath = $tmpZip . '.zip';
    @unlink($tmpZip);
    $zip = new ZipArchive();
    if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        respond(['error' => 'Could not create ZIP'], 500);
    }

    $added = 0;
    $usedNames = [];
    $addNamed = static function (ZipArchive $zip, string $name, string $contents) use (&$added, &$usedNames): void {
        $safe = preg_replace('/[^a-zA-Z0-9._-]/', '_', $name) ?: 'file.txt';
        $final = $safe;
        $i = 2;
        while (isset($usedNames[$final])) {
            $dot = strrpos($safe, '.');
            if ($dot === false) {
                $final = $safe . '_' . $i;
            } else {
                $final = substr($safe, 0, $dot) . '_' . $i . substr($safe, $dot);
            }
            $i++;
        }
        $usedNames[$final] = true;
        $zip->addFromString($final, $contents);
        $added++;
    };
    $addFile = static function (ZipArchive $zip, string $name, string $fsPath) use (&$added, &$usedNames): void {
        if (!is_file($fsPath)) {
            return;
        }
        $safe = preg_replace('/[^a-zA-Z0-9._-]/', '_', $name) ?: 'file.bin';
        $final = $safe;
        $i = 2;
        while (isset($usedNames[$final])) {
            $dot = strrpos($safe, '.');
            if ($dot === false) {
                $final = $safe . '_' . $i;
            } else {
                $final = substr($safe, 0, $dot) . '_' . $i . substr($safe, $dot);
            }
            $i++;
        }
        $usedNames[$final] = true;
        $zip->addFile($fsPath, $final);
        $added++;
    };

    foreach ($ansStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $qid = (string) $row['question_id'];
        $pq = $qById[$qid] ?? null;
        $aj = $row['answer_json'] ?? null;
        if (is_string($aj)) {
            $aj = json_decode($aj, true);
        }
        if (!is_array($aj)) {
            $aj = [];
        }
        $part = (($pq['q_type'] ?? '') === 'task') ? 'task' : 'mcq';
        $text = (string) ($aj['text'] ?? '');
        $filePath = (string) ($aj['file_path'] ?? '');
        $notepadPath = (string) ($aj['notepad_file_path'] ?? '');
        $isTask = $part === 'task' || $filePath !== '' || $notepadPath !== '' || ($text !== '' && empty($pq['options']));
        if (!$isTask) {
            continue;
        }
        $qNum = peaklyyQuestionNumberOnAttempt($attempt, $qid);
        $txtName = $candidateBase . '_Q' . $qNum . '.txt';

        if ($notepadPath !== '') {
            $fs = peaklyyResolveUploadFsPath($notepadPath);
            if ($fs) {
                $addFile($zip, (string) ($aj['notepad_file_name'] ?? $txtName), $fs);
            } elseif ($text !== '') {
                $addNamed($zip, $txtName, $text);
            }
        } elseif ($text !== '') {
            $addNamed($zip, $txtName, $text);
        }

        if ($filePath !== '') {
            $fs = peaklyyResolveUploadFsPath($filePath);
            if ($fs) {
                $orig = basename((string) ($aj['file_name'] ?? 'upload.bin'));
                $orig = preg_replace('/[^a-zA-Z0-9._-]/', '_', $orig) ?: 'upload.bin';
                $addFile($zip, $candidateBase . '_Q' . $qNum . '_' . $orig, $fs);
            }
        }
    }

    $zip->close();
    if ($added === 0) {
        @unlink($zipPath);
        respond(['error' => 'No task files found for this attempt'], 404);
    }

    $zipFileName = $candidateBase . '_tasks.zip';
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $zipFileName . '"');
    header('Content-Length: ' . (string) filesize($zipPath));
    header('Cache-Control: no-store');
    readfile($zipPath);
    @unlink($zipPath);
    exit;
}

// ── Public: load assessment by slug ──
if ($action === 'public_get' && $method === 'GET') {
    $slug = trim((string) ($_GET['slug'] ?? ''));
    $key = peaklyyRequestApiKey();
    if ($slug === '') {
        respond(['error' => 'slug required'], 400);
    }
    $stmt = $db->prepare('SELECT id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, pass_score, once_per_candidate, anti_cheat, is_active, result_api_key, source_mode, ui_theme, interest_options_json FROM peaklyy_assessments WHERE slug = ? LIMIT 1');
    try {
        $stmt->execute([$slug]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        $stmt = $db->prepare('SELECT id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, pass_score, once_per_candidate, anti_cheat, is_active, result_api_key, source_mode FROM peaklyy_assessments WHERE slug = ? LIMIT 1');
        try {
            $stmt->execute([$slug]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
        } catch (Throwable $e2) {
            $stmt = $db->prepare('SELECT id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, pass_score, once_per_candidate, anti_cheat, is_active, result_api_key FROM peaklyy_assessments WHERE slug = ? LIMIT 1');
            $stmt->execute([$slug]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row) {
                $row['source_mode'] = 'domain_bank';
            }
        }
    }
    if (!$row || !(int) $row['is_active']) {
        respond(['error' => 'Assignment not found'], 404);
    }
    if (!isset($row['source_mode'])) {
        $row['source_mode'] = 'domain_bank';
    }
    $storedKey = trim((string) ($row['result_api_key'] ?? ''));
    if ($storedKey !== '' && ($key === '' || !hash_equals($storedKey, $key))) {
        respond([
            'error' => 'Invalid or missing assessment API key',
            'hint' => 'Open the permanent link (#key=…) or send X-Assessment-Api-Key header. Query ?key= is no longer accepted.',
        ], 403);
    }
    unset($row['result_api_key']);
    $passScore = max(1, (int) ($row['pass_score'] ?? 70));
    $duration = max(0, (int) ($row['duration_minutes'] ?? 0));
    $qCount = max(1, (int) ($row['question_count'] ?? 15));
    $sourceMode = strtolower((string) ($row['source_mode'] ?? 'domain_bank'));
    if ($sourceMode === 'domain_bank') {
        $duration = 0;
        $qCount = peaklyyDomainQuestionCount();
        $row['duration_minutes'] = 0;
        $row['question_count'] = $qCount;
        $row['two_part'] = true;
        $row['mcq_count'] = peaklyyDomainMcqCount();
        $row['task_count'] = peaklyyDomainTaskCount();
    }
    if ($sourceMode === 'custom' && $slug !== syncpediaFresherBasicsSlug()) {
        try {
            $cntStmt = $db->prepare(
                "SELECT COUNT(*) FROM peaklyy_assessment_questions
                 WHERE assessment_id = ? AND is_active = 1"
            );
            $cntStmt->execute([(string) $row['id']]);
            $liveCount = (int) $cntStmt->fetchColumn();
            if ($liveCount > 0) {
                if ((int) ($row['question_count'] ?? 0) !== $liveCount) {
                    try {
                        $db->prepare('UPDATE peaklyy_assessments SET question_count = ? WHERE id = ?')
                            ->execute([$liveCount, $row['id']]);
                    } catch (Throwable $e2) {
                    }
                }
                $qCount = $liveCount;
                $row['question_count'] = $liveCount;
            }
        } catch (Throwable $e) {
            // keep stored count
        }
    }
    if ($slug === syncpediaFresherBasicsSlug()) {
        $duration = 9;
        $qCount = 15;
        $row['duration_minutes'] = 9;
        $row['question_count'] = 15;
    }
    $row['duration_minutes'] = $duration;
    $row['question_count'] = $qCount;
    $row['pass_score'] = $passScore;
    $uiTheme = strtolower(trim((string) ($row['ui_theme'] ?? 'peaklyy')));
    if ($uiTheme === '') {
        $uiTheme = 'peaklyy';
    }
    $row['ui_theme'] = $uiTheme;
    $interestOpts = [];
    if (!empty($row['interest_options_json'])) {
        $decoded = is_string($row['interest_options_json'])
            ? json_decode((string) $row['interest_options_json'], true)
            : $row['interest_options_json'];
        if (is_array($decoded)) {
            foreach ($decoded as $opt) {
                $opt = trim((string) $opt);
                if ($opt !== '') {
                    $interestOpts[] = $opt;
                }
            }
        }
    }
    if (!$interestOpts && ($slug === syncpediaFresherBasicsSlug() || $slug === syncpediaAssignmentSlug())) {
        $interestOpts = syncpediaFresherInterestTopics();
    }
    $row['interest_options'] = $interestOpts;
    $row['require_post_interests'] = count($interestOpts) > 0;
    unset($row['interest_options_json']);
    $instructions = [];
    if ($duration > 0) {
        $instructions[] = 'Duration: ' . $duration . ' minutes';
    } else {
        $instructions[] = 'No time limit — submit when you finish';
    }
    if ($sourceMode === 'domain_bank') {
        $instructions[] = 'Part 1 — MCQ test: 15 beginner questions (auto-scored; results sent to the partner website)';
        $instructions[] = 'Part 2 — Task test: 1 very basic practical task with notepad and/or file upload (manual grading)';
    } else {
        $instructions[] = $qCount . ' question' . ($qCount === 1 ? '' : 's')
            . ($slug === syncpediaFresherBasicsSlug()
                ? ' — 5 easy, 5 medium, 5 difficult (college level; harder items are scenario-based)'
                : ' (basics for freshers)');
        if ($interestOpts) {
            $instructions[] = 'After the test, select one or more topics you are interested in';
        }
    }
    $instructions = array_merge($instructions, [
        !empty($row['anti_cheat'])
            ? 'Full screen required once the test starts'
            : 'Stay on this page until you finish the test',
        !empty($row['anti_cheat'])
            ? 'No tab switching or leaving the page'
            : 'Answer carefully — you can navigate between questions before submitting',
        !empty($row['anti_cheat'])
            ? 'Copy and paste is disabled (except in notepad answer fields)'
            : 'Do not refresh the page during the test',
        !empty($row['anti_cheat'])
            ? 'Leaving or switching tabs auto-submits the current part'
            : 'The timer ends the test automatically when time is up',
        !empty($row['once_per_candidate']) ? 'Test allowed only once per candidate' : 'Multiple attempts may be allowed',
        'MCQ score ' . $passScore . '+ to pass (1★ at 70, 2★ at 80, 3★ at 90, 4★ at 100). Below ' . $passScore . ' = Not pass',
        $sourceMode === 'domain_bank'
            ? 'Task uploads and notepad answers are saved for reviewer grading (separate from MCQ score)'
            : 'Answers are scored according to question type',
    ]);
    respond([
        'data' => $row,
        'domains' => ($slug === syncpediaFresherBasicsSlug() && function_exists('syncpediaBasicsDomainCatalog'))
            ? syncpediaBasicsDomainCatalog()
            : peaklyyDomainCatalog(),
        'degrees' => peaklyyDegreeOptions(),
        'instructions' => $instructions,
    ]);
}

// ── Register ──
if ($action === 'register' && $method === 'POST') {
    $slug = trim((string) ($input['slug'] ?? ''));
    $fullName = trim((string) ($input['full_name'] ?? ''));
    $email = strtolower(trim((string) ($input['email'] ?? '')));
    $phone = preg_replace('/\D+/', '', (string) ($input['phone'] ?? ''));
    $domain = trim((string) ($input['domain_key'] ?? ''));
    $degree = trim((string) ($input['degree_branch'] ?? ''));
    $college = trim((string) ($input['college_name'] ?? ''));
    $gradYear = trim((string) ($input['graduation_year'] ?? ''));
    if ($gradYear === '' && preg_match('/\b(20\d{2})\b/', $degree, $m)) {
        $gradYear = $m[1];
    }
    $domains = peaklyyDomainCatalog();
    if ($slug === '' || $fullName === '' || $email === '' || strlen($phone) < 10) {
        respond(['error' => 'Please fill all required fields'], 400);
    }
    $stmt = $db->prepare('SELECT * FROM peaklyy_assessments WHERE slug = ? AND is_active = 1 LIMIT 1');
    $stmt->execute([$slug]);
    $assessment = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$assessment) {
        respond(['error' => 'Assessment not found'], 404);
    }
    $sourceMode = (string) ($assessment['source_mode'] ?? 'domain_bank');
    $isBasics = ($slug === syncpediaFresherBasicsSlug());
    if ($isBasics) {
        $catalog = function_exists('syncpediaBasicsDomainCatalog') ? syncpediaBasicsDomainCatalog() : [];
        if (!isset($catalog[$domain])) {
            respond(['error' => 'Please select a valid domain'], 400);
        }
    } elseif ($sourceMode === 'custom') {
        $domain = 'custom';
    } elseif (!isset($domains[$domain])) {
        respond(['error' => 'Please select a valid domain'], 400);
    }
    $isSyncpediaFresher = (($assessment['slug'] ?? '') === syncpediaFresherBasicsSlug()) || (($assessment['ui_theme'] ?? '') === 'syncpedia');
    if ((int) $assessment['once_per_candidate'] && !$isSyncpediaFresher) {
        $lockName = 'pkly_once_' . md5((string) $assessment['id'] . '|' . strtolower($email) . '|' . $domain);
        $gotLock = false;
        try {
            $lk = $db->prepare('SELECT GET_LOCK(?, 10)');
            $lk->execute([$lockName]);
            $gotLock = ((int) $lk->fetchColumn() === 1);
        } catch (Throwable $e) {
            $gotLock = false;
        }
        try {
            $chk = $db->prepare(
                "SELECT id, public_token, status FROM peaklyy_attempts
                 WHERE assessment_id = ? AND LOWER(TRIM(email)) = ? AND domain_key = ?
                   AND status IN ('registered','submitted','in_progress','expired')
                 ORDER BY created_at DESC LIMIT 1"
            );
            $chk->execute([$assessment['id'], strtolower($email), $domain]);
            $prev = $chk->fetch(PDO::FETCH_ASSOC);
            if ($prev) {
                if ($prev['status'] === 'registered') {
                    // Candidate previously registered but didn't begin/complete; resume this attempt
                    $id = $prev['id'];
                    $token = $prev['public_token'];
                    try {
                        $db->prepare('UPDATE peaklyy_attempts SET full_name = ?, phone = ?, degree_branch = ?, college_name = ?, graduation_year = ? WHERE id = ?')
                            ->execute([$fullName, $phone, $degree ?: null, $college ?: null, $gradYear ?: null, $id]);
                    } catch (Throwable $e) {
                        $db->prepare('UPDATE peaklyy_attempts SET full_name = ?, phone = ?, degree_branch = ?, college_name = ? WHERE id = ?')
                            ->execute([$fullName, $phone, $degree ?: null, $college ?: null, $id]);
                    }
                } else {
                    respond(['error' => 'You have already taken this assessment for this domain'], 409);
                }
            } else {
                $id = generateUUID();
                $token = generateUUID();
                try {
                    $db->prepare(
                        'INSERT INTO peaklyy_attempts
                         (id, assessment_id, public_token, full_name, email, phone, domain_key, degree_branch, college_name, graduation_year, status)
                         VALUES (?,?,?,?,?,?,?,?,?,?,\'registered\')'
                    )->execute([$id, $assessment['id'], $token, $fullName, $email, $phone, $domain, $degree ?: null, $college ?: null, $gradYear ?: null]);
                } catch (Throwable $e) {
                    $db->prepare(
                        'INSERT INTO peaklyy_attempts
                         (id, assessment_id, public_token, full_name, email, phone, domain_key, degree_branch, college_name, status)
                         VALUES (?,?,?,?,?,?,?,?,?,\'registered\')'
                    )->execute([$id, $assessment['id'], $token, $fullName, $email, $phone, $domain, $degree ?: null, $college ?: null]);
                }
            }
        } finally {
            if ($gotLock) {
                try {
                    $db->prepare('SELECT RELEASE_LOCK(?)')->execute([$lockName]);
                } catch (Throwable $e) {
                }
            }
        }
    } else {
        $id = generateUUID();
        $token = generateUUID();
        try {
            $db->prepare(
                'INSERT INTO peaklyy_attempts
                 (id, assessment_id, public_token, full_name, email, phone, domain_key, degree_branch, college_name, graduation_year, status)
                 VALUES (?,?,?,?,?,?,?,?,?,?,\'registered\')'
            )->execute([$id, $assessment['id'], $token, $fullName, $email, $phone, $domain, $degree ?: null, $college ?: null, $gradYear ?: null]);
        } catch (Throwable $e) {
            $db->prepare(
                'INSERT INTO peaklyy_attempts
                 (id, assessment_id, public_token, full_name, email, phone, domain_key, degree_branch, college_name, status)
                 VALUES (?,?,?,?,?,?,?,?,?,\'registered\')'
            )->execute([$id, $assessment['id'], $token, $fullName, $email, $phone, $domain, $degree ?: null, $college ?: null]);
        }
    }
    peaklyyAppendTimeline($db, $id, 'registered', 'Registered', [
        'domain_key' => $domain,
        'email' => $email,
    ]);
    $leadId = null;
    try {
        $leadId = peaklyyUpsertLeadFromRegister($db, $assessment, [
            'full_name' => $fullName,
            'email' => $email,
            'phone' => $phone,
            'domain_key' => $domain,
            'degree_branch' => $degree,
            'college_name' => $college,
            'attempt_id' => $id,
        ]);
    } catch (Throwable $e) {
        // Registration must succeed even if lead sync fails
        $leadId = null;
    }
    respond(['attempt_token' => $token, 'lead_id' => $leadId, 'message' => 'Registered']);
}

// ── Start test ──
if ($action === 'start' && $method === 'POST') {
    $token = trim((string) ($input['attempt_token'] ?? ''));
    $requestedPhase = strtolower(trim((string) ($input['phase'] ?? '')));
    if ($token === '') {
        respond(['error' => 'attempt_token required'], 400);
    }
    $stmt = $db->prepare('SELECT a.*, s.duration_minutes, s.question_count, s.anti_cheat, s.title, s.brand_name, s.source_mode, s.slug
                          FROM peaklyy_attempts a
                          JOIN peaklyy_assessments s ON s.id = a.assessment_id
                          WHERE a.public_token = ? LIMIT 1');
    $stmt->execute([$token]);
    $attempt = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$attempt) {
        respond(['error' => 'Attempt not found'], 404);
    }
    if (in_array($attempt['status'], ['submitted', 'expired'], true)) {
        respond(['error' => 'Assignment already completed'], 409);
    }
    $mode = strtolower((string) ($attempt['source_mode'] ?? 'domain_bank'));
    $phase = strtolower((string) ($attempt['attempt_phase'] ?? 'mcq'));
    if ($phase === '' || $phase === 'done') {
        $phase = 'mcq';
    }
    // Client may request task phase after MCQ
    if ($requestedPhase === 'task' && in_array($phase, ['task', 'mcq_done'], true)) {
        $phase = 'task';
    }

    $questions = [];
    if ($mode === 'domain_bank' && $phase === 'task') {
        if (!empty($attempt['task_questions_json'])) {
            $decoded = json_decode((string) $attempt['task_questions_json'], true);
            if (is_array($decoded)) {
                $questions = $decoded;
            }
        }
        if (!$questions) {
            $picked = peaklyyPickTaskQuestions($db, (string) $attempt['domain_key']);
            if (!$picked) {
                respond(['error' => 'No practical tasks available for this domain'], 500);
            }
            $questions = peaklyyPublicQuestionsForAttempt($picked);
            try {
                $db->prepare(
                    'UPDATE peaklyy_attempts SET status = ?, attempt_phase = ?, started_at = COALESCE(started_at, NOW()),
                     questions_json = ?, task_questions_json = ? WHERE id = ?'
                )->execute([
                    'in_progress',
                    'task',
                    json_encode($questions, JSON_UNESCAPED_UNICODE),
                    json_encode($questions, JSON_UNESCAPED_UNICODE),
                    $attempt['id'],
                ]);
            } catch (Throwable $e) {
                $db->prepare(
                    'UPDATE peaklyy_attempts SET status = ?, started_at = COALESCE(started_at, NOW()), questions_json = ? WHERE id = ?'
                )->execute(['in_progress', json_encode($questions, JSON_UNESCAPED_UNICODE), $attempt['id']]);
            }
        } else {
            try {
                $db->prepare(
                    'UPDATE peaklyy_attempts SET status = ?, attempt_phase = ?, started_at = COALESCE(started_at, NOW()), questions_json = ? WHERE id = ?'
                )->execute(['in_progress', 'task', json_encode($questions, JSON_UNESCAPED_UNICODE), $attempt['id']]);
            } catch (Throwable $e) {
                $db->prepare(
                    'UPDATE peaklyy_attempts SET status = ?, started_at = COALESCE(started_at, NOW()), questions_json = ? WHERE id = ?'
                )->execute(['in_progress', json_encode($questions, JSON_UNESCAPED_UNICODE), $attempt['id']]);
            }
        }
        $phase = 'task';
    } else {
        // MCQ / custom single test
        if (!empty($attempt['mcq_questions_json']) && $mode === 'domain_bank') {
            $decoded = json_decode((string) $attempt['mcq_questions_json'], true);
            if (is_array($decoded) && $decoded) {
                $questions = $decoded;
            }
        }
        if (!$questions && !empty($attempt['questions_json']) && $phase !== 'task') {
            $decoded = json_decode((string) $attempt['questions_json'], true);
            if (is_array($decoded)) {
                // Legacy combined paper: keep as-is for custom; for domain prefer MCQ-only restart if mixed
                $onlyMcq = true;
                foreach ($decoded as $dq) {
                    if (($dq['q_type'] ?? 'mcq') === 'task') {
                        $onlyMcq = false;
                        break;
                    }
                }
                if ($mode !== 'domain_bank' || $onlyMcq) {
                    $questions = $decoded;
                }
            }
        }
        if (!$questions) {
            if ($mode === 'custom') {
                $assessSlug = (string) ($attempt['slug'] ?? '');
                $pickDomain = $assessSlug === syncpediaFresherBasicsSlug()
                    ? trim((string) ($attempt['domain_key'] ?? ''))
                    : '';
                $picked = peaklyyPickCustomQuestions(
                    $db,
                    (string) $attempt['assessment_id'],
                    $pickDomain !== '' && $pickDomain !== 'custom' ? 15 : 0,
                    $pickDomain !== '' && $pickDomain !== 'custom' ? $pickDomain : null
                );
                $live = count($picked);
                if ($live > 0 && $live !== (int) $attempt['question_count'] && $assessSlug !== syncpediaFresherBasicsSlug()) {
                    $db->prepare('UPDATE peaklyy_assessments SET question_count = ? WHERE id = ?')
                        ->execute([$live, $attempt['assessment_id']]);
                }
            } else {
                $picked = peaklyyPickMcqQuestions($db, (string) $attempt['domain_key']);
            }
            if (!$picked) {
                respond(['error' => $mode === 'custom' ? 'No custom questions on this assessment' : 'No questions available for this domain'], 500);
            }
            $questions = peaklyyPublicQuestionsForAttempt($picked);
            if ((string) ($attempt['slug'] ?? '') !== syncpediaFresherBasicsSlug()) {
                shuffle($questions);
            }
            try {
                $db->prepare(
                    'UPDATE peaklyy_attempts SET status = ?, attempt_phase = ?, started_at = COALESCE(started_at, NOW()),
                     questions_json = ?, mcq_questions_json = ? WHERE id = ?'
                )->execute([
                    'in_progress',
                    $mode === 'domain_bank' ? 'mcq' : 'single',
                    json_encode($questions, JSON_UNESCAPED_UNICODE),
                    $mode === 'domain_bank' ? json_encode($questions, JSON_UNESCAPED_UNICODE) : null,
                    $attempt['id'],
                ]);
            } catch (Throwable $e) {
                $db->prepare(
                    'UPDATE peaklyy_attempts SET status = ?, started_at = COALESCE(started_at, NOW()), questions_json = ? WHERE id = ?'
                )->execute(['in_progress', json_encode($questions, JSON_UNESCAPED_UNICODE), $attempt['id']]);
            }
            $phase = $mode === 'domain_bank' ? 'mcq' : 'single';
        } else {
            try {
                $db->prepare(
                    'UPDATE peaklyy_attempts SET status = ?, attempt_phase = COALESCE(attempt_phase, ?), started_at = COALESCE(started_at, NOW()) WHERE id = ?'
                )->execute(['in_progress', $mode === 'domain_bank' ? 'mcq' : 'single', $attempt['id']]);
            } catch (Throwable $e) {
                $db->prepare('UPDATE peaklyy_attempts SET status = ?, started_at = COALESCE(started_at, NOW()) WHERE id = ?')
                    ->execute(['in_progress', $attempt['id']]);
            }
            $phase = $mode === 'domain_bank' ? 'mcq' : (string) ($attempt['attempt_phase'] ?? 'single');
        }
    }

    $started = $attempt['started_at'] ?: date('Y-m-d H:i:s');
    $durationMinutes = (int) ($attempt['duration_minutes'] ?? 0);
    $endsAt = $durationMinutes > 0
        ? date('c', strtotime($started) + ($durationMinutes * 60))
        : null;
    $domainLabel = peaklyyDomainCatalog()[$attempt['domain_key']] ?? $attempt['domain_key'];
    if (($attempt['domain_key'] ?? '') === 'custom') {
        $domainLabel = $attempt['title'] ?: 'Custom Assignment';
    }
    if ($phase === 'task') {
        peaklyyAppendTimeline($db, (string) $attempt['id'], 'task_started', 'Part 2 — practical tasks started');
    } else {
        peaklyyAppendTimeline(
            $db,
            (string) $attempt['id'],
            $phase === 'single' ? 'started' : 'mcq_started',
            $phase === 'single' ? 'Assignment started' : 'Part 1 — MCQ test started'
        );
    }
    respond([
        'attempt_id' => $attempt['id'],
        'phase' => $phase === 'single' ? 'single' : $phase,
        'duration_minutes' => $durationMinutes,
        'ends_at' => $endsAt,
        'anti_cheat' => (bool) (int) $attempt['anti_cheat'],
        'domain_key' => $attempt['domain_key'],
        'domain_label' => $domainLabel,
        'questions' => peaklyyQuestionsForClient($questions),
        'title' => $phase === 'task' ? 'Part 2 — Practical tasks' : ($phase === 'mcq' ? 'Part 1 — MCQ test' : ($attempt['title'] ?? 'Assignment')),
    ]);
}

// ── Violation ping ──
if ($action === 'violation' && $method === 'POST') {
    $token = trim((string) ($input['attempt_token'] ?? ''));
    $stmt = $db->prepare('SELECT id, status, violation_count FROM peaklyy_attempts WHERE public_token = ? LIMIT 1');
    $stmt->execute([$token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row && $row['status'] === 'in_progress') {
        $db->prepare('UPDATE peaklyy_attempts SET violation_count = violation_count + 1 WHERE id = ?')->execute([$row['id']]);
        respond(['violation_count' => (int) $row['violation_count'] + 1]);
    }
    respond(['ok' => true]);
}

/**
 * Upsert a mid-attempt answer (text / option / file path) without final scoring.
 */
function peaklyyUpsertAttemptAnswer(PDO $db, string $attemptId, string $questionId, ?string $option, array $answerJson): array
{
    $existing = $db->prepare(
        'SELECT id, answer_option, answer_json FROM peaklyy_attempt_answers WHERE attempt_id = ? AND question_id = ? LIMIT 1'
    );
    $existing->execute([$attemptId, $questionId]);
    $row = $existing->fetch(PDO::FETCH_ASSOC);
    $prev = [];
    if ($row && !empty($row['answer_json'])) {
        $decoded = is_string($row['answer_json']) ? json_decode($row['answer_json'], true) : $row['answer_json'];
        if (is_array($decoded)) {
            $prev = $decoded;
        }
    }
    $merged = array_merge($prev, $answerJson);
    // Keep prior file if new payload omitted it
    if (empty($merged['file_path']) && !empty($prev['file_path'])) {
        $merged['file_path'] = $prev['file_path'];
        if (empty($merged['file_name']) && !empty($prev['file_name'])) {
            $merged['file_name'] = $prev['file_name'];
        }
    }
    if (empty($merged['notepad_file_path']) && !empty($prev['notepad_file_path'])) {
        $merged['notepad_file_path'] = $prev['notepad_file_path'];
        if (empty($merged['notepad_file_name']) && !empty($prev['notepad_file_name'])) {
            $merged['notepad_file_name'] = $prev['notepad_file_name'];
        }
    }
    $opt = $option;
    if ($opt === null || $opt === '') {
        $opt = $row['answer_option'] ?? null;
    }
    $aj = json_encode($merged, JSON_UNESCAPED_UNICODE);
    if ($row) {
        $db->prepare(
            'UPDATE peaklyy_attempt_answers SET answer_option = ?, answer_json = ?, is_correct = 0, points_awarded = 0 WHERE id = ?'
        )->execute([$opt, $aj, $row['id']]);
    } else {
        $db->prepare(
            'INSERT INTO peaklyy_attempt_answers (id, attempt_id, question_id, answer_option, answer_json, is_correct, points_awarded)
             VALUES (?,?,?,?,?,0,0)'
        )->execute([generateUUID(), $attemptId, $questionId, $opt, $aj]);
    }
    return $merged;
}

function peaklyyFindQuestionOnAttempt(array $attempt, string $questionId): ?array
{
    $pools = [];
    foreach (['questions_json', 'mcq_questions_json', 'task_questions_json'] as $col) {
        if (empty($attempt[$col])) {
            continue;
        }
        $decoded = json_decode((string) $attempt[$col], true);
        if (is_array($decoded)) {
            $pools[] = $decoded;
        }
    }
    foreach ($pools as $questions) {
        foreach ($questions as $q) {
            if ((string) ($q['id'] ?? '') === $questionId) {
                return $q;
            }
        }
    }
    return null;
}

/**
 * 1-based question number for filenames (prefer task list, else notepad-capable questions).
 */
function peaklyyQuestionNumberOnAttempt(array $attempt, string $questionId): int
{
    $lists = [];
    if (!empty($attempt['task_questions_json'])) {
        $decoded = json_decode((string) $attempt['task_questions_json'], true);
        if (is_array($decoded) && $decoded) {
            $lists[] = $decoded;
        }
    }
    if (!empty($attempt['questions_json'])) {
        $decoded = json_decode((string) $attempt['questions_json'], true);
        if (is_array($decoded) && $decoded) {
            $taskOnly = [];
            $notepad = [];
            foreach ($decoded as $q) {
                if (!is_array($q)) {
                    continue;
                }
                if (($q['q_type'] ?? '') === 'task') {
                    $taskOnly[] = $q;
                }
                if (!empty($q['allow_notepad']) || ($q['q_type'] ?? '') === 'task') {
                    $notepad[] = $q;
                }
            }
            if ($taskOnly) {
                $lists[] = $taskOnly;
            }
            if ($notepad) {
                $lists[] = $notepad;
            }
            $lists[] = $decoded;
        }
    }
    foreach ($lists as $list) {
        foreach ($list as $i => $q) {
            if ((string) ($q['id'] ?? '') === $questionId) {
                return ((int) $i) + 1;
            }
        }
    }
    return 1;
}

/**
 * Write/update notepad .txt for an answer and return path fields to merge into answer_json.
 *
 * @return array{notepad_file_path?:string,notepad_file_name?:string}
 */
function peaklyyPersistNotepadFile(array $attempt, string $questionId, string $text, array $prevAnswer = []): array
{
    $text = (string) $text;
    if (trim($text) === '') {
        return [];
    }
    $qNum = peaklyyQuestionNumberOnAttempt($attempt, $questionId);
    $existing = !empty($prevAnswer['notepad_file_path']) ? (string) $prevAnswer['notepad_file_path'] : null;
    $saved = savePeaklyyNotepadTextFile((string) ($attempt['full_name'] ?? 'Candidate'), $qNum, $text, $existing);
    return [
        'notepad_file_path' => $saved['path'],
        'notepad_file_name' => $saved['file_name'],
    ];
}

// ── Save notepad / MCQ answer mid-test ──
if ($action === 'save_answer' && $method === 'POST') {
    $token = trim((string) ($input['attempt_token'] ?? ''));
    $questionId = trim((string) ($input['question_id'] ?? ''));
    if ($token === '' || $questionId === '') {
        respond(['error' => 'attempt_token and question_id required'], 400);
    }
    $stmt = $db->prepare('SELECT * FROM peaklyy_attempts WHERE public_token = ? LIMIT 1');
    $stmt->execute([$token]);
    $attempt = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$attempt) {
        respond(['error' => 'Attempt not found'], 404);
    }
    if (in_array($attempt['status'], ['submitted', 'expired'], true)) {
        respond(['error' => 'Assignment already completed'], 409);
    }
    try {
        $db->beginTransaction();
        $lockStmt = $db->prepare('SELECT id, status FROM peaklyy_attempts WHERE id = ? FOR UPDATE');
        $lockStmt->execute([(string) $attempt['id']]);
        $locked = $lockStmt->fetch(PDO::FETCH_ASSOC);
        if (!$locked || in_array((string) ($locked['status'] ?? ''), ['submitted', 'expired'], true)) {
            $db->rollBack();
            respond(['error' => 'Assessment already completed'], 409);
        }
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        respond(['error' => 'Could not save answer'], 500);
    }
    $pq = peaklyyFindQuestionOnAttempt($attempt, $questionId);
    if (!$pq) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        respond(['error' => 'Question not on this attempt'], 400);
    }
    $flags = peaklyyQuestionResponseFlags($pq, is_array($pq['task_schema'] ?? null) ? $pq['task_schema'] : null);
    $qType = strtolower((string) ($pq['q_type'] ?? 'mcq'));
    $payload = [];
    $opt = null;
    if ($qType === 'mcq' && !empty($pq['options'])) {
        $rawOpt = $input['option'] ?? $input['answer'] ?? null;
        if (is_array($rawOpt)) {
            $rawOpt = $rawOpt['option'] ?? '';
        }
        $opt = strtolower(trim((string) $rawOpt));
        if ($opt !== '' && !in_array($opt, ['a', 'b', 'c', 'd'], true)) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            respond(['error' => 'Invalid option'], 400);
        }
    }
    if ($flags['allow_notepad'] || $qType === 'task') {
        $text = '';
        if (isset($input['text'])) {
            $text = trim((string) $input['text']);
        } elseif (isset($input['answer']) && !is_array($input['answer'])) {
            $text = trim((string) $input['answer']);
        }
        $payload['text'] = $text;
        // Load prior answer for overwrite path
        $prevStmt = $db->prepare(
            'SELECT answer_json FROM peaklyy_attempt_answers WHERE attempt_id = ? AND question_id = ? LIMIT 1'
        );
        $prevStmt->execute([(string) $attempt['id'], $questionId]);
        $prevRow = $prevStmt->fetch(PDO::FETCH_ASSOC);
        $prevAj = [];
        if ($prevRow && !empty($prevRow['answer_json'])) {
            $decoded = is_string($prevRow['answer_json'])
                ? json_decode((string) $prevRow['answer_json'], true)
                : $prevRow['answer_json'];
            if (is_array($decoded)) {
                $prevAj = $decoded;
            }
        }
        $payload = array_merge($payload, peaklyyPersistNotepadFile($attempt, $questionId, $text, $prevAj));
    }
    $merged = peaklyyUpsertAttemptAnswer($db, (string) $attempt['id'], $questionId, $opt !== '' ? $opt : null, $payload);
    if ($db->inTransaction()) {
        $db->commit();
    }
    respond([
        'ok' => true,
        'question_id' => $questionId,
        'saved' => $merged,
        'answer_option' => $opt !== '' ? $opt : null,
        'notepad_file_path' => $merged['notepad_file_path'] ?? null,
        'notepad_file_name' => $merged['notepad_file_name'] ?? null,
    ]);
}

// ── Upload answer file mid-test ──
if ($action === 'upload_answer' && $method === 'POST') {
    $token = trim((string) ($_POST['attempt_token'] ?? $input['attempt_token'] ?? ''));
    $questionId = trim((string) ($_POST['question_id'] ?? $input['question_id'] ?? ''));
    if ($token === '' || $questionId === '') {
        respond(['error' => 'attempt_token and question_id required'], 400);
    }
    $stmt = $db->prepare('SELECT * FROM peaklyy_attempts WHERE public_token = ? LIMIT 1');
    $stmt->execute([$token]);
    $attempt = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$attempt) {
        respond(['error' => 'Attempt not found'], 404);
    }
    if (in_array($attempt['status'], ['submitted', 'expired'], true)) {
        respond(['error' => 'Assignment already completed'], 409);
    }
    $pq = peaklyyFindQuestionOnAttempt($attempt, $questionId);
    if (!$pq) {
        respond(['error' => 'Question not on this attempt'], 400);
    }
    $flags = peaklyyQuestionResponseFlags($pq, is_array($pq['task_schema'] ?? null) ? $pq['task_schema'] : null);
    if (!$flags['allow_upload']) {
        respond(['error' => 'File upload is not enabled for this question'], 400);
    }
    $file = $_FILES['file'] ?? $_FILES['answer_file'] ?? null;
    $path = savePeaklyyAnswerUpload(is_array($file) ? $file : null);
    $orig = is_array($file) ? basename((string) ($file['name'] ?? 'file')) : 'file';
    $merged = peaklyyUpsertAttemptAnswer($db, (string) $attempt['id'], $questionId, null, [
        'file_path' => $path,
        'file_name' => $orig,
    ]);
    // Optional text in same multipart request — also materialize as .txt notepad file
    if (isset($_POST['text'])) {
        $text = trim((string) $_POST['text']);
        $np = peaklyyPersistNotepadFile($attempt, $questionId, $text, is_array($merged) ? $merged : []);
        $merged = peaklyyUpsertAttemptAnswer($db, (string) $attempt['id'], $questionId, null, array_merge([
            'text' => $text,
        ], $np));
    }
    respond([
        'ok' => true,
        'question_id' => $questionId,
        'file_path' => $path,
        'file_name' => $orig,
        'notepad_file_path' => $merged['notepad_file_path'] ?? null,
        'notepad_file_name' => $merged['notepad_file_name'] ?? null,
        'saved' => $merged,
    ]);
}

// ── Submit ──
if ($action === 'submit' && $method === 'POST') {
    $token = trim((string) ($input['attempt_token'] ?? ''));
    $answersIn = $input['answers'] ?? [];
    if ($token === '' || !is_array($answersIn)) {
        respond(['error' => 'attempt_token and answers required'], 400);
    }
    $stmt = $db->prepare(
        'SELECT a.*, s.* FROM peaklyy_attempts a
         JOIN peaklyy_assessments s ON s.id = a.assessment_id
         WHERE a.public_token = ? LIMIT 1'
    );
    // ambiguous columns — fetch separately
    $stmt = $db->prepare('SELECT * FROM peaklyy_attempts WHERE public_token = ? LIMIT 1');
    $stmt->execute([$token]);
    $attempt = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$attempt) {
        respond(['error' => 'Attempt not found'], 404);
    }
    if ($attempt['status'] === 'submitted') {
        respond(['error' => 'Already submitted', 'attempt_token' => $token], 409);
    }

    // Serialize submit vs mid-test saves and prevent double-submit.
    try {
        $db->beginTransaction();
        $lockStmt = $db->prepare('SELECT * FROM peaklyy_attempts WHERE id = ? FOR UPDATE');
        $lockStmt->execute([(string) $attempt['id']]);
        $locked = $lockStmt->fetch(PDO::FETCH_ASSOC);
        if (!$locked) {
            $db->rollBack();
            respond(['error' => 'Attempt not found'], 404);
        }
        if (($locked['status'] ?? '') === 'submitted') {
            $db->rollBack();
            respond(['error' => 'Already submitted', 'attempt_token' => $token], 409);
        }
        $attempt = $locked;
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        respond(['error' => 'Could not lock attempt for submit'], 500);
    }

    $aStmt = $db->prepare('SELECT * FROM peaklyy_assessments WHERE id = ? LIMIT 1');
    $aStmt->execute([$attempt['assessment_id']]);
    $assessment = $aStmt->fetch(PDO::FETCH_ASSOC);
    $sourceMode = strtolower((string) ($assessment['source_mode'] ?? 'domain_bank'));
    $phase = strtolower((string) ($attempt['attempt_phase'] ?? 'mcq'));
    if ($phase === '' || $phase === 'single') {
        $phase = $sourceMode === 'domain_bank' ? 'mcq' : 'single';
    }

    $questions = json_decode((string) ($attempt['questions_json'] ?? '[]'), true) ?: [];
    if ($phase === 'mcq' && !empty($attempt['mcq_questions_json'])) {
        $mq = json_decode((string) $attempt['mcq_questions_json'], true);
        if (is_array($mq) && $mq) {
            $questions = $mq;
        }
    }
    if ($phase === 'task' && !empty($attempt['task_questions_json'])) {
        $tq = json_decode((string) $attempt['task_questions_json'], true);
        if (is_array($tq) && $tq) {
            $questions = $tq;
        }
    }
    $qMap = [];
    foreach ($questions as $q) {
        $qMap[$q['id']] = $q;
    }
    $ids = array_keys($qMap);
    $bank = peaklyyLoadScoringRows($db, $ids);

    $earned = 0;
    $max = 0;
    // Preserve mid-test saved answers for THIS phase's question IDs only
    $priorFiles = [];
    $phaseIds = $ids;
    $priorStmt = $db->prepare('SELECT question_id, answer_option, answer_json, is_correct, points_awarded FROM peaklyy_attempt_answers WHERE attempt_id = ?');
    $priorStmt->execute([$attempt['id']]);
    $otherAnswers = [];
    foreach ($priorStmt->fetchAll(PDO::FETCH_ASSOC) as $pr) {
        $qid = (string) $pr['question_id'];
        if (!in_array($qid, $phaseIds, true)) {
            $otherAnswers[] = $pr;
            continue;
        }
        $aj = $pr['answer_json'] ?? null;
        if (is_string($aj)) {
            $aj = json_decode($aj, true);
        }
        if (is_array($aj) && !empty($aj['file_path'])) {
            $priorFiles[$qid] = [
                'file_path' => (string) $aj['file_path'],
                'file_name' => (string) ($aj['file_name'] ?? ''),
                'text' => (string) ($aj['text'] ?? ''),
                'notepad_file_path' => (string) ($aj['notepad_file_path'] ?? ''),
                'notepad_file_name' => (string) ($aj['notepad_file_name'] ?? ''),
            ];
        } elseif (is_array($aj) && (isset($aj['text']) || !empty($aj['notepad_file_path']))) {
            $priorFiles[$qid] = [
                'text' => (string) ($aj['text'] ?? ''),
                'notepad_file_path' => (string) ($aj['notepad_file_path'] ?? ''),
                'notepad_file_name' => (string) ($aj['notepad_file_name'] ?? ''),
            ];
        }
    }
    if ($phaseIds) {
        $in = implode(',', array_fill(0, count($phaseIds), '?'));
        $del = $db->prepare("DELETE FROM peaklyy_attempt_answers WHERE attempt_id = ? AND question_id IN ($in)");
        $del->execute(array_merge([$attempt['id']], $phaseIds));
    }
    $ansIns = $db->prepare(
        'INSERT INTO peaklyy_attempt_answers (id, attempt_id, question_id, answer_option, answer_json, is_correct, points_awarded)
         VALUES (?,?,?,?,?,?,?)'
    );

    foreach ($questions as $pq) {
        $qid = $pq['id'];
        $bankRow = $bank[$qid] ?? null;
        $qType = strtolower((string) ($pq['q_type'] ?? ($bankRow['q_type'] ?? 'mcq')));
        $schema = $pq['task_schema'] ?? null;
        if (!is_array($schema) && !empty($bankRow['task_schema_json'])) {
            $schema = is_string($bankRow['task_schema_json'])
                ? json_decode($bankRow['task_schema_json'], true)
                : $bankRow['task_schema_json'];
        }
        $flags = peaklyyQuestionResponseFlags(array_merge($pq, ['q_type' => $qType]), is_array($schema) ? $schema : null);
        $points = (int) ($pq['points'] ?? ($bankRow['points'] ?? ($qType === 'task' ? 0 : 5)));
        if ($points > 0) {
            $max += $points;
        }
        $raw = $answersIn[$qid] ?? null;
        $isCorrect = 0;
        $awarded = 0;
        $opt = null;
        $ajPayload = [];
        $prior = $priorFiles[$qid] ?? [];

        if ($qType === 'mcq' || (!empty($pq['options']) || !empty($bankRow['options_json']))) {
            $opt = strtolower(trim((string) (is_array($raw) ? ($raw['option'] ?? '') : $raw)));
            if ($opt === '' && is_array($raw) && isset($raw['answer_option'])) {
                $opt = strtolower(trim((string) $raw['answer_option']));
            }
            $correct = strtolower((string) ($pq['correct_option'] ?? $bankRow['correct_option'] ?? ''));
            if ($opt !== '' && $opt === $correct) {
                $isCorrect = 1;
                $awarded = $points;
            }
        }

        if ($flags['allow_notepad'] || $qType === 'task') {
            $text = '';
            if (is_array($raw)) {
                $text = trim((string) ($raw['text'] ?? $raw['answer'] ?? ''));
            } elseif (is_string($raw) && ($qType === 'task' || $flags['allow_notepad'])) {
                if ($qType === 'task' || !in_array(strtolower($raw), ['a', 'b', 'c', 'd'], true)) {
                    $text = trim($raw);
                }
            }
            if ($text === '' && !empty($prior['text'])) {
                $text = (string) $prior['text'];
            }
            $ajPayload['text'] = $text;
            if ($text !== '') {
                $np = peaklyyPersistNotepadFile($attempt, (string) $qid, $text, $prior);
                $ajPayload = array_merge($ajPayload, $np);
            } elseif (!empty($prior['notepad_file_path'])) {
                $ajPayload['notepad_file_path'] = (string) $prior['notepad_file_path'];
                $ajPayload['notepad_file_name'] = (string) ($prior['notepad_file_name'] ?? '');
            }
        }

        if ($flags['allow_upload']) {
            $filePath = '';
            $fileName = '';
            if (is_array($raw)) {
                $filePath = trim((string) ($raw['file_path'] ?? ''));
                $fileName = trim((string) ($raw['file_name'] ?? ''));
            }
            if ($filePath === '' && !empty($prior['file_path'])) {
                $filePath = (string) $prior['file_path'];
                $fileName = (string) ($prior['file_name'] ?? '');
            }
            if ($filePath !== '') {
                $ajPayload['file_path'] = $filePath;
                $ajPayload['file_name'] = $fileName;
            }
        }

        $aj = $ajPayload ? json_encode($ajPayload, JSON_UNESCAPED_UNICODE) : null;
        $earned += $awarded;
        $ansIns->execute([generateUUID(), $attempt['id'], $qid, $opt, $aj, $isCorrect, $awarded]);
    }

    $startedTs = $attempt['started_at'] ? strtotime($attempt['started_at']) : time();
    $taken = max(0, time() - $startedTs);
    $unlockAt = date('Y-m-d H:i:s', time() + 30 * 60);
    $passScore = max(1, (int) ($assessment['pass_score'] ?? 70));

    $peaklyyCommitSubmit = static function () use ($db): void {
        if ($db->inTransaction()) {
            $db->commit();
        }
    };
    $peaklyyRollbackSubmit = static function () use ($db): void {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
    };

    // ── Task part: save answers, keep MCQ score, push score + uploads via API key webhook ──
    if ($phase === 'task') {
        try {
            $upd = $db->prepare(
                "UPDATE peaklyy_attempts SET status=?, attempt_phase=?, time_taken_seconds=?, submitted_at=NOW(), unlock_at=?
                 WHERE id=? AND status <> 'submitted'"
            );
            $upd->execute(['submitted', 'done', $taken, $unlockAt, $attempt['id']]);
            if ($upd->rowCount() < 1) {
                $peaklyyRollbackSubmit();
                respond(['error' => 'Already submitted', 'attempt_token' => $token], 409);
            }
        } catch (Throwable $e) {
            try {
                $upd = $db->prepare(
                    "UPDATE peaklyy_attempts SET status=?, time_taken_seconds=?, submitted_at=NOW(), unlock_at=?
                     WHERE id=? AND status <> 'submitted'"
                );
                $upd->execute(['submitted', $taken, $unlockAt, $attempt['id']]);
                if ($upd->rowCount() < 1) {
                    $peaklyyRollbackSubmit();
                    respond(['error' => 'Already submitted', 'attempt_token' => $token], 409);
                }
            } catch (Throwable $e2) {
                $peaklyyRollbackSubmit();
                respond(['error' => 'Submit failed'], 500);
            }
        }
        $peaklyyCommitSubmit();
        $score = (int) ($attempt['score'] ?? 0);
        $stars = (int) ($attempt['stars'] ?? 0);
        $passed = (int) ($attempt['passed'] ?? 0);
        $attempt['score'] = $score;
        $attempt['stars'] = $stars;
        $attempt['passed'] = $passed;
        $attempt['time_taken_seconds'] = $taken;
        $attempt['submitted_at'] = date('Y-m-d H:i:s');
        $attempt['attempt_phase'] = 'done';
        $attempt['status'] = 'submitted';

        // Reload for export (includes newly saved task answers)
        $fresh = $db->prepare('SELECT * FROM peaklyy_attempts WHERE id = ? LIMIT 1');
        $fresh->execute([$attempt['id']]);
        $attemptRow = $fresh->fetch(PDO::FETCH_ASSOC) ?: $attempt;
        $partner = peaklyyCollectAttemptPartnerPayload($db, $assessment ?: [], $attemptRow);
        $hook = peaklyySendWebhook(
            $assessment,
            $attemptRow,
            'peaklyy.assessment.complete',
            [
                'test_part' => 'complete',
                'score' => $partner['score'],
                'uploads' => $partner['uploads'],
                'tasks' => $partner['tasks'],
                'mcq_answers_count' => count($partner['mcq_answers']),
                'uploads_count' => count($partner['uploads']),
                'partner_result_url' => rtrim(peaklyyApiPublicBase(), '/') . '/api/assessments.php?action=partner_result&attempt_id=' . rawurlencode((string) $attempt['id']),
            ],
            false // send even if MCQ not passed — partner still gets uploads
        );
        $db->prepare('UPDATE peaklyy_attempts SET webhook_sent_at=IF(?, NOW(), NULL), webhook_status=?, webhook_response=? WHERE id=?')
            ->execute([$hook['sent'] ? 1 : 0, $hook['status'] ?? null, $hook['response'] ?? null, $attempt['id']]);

        peaklyyAppendTimeline($db, (string) $attempt['id'], 'task_submitted', 'Part 2 tasks submitted', [
            'uploads_count' => count($partner['uploads']),
            'score' => $score,
            'passed' => (bool) $passed,
        ]);
        if (!empty($hook['sent'])) {
            peaklyyAppendTimeline($db, (string) $attempt['id'], 'webhook_complete', 'Score + uploads webhook sent', [
                'status' => $hook['status'] ?? null,
                'uploads_count' => count($partner['uploads']),
            ]);
        }

        $redirect = null;
        if ($passed) {
            $redirect = $hook['redirect_url'] ?? null;
            if (!$redirect && !empty($assessment['result_webhook_url'])) {
                $redirect = $assessment['result_webhook_url'];
            }
        }

        respond([
            'phase' => 'task',
            'next_phase' => null,
            'score' => $score,
            'stars' => $stars,
            'passed' => (bool) $passed,
            'time_taken_seconds' => $taken,
            'unlock_at' => $unlockAt,
            'redirect_url' => $passed ? $redirect : null,
            'attempt_token' => $token,
            'tasks_submitted' => true,
            'uploads_count' => count($partner['uploads']),
            'message' => 'Practical tasks submitted. Score and uploads are available via API key.',
            'webhook' => ['sent' => !empty($hook['sent']), 'status' => $hook['status'] ?? null],
        ]);
    }

    // ── MCQ / single part scoring ──
    $score = $max > 0 ? (int) round(($earned / $max) * 100) : 0;
    $stars = peaklyyStars($score);
    $passed = $score >= $passScore ? 1 : 0;
    $attempt['score'] = $score;
    $attempt['stars'] = $stars;
    $attempt['passed'] = $passed;
    $attempt['time_taken_seconds'] = $taken;
    $attempt['submitted_at'] = date('Y-m-d H:i:s');

    $twoPart = $sourceMode === 'domain_bank' && $phase === 'mcq';
    if ($twoPart) {
        // Prepare task paper; keep status in_progress for part 2
        $taskPicked = peaklyyPickTaskQuestions($db, (string) $attempt['domain_key']);
        $taskQuestions = array_map('peaklyyPublicQuestion', $taskPicked);
        try {
            $db->prepare(
                "UPDATE peaklyy_attempts SET attempt_phase=?, score=?, stars=?, passed=?, time_taken_seconds=?,
                 mcq_submitted_at=COALESCE(mcq_submitted_at, NOW()),
                 mcq_questions_json=COALESCE(mcq_questions_json, questions_json),
                 task_questions_json=?, questions_json=? WHERE id=?"
            )->execute([
                'task',
                $score,
                $stars,
                $passed,
                $taken,
                json_encode($taskQuestions, JSON_UNESCAPED_UNICODE),
                json_encode($taskQuestions, JSON_UNESCAPED_UNICODE),
                $attempt['id'],
            ]);
        } catch (Throwable $e) {
            try {
                $db->prepare(
                    "UPDATE peaklyy_attempts SET attempt_phase=?, score=?, stars=?, passed=?, time_taken_seconds=?,
                     mcq_questions_json=COALESCE(mcq_questions_json, questions_json),
                     task_questions_json=?, questions_json=? WHERE id=?"
                )->execute([
                    'task',
                    $score,
                    $stars,
                    $passed,
                    $taken,
                    json_encode($taskQuestions, JSON_UNESCAPED_UNICODE),
                    json_encode($taskQuestions, JSON_UNESCAPED_UNICODE),
                    $attempt['id'],
                ]);
            } catch (Throwable $e2) {
                // Last-resort schema: still advance phase so task paper is not scored as MCQ later.
                $db->prepare(
                    'UPDATE peaklyy_attempts SET score=?, stars=?, passed=?, time_taken_seconds=?, questions_json=? WHERE id=?'
                )->execute([$score, $stars, $passed, $taken, json_encode($taskQuestions, JSON_UNESCAPED_UNICODE), $attempt['id']]);
                try {
                    $db->prepare("UPDATE peaklyy_attempts SET attempt_phase='task' WHERE id=?")->execute([$attempt['id']]);
                } catch (Throwable $e3) {
                    error_log('[peaklyy] could not set attempt_phase=task after MCQ: ' . $e3->getMessage());
                }
            }
        }
        $peaklyyCommitSubmit();
        peaklyyAppendTimeline($db, (string) $attempt['id'], 'mcq_submitted', 'Part 1 MCQ submitted', [
            'score' => $score,
            'stars' => $stars,
            'passed' => (bool) $passed,
        ]);

        $hook = peaklyySendWebhook($assessment, $attempt, 'peaklyy.assessment.mcq_passed', [
            'test_part' => 'mcq',
            'tasks_pending' => true,
            'score' => [
                'score' => $score,
                'stars' => $stars,
                'passed' => (bool) $passed,
                'part' => 'mcq',
            ],
            'uploads' => [],
            'partner_result_url' => rtrim(peaklyyApiPublicBase(), '/') . '/api/assessments.php?action=partner_result&attempt_id=' . rawurlencode((string) $attempt['id']),
        ], true);
        $db->prepare('UPDATE peaklyy_attempts SET webhook_sent_at=IF(?, NOW(), NULL), webhook_status=?, webhook_response=? WHERE id=?')
            ->execute([$hook['sent'] ? 1 : 0, $hook['status'] ?? null, $hook['response'] ?? null, $attempt['id']]);

        try {
            peaklyyUpdateLeadOnSubmit($db, $assessment ?: [], $attempt, $score, $stars, (int) $passed);
        } catch (Throwable $e) {
            error_log('[peaklyy] lead update after MCQ submit failed: ' . $e->getMessage());
        }

        if (!empty($hook['sent'])) {
            peaklyyAppendTimeline($db, (string) $attempt['id'], 'webhook_mcq', 'MCQ results webhook sent', [
                'status' => $hook['status'] ?? null,
            ]);
        }

        $redirect = null;
        if ($passed) {
            $redirect = $hook['redirect_url'] ?? null;
            if (!$redirect && !empty($assessment['result_webhook_url'])) {
                $redirect = $assessment['result_webhook_url'];
            }
        }

        respond([
            'phase' => 'mcq',
            'next_phase' => 'task',
            'score' => $score,
            'stars' => $stars,
            'passed' => (bool) $passed,
            'time_taken_seconds' => $taken,
            'unlock_at' => $unlockAt,
            'redirect_url' => $passed ? $redirect : null,
            'attempt_token' => $token,
            'task_questions' => $taskQuestions,
            'message' => 'MCQ test complete. Results posted to partner API. Continue to practical tasks (Part 2).',
            'webhook' => ['sent' => !empty($hook['sent']), 'status' => $hook['status'] ?? null],
        ]);
    }

    // Custom / single-part: fully submit
    try {
        $upd = $db->prepare(
            "UPDATE peaklyy_attempts SET status=?, attempt_phase=?, score=?, stars=?, passed=?, time_taken_seconds=?, submitted_at=NOW(), unlock_at=?
             WHERE id=? AND status <> 'submitted'"
        );
        $upd->execute(['submitted', 'done', $score, $stars, $passed, $taken, $unlockAt, $attempt['id']]);
        if ($upd->rowCount() < 1) {
            $peaklyyRollbackSubmit();
            respond(['error' => 'Already submitted', 'attempt_token' => $token], 409);
        }
    } catch (Throwable $e) {
        try {
            $upd = $db->prepare(
                "UPDATE peaklyy_attempts SET status=?, score=?, stars=?, passed=?, time_taken_seconds=?, submitted_at=NOW(), unlock_at=?
                 WHERE id=? AND status <> 'submitted'"
            );
            $upd->execute(['submitted', $score, $stars, $passed, $taken, $unlockAt, $attempt['id']]);
            if ($upd->rowCount() < 1) {
                $peaklyyRollbackSubmit();
                respond(['error' => 'Already submitted', 'attempt_token' => $token], 409);
            }
        } catch (Throwable $e2) {
            $peaklyyRollbackSubmit();
            respond(['error' => 'Submit failed'], 500);
        }
    }
    $peaklyyCommitSubmit();

    $freshSingle = $db->prepare('SELECT * FROM peaklyy_attempts WHERE id = ? LIMIT 1');
    $freshSingle->execute([$attempt['id']]);
    $attemptSingle = $freshSingle->fetch(PDO::FETCH_ASSOC) ?: $attempt;
    $partnerSingle = peaklyyCollectAttemptPartnerPayload($db, $assessment ?: [], $attemptSingle);
    $hook = peaklyySendWebhook($assessment, $attemptSingle, 'peaklyy.assessment.complete', [
        'test_part' => 'single',
        'score' => $partnerSingle['score'],
        'uploads' => $partnerSingle['uploads'],
        'tasks' => $partnerSingle['tasks'],
        'uploads_count' => count($partnerSingle['uploads']),
        'partner_result_url' => rtrim(peaklyyApiPublicBase(), '/') . '/api/assessments.php?action=partner_result&attempt_id=' . rawurlencode((string) $attempt['id']),
    ], true);
    $db->prepare('UPDATE peaklyy_attempts SET webhook_sent_at=IF(?, NOW(), NULL), webhook_status=?, webhook_response=? WHERE id=?')
        ->execute([$hook['sent'] ? 1 : 0, $hook['status'] ?? null, $hook['response'] ?? null, $attempt['id']]);

    try {
        peaklyyUpdateLeadOnSubmit($db, $assessment ?: [], $attempt, $score, $stars, (int) $passed);
    } catch (Throwable $e) {
        error_log('[peaklyy] lead update after submit failed: ' . $e->getMessage());
    }

    peaklyyAppendTimeline($db, (string) $attempt['id'], 'submitted', 'Assignment submitted', [
        'score' => $score,
        'stars' => $stars,
        'passed' => (bool) $passed,
        'uploads_count' => count($partnerSingle['uploads']),
    ]);
    if (!empty($hook['sent'])) {
        peaklyyAppendTimeline($db, (string) $attempt['id'], 'webhook_complete', 'Results webhook sent', [
            'status' => $hook['status'] ?? null,
        ]);
    }

    $redirect = null;
    if ($passed) {
        $redirect = $hook['redirect_url'] ?? null;
        if (!$redirect && !empty($assessment['result_webhook_url'])) {
            $redirect = $assessment['result_webhook_url'];
        }
    }

    $interestOpts = [];
    if (!empty($assessment['interest_options_json'])) {
        $decoded = json_decode((string) $assessment['interest_options_json'], true);
        if (is_array($decoded)) {
            foreach ($decoded as $opt) {
                $opt = trim((string) $opt);
                if ($opt !== '') {
                    $interestOpts[] = $opt;
                }
            }
        }
    }
    $isSyncpedia = (($assessment['slug'] ?? '') === syncpediaFresherBasicsSlug()) || (($assessment['ui_theme'] ?? '') === 'syncpedia');
    if ($isSyncpedia) {
        $interestOpts = [];
    }

    respond([
        'phase' => 'single',
        'next_phase' => null,
        'score' => $score,
        'stars' => $stars,
        'passed' => (bool) $passed,
        'time_taken_seconds' => $taken,
        'unlock_at' => $unlockAt,
        'redirect_url' => $passed && !$interestOpts ? $redirect : null,
        'attempt_token' => $token,
        'require_interests' => count($interestOpts) > 0,
        'interest_options' => $interestOpts,
        'webhook' => ['sent' => !empty($hook['sent']), 'status' => $hook['status'] ?? null],
    ]);
}

// ── Save post-test interest topics (multi-select) ──
if ($action === 'save_interests' && $method === 'POST') {
    $token = trim((string) ($input['attempt_token'] ?? ''));
    $selected = $input['interests'] ?? [];
    if ($token === '' || !is_array($selected)) {
        respond(['error' => 'attempt_token and interests[] required'], 400);
    }
    $stmt = $db->prepare('SELECT * FROM peaklyy_attempts WHERE public_token = ? LIMIT 1');
    $stmt->execute([$token]);
    $attempt = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$attempt) {
        respond(['error' => 'Attempt not found'], 404);
    }
    if (($attempt['status'] ?? '') !== 'submitted') {
        respond(['error' => 'Complete the test before selecting interests'], 409);
    }
    $aStmt = $db->prepare('SELECT * FROM peaklyy_assessments WHERE id = ? LIMIT 1');
    $aStmt->execute([$attempt['assessment_id']]);
    $assessment = $aStmt->fetch(PDO::FETCH_ASSOC) ?: [];
    $allowed = [];
    if (!empty($assessment['interest_options_json'])) {
        $decoded = json_decode((string) $assessment['interest_options_json'], true);
        if (is_array($decoded)) {
            $allowed = array_values(array_filter(array_map(static fn($x) => trim((string) $x), $decoded)));
        }
    }
    if (!$allowed && ((($assessment['slug'] ?? '') === syncpediaFresherBasicsSlug()) || (($assessment['slug'] ?? '') === syncpediaAssignmentSlug()))) {
        $allowed = syncpediaFresherInterestTopics();
    }
    if (!$allowed) {
        respond(['error' => 'This assessment does not collect interest topics'], 400);
    }
    $picked = [];
    foreach ($selected as $s) {
        $s = trim((string) $s);
        if ($s !== '' && in_array($s, $allowed, true) && !in_array($s, $picked, true)) {
            $picked[] = $s;
        }
    }
    if (count($picked) < 1) {
        respond(['error' => 'Select at least one topic'], 422);
    }
    $json = json_encode($picked, JSON_UNESCAPED_UNICODE);
    try {
        $db->prepare('UPDATE peaklyy_attempts SET interest_selected_json = ? WHERE id = ?')->execute([$json, $attempt['id']]);
    } catch (Throwable $e) {
        respond(['error' => 'Could not save interests (redeploy API / run schema update)'], 500);
    }
    peaklyyAppendTimeline($db, (string) $attempt['id'], 'interests_saved', 'Interest topics selected', [
        'interests' => $picked,
    ]);
    // Tag CRM lead with interests
    try {
        $leadId = trim((string) ($attempt['lead_id'] ?? ''));
        if ($leadId === '') {
            // resolve by email if lead_id not on attempt
            $email = strtolower(trim((string) ($attempt['email'] ?? '')));
            if ($email !== '') {
                $ls = $db->prepare('SELECT id, tags, course_interest FROM leads WHERE email = ? ORDER BY created_at DESC LIMIT 1');
                $ls->execute([$email]);
                $lead = $ls->fetch(PDO::FETCH_ASSOC);
            } else {
                $lead = null;
            }
        } else {
            $ls = $db->prepare('SELECT id, tags, course_interest FROM leads WHERE id = ? LIMIT 1');
            $ls->execute([$leadId]);
            $lead = $ls->fetch(PDO::FETCH_ASSOC);
        }
        if ($lead) {
            $tags = trim((string) ($lead['tags'] ?? ''));
            $interestTag = 'interests:' . implode('|', $picked);
            $tags = $tags === '' ? $interestTag : ($tags . ',' . $interestTag);
            $course = implode(', ', $picked);
            try {
                $db->prepare('UPDATE leads SET tags = ?, course_interest = ?, updated_at = NOW() WHERE id = ?')
                    ->execute([$tags, $course, $lead['id']]);
            } catch (Throwable $e2) {
                $db->prepare('UPDATE leads SET tags = ?, course_interest = ? WHERE id = ?')
                    ->execute([$tags, $course, $lead['id']]);
            }
        }
    } catch (Throwable $e) {
        error_log('[syncpedia] interest lead update: ' . $e->getMessage());
    }
    respond([
        'success' => true,
        'interests' => $picked,
        'message' => 'Interest topics saved',
    ]);
}

// ── Result (candidate token) ──
if ($action === 'result' && $method === 'GET') {
    $token = trim((string) ($_GET['attempt_token'] ?? ''));
    $stmt = $db->prepare(
        'SELECT a.*, s.title, s.brand_name, s.brand_tagline, s.result_webhook_url
         FROM peaklyy_attempts a
         JOIN peaklyy_assessments s ON s.id = a.assessment_id
         WHERE a.public_token = ? LIMIT 1'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || $row['status'] !== 'submitted') {
        respond(['error' => 'Result not found'], 404);
    }
    $unlockTs = $row['unlock_at'] ? strtotime($row['unlock_at']) : 0;
    $unlocked = $unlockTs > 0 && time() >= $unlockTs;
    $redirect = null;
    if ((int) $row['passed'] && !empty($row['result_webhook_url'])) {
        $redirect = $row['result_webhook_url'];
    }
    respond([
        'full_name' => $row['full_name'],
        'score' => (int) $row['score'],
        'stars' => (int) $row['stars'],
        'passed' => (bool) (int) $row['passed'],
        'time_taken_seconds' => (int) $row['time_taken_seconds'],
        'domain_key' => $row['domain_key'],
        'domain_label' => peaklyyDomainCatalog()[$row['domain_key']] ?? $row['domain_key'],
        'title' => $row['title'],
        'brand_name' => $row['brand_name'],
        'brand_tagline' => $row['brand_tagline'],
        'breakdown_unlocked' => $unlocked,
        'unlock_at' => $row['unlock_at'],
        'unlock_in_seconds' => $unlocked ? 0 : max(0, $unlockTs - time()),
        'redirect_url' => $redirect,
    ]);
}

/**
 * Resolve assessment by permanent API key (partner).
 */
function peaklyyAssessmentByApiKey(PDO $db, string $key): ?array
{
    $key = trim($key);
    if ($key === '') {
        return null;
    }
    $stmt = $db->prepare('SELECT * FROM peaklyy_assessments WHERE result_api_key = ? LIMIT 1');
    $stmt->execute([$key]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

// ── Partner: list recent attempts (score summary) with API key ──
if ($action === 'partner_attempts' && $method === 'GET') {
    $key = peaklyyRequestApiKey();
    if ($key === '') {
        respond(['error' => 'X-Assessment-Api-Key header required'], 401);
    }
    $assessment = peaklyyAssessmentByApiKey($db, $key);
    if (!$assessment) {
        respond(['error' => 'Invalid assessment API key'], 403);
    }
    $limit = max(1, min(200, (int) ($_GET['limit'] ?? 50)));
    $stmt = $db->prepare(
        'SELECT id, full_name, email, phone, domain_key, status, attempt_phase, score, stars, passed,
                time_taken_seconds, submitted_at, created_at
         FROM peaklyy_attempts WHERE assessment_id = ? ORDER BY created_at DESC LIMIT ' . (int) $limit
    );
    try {
        $stmt->execute([$assessment['id']]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        $stmt = $db->prepare(
            'SELECT id, full_name, email, phone, domain_key, status, score, stars, passed,
                    time_taken_seconds, submitted_at, created_at
             FROM peaklyy_attempts WHERE assessment_id = ? ORDER BY created_at DESC LIMIT ' . (int) $limit
        );
        $stmt->execute([$assessment['id']]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
    $base = rtrim(peaklyyApiPublicBase(), '/');
    $out = [];
    foreach ($rows as $r) {
        $out[] = [
            'attempt_id' => $r['id'],
            'full_name' => $r['full_name'],
            'email' => $r['email'],
            'domain_key' => $r['domain_key'],
            'status' => $r['status'],
            'attempt_phase' => $r['attempt_phase'] ?? null,
            'score' => isset($r['score']) ? (int) $r['score'] : null,
            'stars' => isset($r['stars']) ? (int) $r['stars'] : null,
            'passed' => isset($r['passed']) ? (bool) (int) $r['passed'] : null,
            'submitted_at' => $r['submitted_at'] ?? null,
            'partner_result_url' => ($base !== '' ? $base : '') . '/api/assessments.php?action=partner_result&attempt_id=' . rawurlencode((string) $r['id']),
        ];
    }
    respond([
        'ok' => true,
        'assessment_id' => $assessment['id'],
        'assessment_slug' => $assessment['slug'],
        'data' => $out,
    ]);
}

// ── Partner: fetch score + uploads with API key ──
if ($action === 'partner_result' && $method === 'GET') {
    $key = peaklyyRequestApiKey();
    if ($key === '') {
        respond(['error' => 'X-Assessment-Api-Key header required'], 401);
    }
    $assessment = peaklyyAssessmentByApiKey($db, $key);
    if (!$assessment) {
        respond(['error' => 'Invalid assessment API key'], 403);
    }
    $attemptId = trim((string) ($_GET['attempt_id'] ?? ''));
    $email = strtolower(trim((string) ($_GET['email'] ?? '')));
    $attempt = null;
    if ($attemptId !== '') {
        $stmt = $db->prepare('SELECT * FROM peaklyy_attempts WHERE id = ? AND assessment_id = ? LIMIT 1');
        $stmt->execute([$attemptId, $assessment['id']]);
        $attempt = $stmt->fetch(PDO::FETCH_ASSOC);
    } elseif ($email !== '') {
        $stmt = $db->prepare(
            'SELECT * FROM peaklyy_attempts WHERE assessment_id = ? AND email = ? ORDER BY created_at DESC LIMIT 1'
        );
        $stmt->execute([$assessment['id'], $email]);
        $attempt = $stmt->fetch(PDO::FETCH_ASSOC);
    } else {
        respond(['error' => 'attempt_id or email required'], 400);
    }
    if (!$attempt) {
        respond(['error' => 'Attempt not found for this API key'], 404);
    }
    $payload = peaklyyCollectAttemptPartnerPayload($db, $assessment, $attempt);
    respond([
        'ok' => true,
        'data' => $payload,
        'score' => $payload['score'],
        'uploads' => $payload['uploads'],
        'tasks' => $payload['tasks'],
    ]);
}

// ── Partner: download a task upload with API key ──
if ($action === 'partner_file' && $method === 'GET') {
    $key = peaklyyRequestApiKey();
    if ($key === '') {
        respond(['error' => 'X-Assessment-Api-Key header required'], 401);
    }
    $assessment = peaklyyAssessmentByApiKey($db, $key);
    if (!$assessment) {
        respond(['error' => 'Invalid assessment API key'], 403);
    }
    $attemptId = trim((string) ($_GET['attempt_id'] ?? ''));
    $questionId = trim((string) ($_GET['question_id'] ?? ''));
    if ($attemptId === '' || $questionId === '') {
        respond(['error' => 'attempt_id and question_id required'], 400);
    }
    $stmt = $db->prepare('SELECT * FROM peaklyy_attempts WHERE id = ? AND assessment_id = ? LIMIT 1');
    $stmt->execute([$attemptId, $assessment['id']]);
    $attempt = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$attempt) {
        respond(['error' => 'Attempt not found'], 404);
    }
    $ans = $db->prepare(
        'SELECT answer_json FROM peaklyy_attempt_answers WHERE attempt_id = ? AND question_id = ? LIMIT 1'
    );
    $ans->execute([$attemptId, $questionId]);
    $row = $ans->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        respond(['error' => 'Answer not found'], 404);
    }
    $aj = $row['answer_json'] ?? null;
    if (is_string($aj)) {
        $aj = json_decode($aj, true);
    }
    $filePath = is_array($aj) ? trim((string) ($aj['file_path'] ?? '')) : '';
    $fileName = is_array($aj) ? trim((string) ($aj['file_name'] ?? 'download')) : 'download';
    if ($filePath === '' || strpos($filePath, '/uploads/assessment_answers/') !== 0 || strpos($filePath, '..') !== false) {
        respond(['error' => 'No upload for this answer'], 404);
    }
    $candidates = [
        dirname(__DIR__) . str_replace('/', DIRECTORY_SEPARATOR, $filePath),
        __DIR__ . '/../uploads' . str_replace('/', DIRECTORY_SEPARATOR, substr($filePath, strlen('/uploads'))),
    ];
    $abs = null;
    foreach ($candidates as $candidate) {
        $resolved = realpath($candidate);
        if ($resolved && is_file($resolved) && strpos(str_replace('\\', '/', $resolved), '/uploads/assessment_answers/') !== false) {
            $abs = $resolved;
            break;
        }
    }
    if ($abs === null) {
        respond(['error' => 'File not found on disk'], 404);
    }
    $mime = 'application/octet-stream';
    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($abs) ?: $mime;
    }
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . (string) filesize($abs));
    header('Content-Disposition: attachment; filename="' . str_replace('"', '', $fileName ?: basename($abs)) . '"');
    header('X-Content-Type-Options: nosniff');
    readfile($abs);
    exit;
}

respond(['error' => 'Unknown action'], 404);
