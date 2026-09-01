<?php
/**
 * Syncpedia fresher basics assessment — Cybersecurity, Ethical Hacking, AI.
 * 15 MCQs: 5 easy + 10 medium. 12 minutes. Post-test multi-interest topics.
 */

function syncpediaFresherBasicsSlug(): string
{
    return 'syncpedia-fresher-basics';
}

function syncpediaFresherBasicsApiKey(): string
{
    return 'syncpedia_fresher_basics_v1';
}

/** @return list<string> */
function syncpediaFresherInterestTopics(): array
{
    return [
        'Cybersecurity',
        'Ethical Hacking',
        'Artificial Intelligence',
    ];
}

/**
 * Custom MCQ defs for peaklyyInsertCustomQuestions.
 * @return list<array<string,mixed>>
 */
function syncpediaFresherBasicsQuestionDefs(): array
{
    // 5 easy + 10 medium — basics only, fresher-friendly.
    $qs = [];

    // —— Easy (5) ——
    $qs[] = [
        'prompt' => 'What does the “C” in the CIA triad stand for?',
        'option_a' => 'Confidentiality',
        'option_b' => 'Connectivity',
        'option_c' => 'Computation',
        'option_d' => 'Certification',
        'correct_option' => 'a',
        'points' => 1,
    ];
    $qs[] = [
        'prompt' => 'An ethical hacker is someone who…',
        'option_a' => 'Breaks into systems with permission to find and fix weaknesses',
        'option_b' => 'Steals data for personal gain',
        'option_c' => 'Only installs antivirus software',
        'option_d' => 'Writes malware for sale',
        'correct_option' => 'a',
        'points' => 1,
    ];
    $qs[] = [
        'prompt' => 'Artificial Intelligence (AI) mainly aims to…',
        'option_a' => 'Make machines perform tasks that usually need human intelligence',
        'option_b' => 'Replace electricity in computers',
        'option_c' => 'Increase hard-disk size only',
        'option_d' => 'Build physical robots only',
        'correct_option' => 'a',
        'points' => 1,
    ];
    $qs[] = [
        'prompt' => 'Which is a strong password practice?',
        'option_a' => 'Long unique password with letters, numbers, and symbols',
        'option_b' => 'Using your name and birth year',
        'option_c' => 'Reusing one password everywhere',
        'option_d' => 'Writing the password on a sticky note on the monitor',
        'correct_option' => 'a',
        'points' => 1,
    ];
    $qs[] = [
        'prompt' => 'Machine Learning is best described as…',
        'option_a' => 'Systems that learn patterns from data instead of only hard-coded rules',
        'option_b' => 'Manually typing every possible answer into a program',
        'option_c' => 'A type of computer hardware chip only',
        'option_d' => 'A method to charge a battery faster',
        'correct_option' => 'a',
        'points' => 1,
    ];

    // —— Medium (10) ——
    $qs[] = [
        'prompt' => 'Phishing attacks usually try to…',
        'option_a' => 'Trick people into sharing passwords or clicking malicious links',
        'option_b' => 'Cool down a server’s CPU',
        'option_c' => 'Speed up Wi‑Fi legally',
        'option_d' => 'Backup files automatically',
        'correct_option' => 'a',
        'points' => 1,
    ];
    $qs[] = [
        'prompt' => 'Two-factor authentication (2FA) adds security by…',
        'option_a' => 'Requiring something you know plus something you have (e.g. OTP)',
        'option_b' => 'Using a longer username only',
        'option_c' => 'Disabling all passwords forever',
        'option_d' => 'Sharing accounts with teammates',
        'correct_option' => 'a',
        'points' => 1,
    ];
    $qs[] = [
        'prompt' => 'Malware is best defined as…',
        'option_a' => 'Software designed to harm, steal, or misuse a system or data',
        'option_b' => 'Any free mobile app',
        'option_c' => 'A type of computer monitor',
        'option_d' => 'A safe system update',
        'correct_option' => 'a',
        'points' => 1,
    ];
    $qs[] = [
        'prompt' => 'A vulnerability is…',
        'option_a' => 'A weakness that could be exploited to harm a system',
        'option_b' => 'A strong firewall rule',
        'option_c' => 'A type of keyboard',
        'option_d' => 'A backup server',
        'correct_option' => 'a',
        'points' => 1,
    ];
    $qs[] = [
        'prompt' => 'Before testing a company’s website for security flaws, an ethical hacker must…',
        'option_a' => 'Get written authorization / permission',
        'option_b' => 'Post findings publicly first',
        'option_c' => 'Use the CEO’s personal email without asking',
        'option_d' => 'Disable the company’s antivirus secretly',
        'correct_option' => 'a',
        'points' => 1,
    ];
    $qs[] = [
        'prompt' => '“Social engineering” mainly attacks…',
        'option_a' => 'People (trust and behaviour), not only technical systems',
        'option_b' => 'Only hardware chips',
        'option_c' => 'Only printer ink levels',
        'option_d' => 'Only battery life',
        'correct_option' => 'a',
        'points' => 1,
    ];
    $qs[] = [
        'prompt' => 'Penetration testing is…',
        'option_a' => 'An authorized simulated attack to find security weaknesses',
        'option_b' => 'Installing games on office PCs',
        'option_c' => 'Deleting all logs permanently',
        'option_d' => 'Changing the company logo',
        'correct_option' => 'a',
        'points' => 1,
    ];
    $qs[] = [
        'prompt' => 'Training data in AI is used to…',
        'option_a' => 'Teach a model patterns so it can make predictions or decisions',
        'option_b' => 'Charge the laptop battery',
        'option_c' => 'Print paper reports only',
        'option_d' => 'Increase Wi‑Fi range',
        'correct_option' => 'a',
        'points' => 1,
    ];
    $qs[] = [
        'prompt' => 'A chatbot that answers customer questions is an example of…',
        'option_a' => 'An AI application that understands and responds to language',
        'option_b' => 'A physical server rack only',
        'option_c' => 'A type of USB cable',
        'option_d' => 'A spreadsheet formula only',
        'correct_option' => 'a',
        'points' => 1,
    ];
    $qs[] = [
        'prompt' => 'Bias in AI models can happen when…',
        'option_a' => 'Training data is unfair, incomplete, or not representative',
        'option_b' => 'The computer screen is too bright',
        'option_c' => 'The keyboard is wireless',
        'option_d' => 'The room temperature changes',
        'correct_option' => 'a',
        'points' => 1,
    ];

    return $qs;
}

