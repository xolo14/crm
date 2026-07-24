<?php
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/lib/PeaklyyQuestions.php';
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
    $done = true;
}

function peaklyyEnsureApiKeys(PDO $db): void
{
    $rows = $db->query("SELECT id, slug FROM peaklyy_assessments WHERE result_api_key IS NULL OR result_api_key = ''")->fetchAll(PDO::FETCH_ASSOC);
    $upd = $db->prepare('UPDATE peaklyy_assessments SET result_api_key = ? WHERE id = ?');
    foreach ($rows as $r) {
        $upd->execute([peaklyyGenerateApiKey(), $r['id']]);
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
        $type = 'mcq';
        $options = $q['options'] ?? null;
        $correct = null;
        $schema = null;
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
        // Skip incomplete MCQs
        if (trim((string) ($options['a'] ?? '')) === '' || trim((string) ($options['b'] ?? '')) === '') {
            continue;
        }
        $ins->execute([
            generateUUID(),
            $assessmentId,
            $type,
            $prompt,
            json_encode($options, JSON_UNESCAPED_UNICODE),
            $correct,
            null,
            max(1, (int) ($q['points'] ?? 5)),
            (int) ($q['sort_order'] ?? ($i + 1)),
        ]);
        $n++;
    }
    return $n;
}

function peaklyyPickCustomQuestions(PDO $db, string $assessmentId, int $count): array
{
    $stmt = $db->prepare(
        "SELECT * FROM peaklyy_assessment_questions
         WHERE assessment_id = ? AND is_active = 1 AND q_type = 'mcq'
         ORDER BY sort_order ASC"
    );
    $stmt->execute([$assessmentId]);
    $all = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (!$all) {
        return [];
    }
    foreach ($all as &$row) {
        $row['domain_key'] = 'custom';
        $row['level_key'] = 'custom';
    }
    unset($row);
    if ($count > 0 && count($all) > $count) {
        shuffle($all);
        return array_slice($all, 0, $count);
    }
    return $all;
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
    $count = (int) $db->query('SELECT COUNT(*) FROM peaklyy_question_bank')->fetchColumn();
    if ($count > 0) {
        return;
    }
    $ins = $db->prepare(
        'INSERT INTO peaklyy_question_bank
         (id, domain_key, level_key, q_type, prompt, options_json, correct_option, task_schema_json, points, sort_order, is_active)
         VALUES (?,?,?,?,?,?,?,?,?,?,1)'
    );
    foreach (peaklyyQuestionDefinitions() as $q) {
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
    $path = '/assessment/' . rawurlencode($slug) . '?key=' . rawurlencode($apiKey);
    return $base !== '' ? ($base . $path) : $path;
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
    $title = trim((string) ($assessment['title'] ?? 'Peaklyy Assessment')) ?: 'Peaklyy Assessment';
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
    return [
        'id' => $row['id'],
        'domain_key' => $row['domain_key'] ?? 'custom',
        'level_key' => $row['level_key'] ?? 'custom',
        'q_type' => 'mcq',
        'prompt' => $row['prompt'],
        'options' => is_array($options) ? $options : null,
        'points' => (int) ($row['points'] ?? 5),
    ];
}

function peaklyyPickQuestions(PDO $db, string $domain, int $count): array
{
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
    $targetEasy = (int) max(1, round($count * 0.4));
    $targetMed = (int) max(1, round($count * 0.35));
    $targetHard = max(1, $count - $targetEasy - $targetMed);
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
    if (count($selected) < $count) {
        $ids = array_column($selected, 'id');
        $rest = array_values(array_filter($all, static fn($r) => !in_array($r['id'], $ids, true)));
        shuffle($rest);
        $selected = array_merge($selected, array_slice($rest, 0, $count - count($selected)));
    }
    shuffle($selected);
    return array_slice($selected, 0, $count);
}

function peaklyySendWebhook(array $assessment, array $attempt): array
{
    $url = trim((string) ($assessment['result_webhook_url'] ?? ''));
    $key = trim((string) ($assessment['result_api_key'] ?? ''));
    if ($url === '' || empty($attempt['passed'])) {
        return ['sent' => false, 'status' => 'skipped'];
    }
    $payload = [
        'event' => 'peaklyy.assessment.passed',
        'assessment_id' => $assessment['id'],
        'assessment_slug' => $assessment['slug'],
        'attempt_id' => $attempt['id'],
        'api_key' => $key,
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
        ],
        'redirect_hint' => true,
    ];
    // If URL looks like a page (no /api/ path), also support GET-style handoff via redirect
    $redirectWithResults = $url . (str_contains($url, '?') ? '&' : '?') . http_build_query([
        'peaklyy' => '1',
        'api_key' => $key,
        'score' => (int) $attempt['score'],
        'stars' => (int) $attempt['stars'],
        'passed' => 1,
        'email' => $attempt['email'],
        'name' => $attempt['full_name'],
        'domain' => $attempt['domain_key'],
        'attempt_id' => $attempt['id'],
    ]);
    $ch = curl_init($url);
    $headers = ['Content-Type: application/json', 'Accept: application/json'];
    if ($key !== '') {
        $headers[] = 'Authorization: Bearer ' . $key;
        $headers[] = 'X-API-Key: ' . $key;
    }
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    $jr = is_string($body) ? json_decode($body, true) : null;
    $finalRedirect = $redirectWithResults;
    if (is_array($jr) && !empty($jr['redirect_url'])) {
        $finalRedirect = (string) $jr['redirect_url'];
    }
    return [
        'sent' => $code >= 200 && $code < 300 || $code === 0,
        'status' => $code ? ('http_' . $code) : ('curl_' . $err),
        'response' => is_string($body) ? mb_substr($body, 0, 2000) : '',
        'redirect_url' => $finalRedirect,
    ];
}

