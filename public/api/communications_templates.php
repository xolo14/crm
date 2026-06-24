<?php
/**
 * Meta Official Partner + Platform Template Library helpers.
 */

function commTplMigrationPaths(): array
{
    return [
        __DIR__ . '/../migrations/meta_partner_templates_2026_06_18.sql',
        __DIR__ . '/../../php-backend/migrations/meta_partner_templates_2026_06_18.sql',
    ];
}

function commEnsurePartnerTables(PDO $db): void
{
    static $done = false;
    if ($done) {
        return;
    }
    foreach (commTplMigrationPaths() as $path) {
        if (!is_readable($path)) {
            continue;
        }
        $sql = file_get_contents($path);
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
            if ($stmt === '') {
                continue;
            }
            try {
                $db->exec($stmt);
            } catch (Throwable $e) {
            }
        }
        break;
    }
    commSeedPlatformTemplates($db);
    $done = true;
}

function commSeedPlatformTemplates(PDO $db): void
{
    try {
        $count = (int) $db->query('SELECT COUNT(*) FROM platform_template_library')->fetchColumn();
    } catch (Throwable $e) {
        return;
    }
    if ($count > 0) {
        return;
    }

    $templates = [
        [
            'slug' => 'appointment_reminder',
            'name' => 'Appointment Reminder',
            'description' => 'Remind customers about upcoming appointments. Utility — typically fast Meta approval.',
            'use_case' => 'Sales calls, demos, counselling sessions',
            'category' => 'utility',
            'template_type' => 'appointment',
            'body' => "Hello {{1}}, this is a reminder for your appointment on {{2}} at {{3}}. Reply YES to confirm or call us if you need to reschedule.",
            'footer' => 'Syncpedia',
            'variables' => [
                ['key' => '1', 'label' => 'Customer name', 'example' => 'Priya'],
                ['key' => '2', 'label' => 'Date', 'example' => '20 June 2026'],
                ['key' => '3', 'label' => 'Time', 'example' => '3:00 PM'],
            ],
        ],
        [
            'slug' => 'order_confirmation',
            'name' => 'Order / Enrollment Confirmation',
            'description' => 'Confirm a purchase or course enrollment with order details.',
            'use_case' => 'Course enrollment, product orders',
            'category' => 'utility',
            'template_type' => 'order',
            'body' => "Hi {{1}}, your enrollment for {{2}} is confirmed. Order ID: {{3}}. Amount: {{4}}. Thank you for choosing us!",
            'footer' => null,
            'variables' => [
                ['key' => '1', 'label' => 'Customer name', 'example' => 'Arun'],
                ['key' => '2', 'label' => 'Course / product', 'example' => 'Digital Marketing'],
                ['key' => '3', 'label' => 'Order ID', 'example' => 'ORD-1024'],
                ['key' => '4', 'label' => 'Amount', 'example' => '₹15,000'],
            ],
        ],
        [
            'slug' => 'payment_reminder',
            'name' => 'Payment Reminder',
            'description' => 'Polite payment due reminder with amount and due date.',
            'use_case' => 'Fee collection, invoice follow-up',
            'category' => 'utility',
            'template_type' => 'payment',
            'body' => "Dear {{1}}, a payment of {{2}} is due on {{3}} for {{4}}. Please complete payment to avoid service interruption.",
            'footer' => 'Reply PAID after payment',
            'variables' => [
                ['key' => '1', 'label' => 'Customer name', 'example' => 'Kavya'],
                ['key' => '2', 'label' => 'Amount', 'example' => '₹5,000'],
                ['key' => '3', 'label' => 'Due date', 'example' => '25 June 2026'],
                ['key' => '4', 'label' => 'Description', 'example' => 'June fee'],
            ],
        ],
        [
            'slug' => 'interview_schedule',
            'name' => 'Interview / Meeting Schedule',
            'description' => 'Schedule interviews or meetings with date, time and location/link.',
            'use_case' => 'HR, admissions, sales meetings',
            'category' => 'utility',
            'template_type' => 'meeting',
            'body' => "Hi {{1}}, your {{2}} is scheduled on {{3}} at {{4}}. Location/Link: {{5}}. Please be on time.",
            'variables' => [
                ['key' => '1', 'label' => 'Candidate name', 'example' => 'Rahul'],
                ['key' => '2', 'label' => 'Meeting type', 'example' => 'Interview'],
                ['key' => '3', 'label' => 'Date', 'example' => '22 June 2026'],
                ['key' => '4', 'label' => 'Time', 'example' => '11:00 AM'],
                ['key' => '5', 'label' => 'Location or link', 'example' => 'Zoom link'],
            ],
        ],
        [
            'slug' => 'account_update',
            'name' => 'Account Update',
            'description' => 'Notify users about account or profile updates.',
            'use_case' => 'Profile changes, status updates',
            'category' => 'utility',
            'template_type' => 'account',
            'body' => "Hello {{1}}, your account has been updated: {{2}}. If you did not request this, contact support immediately.",
            'variables' => [
                ['key' => '1', 'label' => 'User name', 'example' => 'Suresh'],
                ['key' => '2', 'label' => 'Update summary', 'example' => 'Email changed'],
            ],
        ],
        [
            'slug' => 'otp_verification',
            'name' => 'OTP Verification',
            'description' => 'Authentication OTP for login or verification.',
            'use_case' => 'Login, phone verification',
            'category' => 'authentication',
            'template_type' => 'otp',
            'body' => "{{1}} is your verification code. Valid for {{2}} minutes. Do not share this code with anyone.",
            'footer' => 'Security code',
            'variables' => [
                ['key' => '1', 'label' => 'OTP code', 'example' => '482910'],
                ['key' => '2', 'label' => 'Validity minutes', 'example' => '10'],
            ],
            'meta_partner_preapproved' => 0,
        ],
        [
            'slug' => 'welcome_message',
            'name' => 'Welcome Message',
            'description' => 'Welcome new leads or customers after signup.',
            'use_case' => 'Lead welcome, onboarding',
            'category' => 'marketing',
            'template_type' => 'welcome',
            'body' => "Welcome {{1}}! Thank you for your interest in {{2}}. Our team will contact you shortly. Visit: {{3}}",
            'variables' => [
                ['key' => '1', 'label' => 'Name', 'example' => 'Anita'],
                ['key' => '2', 'label' => 'Company / course', 'example' => 'Syncpedia Academy'],
                ['key' => '3', 'label' => 'Website URL', 'example' => 'https://syncpedia.in'],
            ],
            'meta_partner_preapproved' => 0,
        ],
        [
            'slug' => 'follow_up_lead',
            'name' => 'Lead Follow-up',
            'description' => 'Follow up with leads who showed interest.',
            'use_case' => 'Sales follow-up, counselling',
            'category' => 'marketing',
            'template_type' => 'followup',
            'body' => "Hi {{1}}, following up on your enquiry about {{2}}. Would you like to schedule a call? Reply YES or call {{3}}.",
            'variables' => [
                ['key' => '1', 'label' => 'Lead name', 'example' => 'Vikram'],
                ['key' => '2', 'label' => 'Product / course', 'example' => 'MBA counselling'],
                ['key' => '3', 'label' => 'Contact number', 'example' => '+91 98765 43210'],
            ],
            'meta_partner_preapproved' => 0,
        ],
        [
            'slug' => 'feedback_request',
            'name' => 'Feedback Request',
            'description' => 'Request feedback after service or course completion.',
            'use_case' => 'Post-training, post-sale',
            'category' => 'marketing',
            'template_type' => 'feedback',
            'body' => "Hi {{1}}, we hope you enjoyed {{2}}. Please share your feedback here: {{3}}. Your opinion helps us improve!",
            'variables' => [
                ['key' => '1', 'label' => 'Customer name', 'example' => 'Meera'],
                ['key' => '2', 'label' => 'Service name', 'example' => 'Python course'],
                ['key' => '3', 'label' => 'Feedback link', 'example' => 'https://forms.gle/xxx'],
            ],
            'meta_partner_preapproved' => 0,
        ],
        [
            'slug' => 'course_batch_update',
            'name' => 'Batch / Class Update',
            'description' => 'Inform students about batch timing or class changes.',
            'use_case' => 'Training institutes, ed-tech',
            'category' => 'utility',
            'template_type' => 'education',
            'body' => "Dear {{1}}, your {{2}} batch class on {{3}} is {{4}}. Batch: {{5}}. Contact {{6}} for queries.",
            'variables' => [
                ['key' => '1', 'label' => 'Student name', 'example' => 'Divya'],
                ['key' => '2', 'label' => 'Course name', 'example' => 'Data Science'],
                ['key' => '3', 'label' => 'Date', 'example' => '21 June 2026'],
                ['key' => '4', 'label' => 'Update type', 'example' => 'rescheduled to 5 PM'],
                ['key' => '5', 'label' => 'Batch name', 'example' => 'DS-2026-A'],
                ['key' => '6', 'label' => 'Support contact', 'example' => 'trainer@syncpedia.in'],
            ],
        ],
    ];

    $editable = json_encode(['body' => true, 'header_text' => true, 'footer' => true, 'name' => true]);
    $sort = 0;
    foreach ($templates as $t) {
        $sort += 10;
        $id = generateUUID();
        $vars = json_encode($t['variables'] ?? []);
        $preapproved = (int) ($t['meta_partner_preapproved'] ?? 1);
        $db->prepare('INSERT INTO platform_template_library (id, slug, name, description, use_case, category, template_type, language, header_type, body, footer, variables, editable_fields, meta_partner_preapproved, meta_quality_tier, sort_order, is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)')
            ->execute([
                $id,
                $t['slug'],
                $t['name'],
                $t['description'] ?? null,
                $t['use_case'] ?? null,
                $t['category'],
                $t['template_type'],
                'en',
                'none',
                $t['body'],
                $t['footer'] ?? null,
                $vars,
                $editable,
                $preapproved,
                $preapproved ? 'high' : 'standard',
                $sort,
            ]);
    }
}