/**
 * Ensure Syncpedia fresher assessment exists (idempotent).
 */
function syncpediaEnsureFresherBasicsAssessment(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    try {
        $db->exec("ALTER TABLE peaklyy_assessments ADD COLUMN ui_theme VARCHAR(32) NOT NULL DEFAULT 'peaklyy'");
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_assessments ADD COLUMN interest_options_json JSON NULL');
    } catch (Throwable $e) {
    }
    try {
        $db->exec('ALTER TABLE peaklyy_attempts ADD COLUMN interest_selected_json JSON NULL');
    } catch (Throwable $e) {
    }

    $slug = syncpediaFresherBasicsSlug();
    $st = $db->prepare('SELECT id FROM peaklyy_assessments WHERE slug = ? LIMIT 1');
    $st->execute([$slug]);
    $existingId = $st->fetchColumn();

    $interestsJson = json_encode(syncpediaFresherInterestTopics(), JSON_UNESCAPED_UNICODE);
    $apiKey = syncpediaFresherBasicsApiKey();
    $defs = syncpediaFresherBasicsQuestionDefs();

    if ($existingId) {
        try {
            $db->prepare(
                "UPDATE peaklyy_assessments SET
                    title = ?, brand_name = ?, brand_tagline = ?,
                    duration_minutes = 12, question_count = ?, source_mode = 'custom',
                    pass_score = 60, once_per_candidate = 1, anti_cheat = 0, is_active = 1,
                    ui_theme = 'syncpedia', interest_options_json = ?,
                    result_api_key = COALESCE(NULLIF(result_api_key,''), ?)
                 WHERE id = ?"
            )->execute([
                'Syncpedia Fresher Basics Assessment',
                'Syncpedia',
                'Cybersecurity · Ethical Hacking · AI — basics for freshers',
                count($defs),
                $interestsJson,
                $apiKey,
                $existingId,
            ]);
        } catch (Throwable $e) {
            try {
                $db->prepare(
                    "UPDATE peaklyy_assessments SET title = ?, brand_name = ?, brand_tagline = ?,
                     duration_minutes = 12, question_count = ?, is_active = 1 WHERE id = ?"
                )->execute([
                    'Syncpedia Fresher Basics Assessment',
                    'Syncpedia',
                    'Cybersecurity · Ethical Hacking · AI — basics for freshers',
                    count($defs),
                    $existingId,
                ]);
            } catch (Throwable $e2) {
            }
        }
        // Refresh questions if empty
        try {
            $c = $db->prepare('SELECT COUNT(*) FROM peaklyy_assessment_questions WHERE assessment_id = ? AND is_active = 1');
            $c->execute([$existingId]);
            if ((int) $c->fetchColumn() < 1 && function_exists('peaklyyInsertCustomQuestions')) {
                peaklyyInsertCustomQuestions($db, (string) $existingId, $defs);
            }
        } catch (Throwable $e) {
        }
        return;
    }

    $id = function_exists('generateUUID') ? generateUUID() : bin2hex(random_bytes(16));
    try {
        $db->prepare(
            "INSERT INTO peaklyy_assessments
             (id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, source_mode,
              pass_score, once_per_candidate, anti_cheat, result_webhook_url, result_api_key, is_active, created_by,
              ui_theme, interest_options_json)
             VALUES (?,?,?,?,?,12,?, 'custom', 60, 1, 0, NULL, ?, 1, NULL, 'syncpedia', ?)"
        )->execute([
            $id,
            $slug,
            'Syncpedia Fresher Basics Assessment',
            'Syncpedia',
            'Cybersecurity · Ethical Hacking · AI — basics for freshers',
            count($defs),
            $apiKey,
            $interestsJson,
        ]);
    } catch (Throwable $e) {
        try {
            $db->prepare(
                "INSERT INTO peaklyy_assessments
                 (id, slug, title, brand_name, brand_tagline, duration_minutes, question_count, source_mode,
                  pass_score, once_per_candidate, anti_cheat, result_api_key, is_active)
                 VALUES (?,?,?,?,?,12,?, 'custom', 60, 1, 0, ?, 1)"
            )->execute([
                $id,
                $slug,
                'Syncpedia Fresher Basics Assessment',
                'Syncpedia',
                'Cybersecurity · Ethical Hacking · AI — basics for freshers',
                count($defs),
                $apiKey,
            ]);
            try {
                $db->prepare("UPDATE peaklyy_assessments SET ui_theme = 'syncpedia', interest_options_json = ? WHERE id = ?")
                    ->execute([$interestsJson, $id]);
            } catch (Throwable $e2) {
            }
        } catch (Throwable $e3) {
            error_log('[syncpedia fresher] create assessment: ' . $e3->getMessage());
            return;
        }
    }

    if (function_exists('peaklyyInsertCustomQuestions')) {
        $n = peaklyyInsertCustomQuestions($db, $id, $defs);
        if ($n > 0) {
            try {
                $db->prepare('UPDATE peaklyy_assessments SET question_count = ? WHERE id = ?')->execute([$n, $id]);
            } catch (Throwable $e) {
            }
        }
    }
}