peaklyyEnsureTables($db);
peaklyySeedBank($db);
peaklyyEnsureApiKeys($db);

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
    requireRole($token, ['super_admin']);
    $rows = $db->query('SELECT * FROM peaklyy_assessments ORDER BY created_at DESC')->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) {
        $key = trim((string) ($r['result_api_key'] ?? ''));
        $r['open_url'] = $key !== ''
            ? peaklyyOpenUrl((string) $r['slug'], $key)
            : (peaklyyPublicBase() . '/assessment/' . rawurlencode((string) $r['slug']));
    }
    unset($r);
    respond(['data' => $rows, 'domains' => peaklyyDomainCatalog()]);
}

if ($action === 'create' && $method === 'POST') {
    $token = verifyToken();
    requireRole($token, ['super_admin']);
    $title = trim((string) ($input['title'] ?? 'Peaklyy Domain Screening'));
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
    $duration = max(5, (int) ($input['duration_minutes'] ?? 15));
    $qCount = max(1, min(50, (int) ($input['question_count'] ?? 15)));
    if ($sourceMode === 'custom') {
        if (count($customQs) < 1) {
            respond(['error' => 'Add at least one MCQ'], 400);
        }
        $qCount = count($customQs);
    }
    $webhook = trim((string) ($input['result_webhook_url'] ?? '')) ?: null;
    try {
        $db->prepare(
            'INSERT INTO peaklyy_assessments
             (id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, source_mode, pass_score, once_per_candidate, anti_cheat, result_webhook_url, result_api_key, is_active, created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)'
        )->execute([
            $id, $slug, $title,
            trim((string) ($input['brand_name'] ?? 'PEAKLYY')) ?: 'PEAKLYY',
            trim((string) ($input['brand_tagline'] ?? 'Learn · Earn · Grow')) ?: 'Learn · Earn · Grow',
            $duration, $qCount, $sourceMode, 70,
            !empty($input['once_per_candidate']) || !isset($input['once_per_candidate']) ? 1 : 0,
            !empty($input['anti_cheat']) || !isset($input['anti_cheat']) ? 1 : 0,
            $webhook, $apiKey, $token['user_id'] ?? null,
        ]);
    } catch (Throwable $e) {
        $db->prepare(
            'INSERT INTO peaklyy_assessments
             (id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, pass_score, once_per_candidate, anti_cheat, result_webhook_url, result_api_key, is_active, created_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)'
        )->execute([
            $id, $slug, $title,
            trim((string) ($input['brand_name'] ?? 'PEAKLYY')) ?: 'PEAKLYY',
            trim((string) ($input['brand_tagline'] ?? 'Learn · Earn · Grow')) ?: 'Learn · Earn · Grow',
            $duration, $qCount, 70,
            !empty($input['once_per_candidate']) || !isset($input['once_per_candidate']) ? 1 : 0,
            !empty($input['anti_cheat']) || !isset($input['anti_cheat']) ? 1 : 0,
            $webhook, $apiKey, $token['user_id'] ?? null,
        ]);
        try {
            $db->prepare('UPDATE peaklyy_assessments SET source_mode = ? WHERE id = ?')->execute([$sourceMode, $id]);
        } catch (Throwable $e2) {
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
        'message' => 'Assessment created with permanent API key',
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

if ($action === 'attempts' && $method === 'GET') {
    $token = verifyToken();
    requireRole($token, ['super_admin']);
    $aid = trim((string) ($_GET['assessment_id'] ?? ''));
    if ($aid === '') {
        respond(['error' => 'assessment_id required'], 400);
    }
    $stmt = $db->prepare(
        'SELECT id, full_name, email, phone, domain_key, degree_branch, college_name, status, score, stars, passed,
                time_taken_seconds, violation_count, started_at, submitted_at, webhook_status, created_at
         FROM peaklyy_attempts WHERE assessment_id = ? ORDER BY created_at DESC LIMIT 500'
    );
    $stmt->execute([$aid]);
    respond(['data' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
}

// ── Public: load assessment by slug ──
if ($action === 'public_get' && $method === 'GET') {
    $slug = trim((string) ($_GET['slug'] ?? ''));
    $key = trim((string) ($_GET['key'] ?? ''));
    if ($slug === '') {
        respond(['error' => 'slug required'], 400);
    }
    $stmt = $db->prepare('SELECT id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, pass_score, once_per_candidate, anti_cheat, is_active, result_api_key, source_mode FROM peaklyy_assessments WHERE slug = ? LIMIT 1');
    try {
        $stmt->execute([$slug]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        $stmt = $db->prepare('SELECT id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, pass_score, once_per_candidate, anti_cheat, is_active, result_api_key FROM peaklyy_assessments WHERE slug = ? LIMIT 1');
        $stmt->execute([$slug]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            $row['source_mode'] = 'domain_bank';
        }
    }
    if (!$row || !(int) $row['is_active']) {
        respond(['error' => 'Assessment not found'], 404);
    }
    if (!isset($row['source_mode'])) {
        $row['source_mode'] = 'domain_bank';
    }
    $storedKey = trim((string) ($row['result_api_key'] ?? ''));
    // If assessment has a permanent API key, require matching ?key= to open
    if ($storedKey !== '' && !hash_equals($storedKey, $key)) {
        respond(['error' => 'Invalid or missing assessment API key. Open via the permanent link with ?key='], 403);
    }
    unset($row['result_api_key']);
    $passScore = max(1, (int) ($row['pass_score'] ?? 70));
    $duration = max(1, (int) ($row['duration_minutes'] ?? 15));
    $qCount = max(1, (int) ($row['question_count'] ?? 15));
    $sourceMode = strtolower((string) ($row['source_mode'] ?? 'domain_bank'));
    if ($sourceMode === 'custom') {
        try {
            $cntStmt = $db->prepare(
                "SELECT COUNT(*) FROM peaklyy_assessment_questions
                 WHERE assessment_id = ? AND is_active = 1 AND q_type = 'mcq'"
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
    $row['duration_minutes'] = $duration;
    $row['question_count'] = $qCount;
    $row['pass_score'] = $passScore;
    respond([
        'data' => $row,
        'domains' => peaklyyDomainCatalog(),
        'degrees' => peaklyyDegreeOptions(),
        'instructions' => [
            'Duration: ' . $duration . ' minutes',
            $qCount . ' MCQ question' . ($qCount === 1 ? '' : 's'),
            'Full screen required once the test starts',
            'No tab switching or leaving the page',
            'Copy and paste is disabled',
            'Leaving or switching tabs auto-submits the test',
            !empty($row['once_per_candidate']) ? 'Test allowed only once per candidate' : 'Multiple attempts may be allowed',
            'Score ' . $passScore . '+ to pass (1★ at 70, 2★ at 80, 3★ at 90, 4★ at 100). Below ' . $passScore . ' = Not pass',
        ],
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
    if ($sourceMode === 'custom') {
        $domain = 'custom';
    } elseif (!isset($domains[$domain])) {
        respond(['error' => 'Please select a valid domain'], 400);
    }
    if ((int) $assessment['once_per_candidate']) {
        $chk = $db->prepare(
            "SELECT id FROM peaklyy_attempts
             WHERE assessment_id = ? AND email = ? AND domain_key = ? AND status IN ('submitted','in_progress','expired')
             LIMIT 1"
        );
        $chk->execute([$assessment['id'], $email, $domain]);
        if ($chk->fetch()) {
            respond(['error' => 'You have already taken this assessment for this domain'], 409);
        }
    }
    $id = generateUUID();
    $token = generateUUID();
    $db->prepare(
        'INSERT INTO peaklyy_attempts
         (id, assessment_id, public_token, full_name, email, phone, domain_key, degree_branch, college_name, status)
         VALUES (?,?,?,?,?,?,?,?,?,\'registered\')'
    )->execute([$id, $assessment['id'], $token, $fullName, $email, $phone, $domain, $degree ?: null, $college ?: null]);
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
    if ($token === '') {
        respond(['error' => 'attempt_token required'], 400);
    }
    $stmt = $db->prepare('SELECT a.*, s.duration_minutes, s.question_count, s.anti_cheat, s.title, s.brand_name, s.source_mode
                          FROM peaklyy_attempts a
                          JOIN peaklyy_assessments s ON s.id = a.assessment_id
                          WHERE a.public_token = ? LIMIT 1');
    $stmt->execute([$token]);
    $attempt = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$attempt) {
        respond(['error' => 'Attempt not found'], 404);
    }
    if (in_array($attempt['status'], ['submitted', 'expired'], true)) {
        respond(['error' => 'Assessment already completed'], 409);
    }
    $questions = [];
    if (!empty($attempt['questions_json'])) {
        $decoded = json_decode((string) $attempt['questions_json'], true);
        if (is_array($decoded)) {
            $questions = $decoded;
        }
    }
    if (!$questions) {
        $mode = strtolower((string) ($attempt['source_mode'] ?? 'domain_bank'));
        if ($mode === 'custom') {
            // Always use every active custom MCQ (count must match what admin saved)
            $picked = peaklyyPickCustomQuestions($db, (string) $attempt['assessment_id'], 0);
            $live = count($picked);
            if ($live > 0 && $live !== (int) $attempt['question_count']) {
                $db->prepare('UPDATE peaklyy_assessments SET question_count = ? WHERE id = ?')
                    ->execute([$live, $attempt['assessment_id']]);
            }
        } else {
            $picked = peaklyyPickQuestions($db, $attempt['domain_key'], (int) $attempt['question_count']);
        }
        if (!$picked) {
            respond(['error' => $mode === 'custom' ? 'No custom questions on this assessment' : 'No questions available for this domain'], 500);
        }
        $questions = array_map('peaklyyPublicQuestion', $picked);
        $db->prepare('UPDATE peaklyy_attempts SET status = ?, started_at = COALESCE(started_at, NOW()), questions_json = ? WHERE id = ?')
            ->execute(['in_progress', json_encode($questions, JSON_UNESCAPED_UNICODE), $attempt['id']]);
    } else {
        $db->prepare('UPDATE peaklyy_attempts SET status = ?, started_at = COALESCE(started_at, NOW()) WHERE id = ?')
            ->execute(['in_progress', $attempt['id']]);
    }
    $started = $attempt['started_at'] ?: date('Y-m-d H:i:s');
    $endsAt = date('c', strtotime($started) + ((int) $attempt['duration_minutes'] * 60));
    $domainLabel = peaklyyDomainCatalog()[$attempt['domain_key']] ?? $attempt['domain_key'];
    if (($attempt['domain_key'] ?? '') === 'custom') {
        $domainLabel = $attempt['title'] ?: 'Custom Assessment';
    }
    respond([
        'attempt_id' => $attempt['id'],
        'duration_minutes' => (int) $attempt['duration_minutes'],
        'ends_at' => $endsAt,
        'anti_cheat' => (bool) (int) $attempt['anti_cheat'],
        'domain_key' => $attempt['domain_key'],
        'domain_label' => $domainLabel,
        'questions' => $questions,
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
    $aStmt = $db->prepare('SELECT * FROM peaklyy_assessments WHERE id = ? LIMIT 1');
    $aStmt->execute([$attempt['assessment_id']]);
    $assessment = $aStmt->fetch(PDO::FETCH_ASSOC);
    $questions = json_decode((string) ($attempt['questions_json'] ?? '[]'), true) ?: [];
    $qMap = [];
    foreach ($questions as $q) {
        $qMap[$q['id']] = $q;
    }
    // load scoring data from domain bank + custom assessment questions
    $ids = array_keys($qMap);
    $bank = peaklyyLoadScoringRows($db, $ids);

    $earned = 0;
    $max = 0;
    $db->prepare('DELETE FROM peaklyy_attempt_answers WHERE attempt_id = ?')->execute([$attempt['id']]);
    $ansIns = $db->prepare(
        'INSERT INTO peaklyy_attempt_answers (id, attempt_id, question_id, answer_option, answer_json, is_correct, points_awarded)
         VALUES (?,?,?,?,?,?,?)'
    );

    foreach ($questions as $pq) {
        $qid = $pq['id'];
        $bankRow = $bank[$qid] ?? null;
        $points = (int) ($pq['points'] ?? ($bankRow['points'] ?? 5));
        $max += $points;
        $raw = $answersIn[$qid] ?? null;
        $isCorrect = 0;
        $awarded = 0;
        $opt = null;
        $aj = null;
        if (($pq['q_type'] ?? 'mcq') === 'mcq' || !empty($pq['options']) || !empty($bankRow['options_json'])) {
            $opt = strtolower(trim((string) (is_array($raw) ? ($raw['option'] ?? '') : $raw)));
            $correct = strtolower((string) ($bankRow['correct_option'] ?? ''));
            if ($opt !== '' && $opt === $correct) {
                $isCorrect = 1;
                $awarded = $points;
            }
        }
        $earned += $awarded;
        $ansIns->execute([generateUUID(), $attempt['id'], $qid, $opt, $aj, $isCorrect, $awarded]);
    }

    $score = $max > 0 ? (int) round(($earned / $max) * 100) : 0;
    $stars = peaklyyStars($score);
    $passScore = max(1, (int) ($assessment['pass_score'] ?? 70));
    $passed = $score >= $passScore ? 1 : 0;
    $startedTs = $attempt['started_at'] ? strtotime($attempt['started_at']) : time();
    $taken = max(0, time() - $startedTs);
    $unlockAt = date('Y-m-d H:i:s', time() + 30 * 60);

    $db->prepare(
        'UPDATE peaklyy_attempts SET status=?, score=?, stars=?, passed=?, time_taken_seconds=?, submitted_at=NOW(), unlock_at=? WHERE id=?'
    )->execute(['submitted', $score, $stars, $passed, $taken, $unlockAt, $attempt['id']]);

    $attempt['score'] = $score;
    $attempt['stars'] = $stars;
    $attempt['passed'] = $passed;
    $attempt['time_taken_seconds'] = $taken;
    $attempt['submitted_at'] = date('Y-m-d H:i:s');

    $hook = peaklyySendWebhook($assessment, $attempt);
    $db->prepare('UPDATE peaklyy_attempts SET webhook_sent_at=IF(?, NOW(), NULL), webhook_status=?, webhook_response=? WHERE id=?')
        ->execute([$hook['sent'] ? 1 : 0, $hook['status'] ?? null, $hook['response'] ?? null, $attempt['id']]);

    try {
        peaklyyUpdateLeadOnSubmit($db, $assessment ?: [], $attempt, $score, $stars, (int) $passed);
    } catch (Throwable $e) {
        // ignore lead update failures
    }

    $redirect = null;
    if ($passed) {
        $redirect = $hook['redirect_url'] ?? null;
        if (!$redirect && !empty($assessment['result_webhook_url'])) {
            $redirect = $assessment['result_webhook_url'];
        }
    }

    respond([
        'score' => $score,
        'stars' => $stars,
        'passed' => (bool) $passed,
        'time_taken_seconds' => $taken,
        'unlock_at' => $unlockAt,
        'redirect_url' => $passed ? $redirect : null,
        'attempt_token' => $token,
        'webhook' => ['sent' => !empty($hook['sent']), 'status' => $hook['status'] ?? null],
    ]);
}

// ── Result ──
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

respond(['error' => 'Unknown action'], 404);