/** @return array<string,mixed> */
function commLoadPartnerConfig(PDO $db): array
{
    commEnsurePartnerTables($db);
    $row = $db->query('SELECT * FROM meta_partner_config ORDER BY updated_at DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : [];
}

/** @return array<string,mixed> */
function commFormatPartnerConfigForResponse(array $row, bool $includeSecrets): array
{
    if ($row === []) {
        return [
            'partner_status' => 'pending',
            'business_verification' => 'not_started',
            'solution_name' => 'Syncpedia CRM',
            'is_active' => false,
            'embedded_signup_url' => commBuildEmbeddedSignupUrl([]),
        ];
    }
    if (!$includeSecrets) {
        unset($row['system_user_token']);
        $row['system_user_token_set'] = !empty($row['system_user_token']);
    } else {
        $row['system_user_token_masked'] = commMaskKey($row['system_user_token'] ?? '');
        $row['system_user_token_set'] = !empty($row['system_user_token']);
    }
    $row['embedded_signup_url'] = commBuildEmbeddedSignupUrl($row);
    return $row;
}

/** @param array<string,mixed> $cfg */
function commBuildEmbeddedSignupUrl(array $cfg): string
{
    $appId = trim((string) ($cfg['meta_app_id'] ?? ''));
    if ($appId === '') {
        return '';
    }
    $configId = trim((string) ($cfg['embedded_signup_config_id'] ?? ''));
    $params = ['app_id' => $appId];
    if ($configId !== '') {
        $params['config_id'] = $configId;
    }
    return 'https://business.facebook.com/messaging/whatsapp/onboard/?' . http_build_query($params);
}

/** @return array<string,mixed>|null */
function commLoadLibraryTemplate(PDO $db, string $id): ?array
{
    commEnsurePartnerTables($db);
    $stmt = $db->prepare('SELECT * FROM platform_template_library WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return is_array($row) ? $row : null;
}

/**
 * @param array<string,mixed> $library
 * @param array<string,mixed> $custom
 * @return array{body:string,header_text:?string,footer:?string,name:string,customization_json:array}
 */
function commMergeTemplateCustomization(array $library, array $custom): array
{
    $editable = json_decode((string) ($library['editable_fields'] ?? '{}'), true);
    if (!is_array($editable)) {
        $editable = ['body' => true, 'header_text' => true, 'footer' => true, 'name' => true];
    }

    $body = (string) $library['body'];
    $headerText = $library['header_text'] ?? null;
    $footer = $library['footer'] ?? null;
    $name = (string) $library['name'];
    $saved = ['library_slug' => $library['slug'] ?? ''];

    if (!empty($editable['body']) && isset($custom['body']) && trim((string) $custom['body']) !== '') {
        $body = trim((string) $custom['body']);
        $saved['body'] = $body;
    }
    if (!empty($editable['header_text']) && array_key_exists('header_text', $custom)) {
        $headerText = $custom['header_text'] !== null && $custom['header_text'] !== '' ? (string) $custom['header_text'] : null;
        $saved['header_text'] = $headerText;
    }
    if (!empty($editable['footer']) && array_key_exists('footer', $custom)) {
        $footer = $custom['footer'] !== null && $custom['footer'] !== '' ? (string) $custom['footer'] : null;
        $saved['footer'] = $footer;
    }
    if (!empty($editable['name']) && isset($custom['name']) && trim((string) $custom['name']) !== '') {
        $name = trim((string) $custom['name']);
        $saved['name'] = $name;
    }
    if (!empty($custom['variable_examples']) && is_array($custom['variable_examples'])) {
        $saved['variable_examples'] = $custom['variable_examples'];
    }

    return [
        'body' => $body,
        'header_text' => $headerText,
        'footer' => $footer,
        'name' => $name,
        'customization_json' => $saved,
    ];
}

function commMetaPartnerClient(PDO $db): MetaWhatsApp
{
    $cfg = commLoadPartnerConfig($db);
    return new MetaWhatsApp([
        'api_key' => $cfg['system_user_token'] ?? '',
        'phone_number_id' => '',
        'waba_id' => $cfg['master_waba_id'] ?? '',
        'graph_api_version' => 'v21.0',
    ]);
}

/**
 * @param array<string,mixed> $tpl
 * @param array<string,mixed>|null $library
 * @return array<string,mixed>
 */
function commSubmitOrgTemplateToMeta(PDO $db, string $orgId, array $tpl, ?array $library = null): array
{
    $meta = commMetaClientForOrg($db, $orgId);
    $metaName = trim((string) ($tpl['provider_template_id'] ?? ''));
    if ($metaName === '') {
        $base = MetaWhatsApp::sanitizeTemplateName((string) $tpl['name']);
        $metaName = $library && !empty($library['slug'])
            ? MetaWhatsApp::sanitizeTemplateName((string) $library['slug'] . '_' . substr(str_replace('-', '', $orgId), 0, 8))
            : $base;
    }
    $result = $meta->createMessageTemplate(
        $metaName,
        (string) ($tpl['category'] ?? ($library['category'] ?? 'utility')),
        (string) ($tpl['language'] ?? 'en'),
        (string) $tpl['body'],
        $tpl['footer'] ?? null,
        (string) ($tpl['header_type'] ?? 'none'),
        $tpl['header_text'] ?? null
    );
    if ($result['ok'] && $library && !empty($library['meta_partner_preapproved'])) {
        $result['partner_preapproved'] = true;
        $result['message_hint'] = 'Submitted via Syncpedia Meta Partner library — utility templates typically approve within hours.';
    }
    return $result;
}
