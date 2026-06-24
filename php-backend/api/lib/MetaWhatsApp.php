<?php
/**
 * Meta WhatsApp Cloud API client (Graph API).
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api
 */
class MetaWhatsApp
{
    private string $accessToken;
    private string $phoneNumberId;
    private string $wabaId;
    private string $graphVersion;
    private ?string $appSecret;

    public function __construct(array $config)
    {
        $this->accessToken = trim((string) ($config['api_key'] ?? ''));
        $this->phoneNumberId = trim((string) ($config['phone_number_id'] ?? ''));
        $this->wabaId = trim((string) ($config['waba_id'] ?? ''));
        $this->graphVersion = trim((string) ($config['graph_api_version'] ?? 'v21.0')) ?: 'v21.0';
        $appSecret = $config['app_secret'] ?? null;
        $this->appSecret = is_string($appSecret) && $appSecret !== '' ? $appSecret : null;
    }

    public static function fromPlatformConfig(array $config): self
    {
        return new self($config);
    }

    public function isConfigured(): bool
    {
        return $this->accessToken !== '' && $this->phoneNumberId !== '';
    }

    /** E.164 digits only (no +) for Meta `to` field */
    public static function normalizePhone(string $phone): string
    {
        $digits = preg_replace('/\D+/', '', $phone);
        if ($digits === null || $digits === '') {
            return '';
        }
        // India: 10-digit local → 91 prefix
        if (strlen($digits) === 10 && $digits[0] >= '6' && $digits[0] <= '9') {
            $digits = '91' . $digits;
        }
        return $digits;
    }

    /** Map CRM language code to Meta locale */
    public static function metaLanguageCode(string $lang): string
    {
        $lang = strtolower(trim($lang));
        $map = [
            'en' => 'en_US',
            'en_us' => 'en_US',
            'en_gb' => 'en_GB',
            'hi' => 'hi',
            'ta' => 'ta',
            'te' => 'te',
            'mr' => 'mr',
            'gu' => 'gu',
            'kn' => 'kn',
            'ml' => 'ml',
            'bn' => 'bn',
        ];
        return $map[$lang] ?? str_replace('-', '_', $lang);
    }

    /** Meta template names: lowercase alphanumeric + underscore */
    public static function sanitizeTemplateName(string $name): string
    {
        $n = strtolower(trim($name));
        $n = preg_replace('/[^a-z0-9_]+/', '_', $n) ?? '';
        $n = trim($n, '_');
        return $n !== '' ? $n : 'template_' . substr(bin2hex(random_bytes(4)), 0, 8);
    }

    /**
     * @return array{ok:bool,status?:int,data?:array,error?:string,raw?:string}
     */
    public function graphRequest(string $method, string $path, ?array $body = null): array
    {
        if ($this->accessToken === '') {
            return ['ok' => false, 'error' => 'Meta access token is not configured'];
        }
        $url = 'https://graph.facebook.com/' . $this->graphVersion . '/' . ltrim($path, '/');
        $ch = curl_init($url);
        $headers = [
            'Authorization: Bearer ' . $this->accessToken,
            'Content-Type: application/json',
        ];
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 45,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
        }
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($raw === false) {
            return ['ok' => false, 'error' => 'Meta API unreachable: ' . ($curlErr ?: 'unknown'), 'status' => 0];
        }

        $data = json_decode($raw, true);
        if (!is_array($data)) {
            return ['ok' => false, 'error' => 'Invalid JSON from Meta', 'status' => $status, 'raw' => $raw];
        }
        if ($status >= 400 || !empty($data['error'])) {
            $err = $data['error']['message'] ?? $data['error']['error_user_msg'] ?? json_encode($data['error']);
            return ['ok' => false, 'error' => (string) $err, 'status' => $status, 'data' => $data];
        }
        return ['ok' => true, 'status' => $status, 'data' => $data];
    }

    /** Verify token + phone number ID by fetching phone number metadata */
    public function testConnection(): array
    {
        if (!$this->isConfigured()) {
            return ['ok' => false, 'error' => 'Access token and Phone Number ID are required'];
        }
        $res = $this->graphRequest('GET', $this->phoneNumberId . '?fields=display_phone_number,verified_name,quality_rating');
        if (!$res['ok']) {
            return $res;
        }
        return [
            'ok' => true,
            'display_phone_number' => $res['data']['display_phone_number'] ?? null,
            'verified_name' => $res['data']['verified_name'] ?? null,
            'quality_rating' => $res['data']['quality_rating'] ?? null,
        ];
    }

    /**
     * Send approved template message.
     * @param array<int,string> $bodyParams
     * @param array<int,string> $headerTextParams
     */
    public function sendTemplateMessage(
        string $toPhone,
        string $templateName,
        string $languageCode,
        array $bodyParams = [],
        array $headerTextParams = []
    ): array {
        $to = self::normalizePhone($toPhone);
        if ($to === '') {
            return ['ok' => false, 'error' => 'Invalid recipient phone number'];
        }
        $templateName = self::sanitizeTemplateName($templateName);
        $components = [];

        if ($headerTextParams !== []) {
            $components[] = [
                'type' => 'header',
                'parameters' => array_map(static fn ($t) => ['type' => 'text', 'text' => (string) $t], $headerTextParams),
            ];
        }
        if ($bodyParams !== []) {
            $components[] = [
                'type' => 'body',
                'parameters' => array_map(static fn ($t) => ['type' => 'text', 'text' => (string) $t], $bodyParams),
            ];
        }

        $payload = [
            'messaging_product' => 'whatsapp',
            'recipient_type' => 'individual',
            'to' => $to,
            'type' => 'template',
            'template' => [
                'name' => $templateName,
                'language' => ['code' => self::metaLanguageCode($languageCode)],
            ],
        ];
        if ($components !== []) {
            $payload['template']['components'] = $components;
        }

        $res = $this->graphRequest('POST', $this->phoneNumberId . '/messages', $payload);
        if (!$res['ok']) {
            return $res;
        }
        $msgId = $res['data']['messages'][0]['id'] ?? null;
        return ['ok' => true, 'provider_message_id' => $msgId, 'data' => $res['data']];
    }

    /** Session message (24h window only) */
    public function sendTextMessage(string $toPhone, string $text): array
    {
        $to = self::normalizePhone($toPhone);
        if ($to === '') {
            return ['ok' => false, 'error' => 'Invalid recipient phone number'];
        }
        $res = $this->graphRequest('POST', $this->phoneNumberId . '/messages', [
            'messaging_product' => 'whatsapp',
            'to' => $to,
            'type' => 'text',
            'text' => ['preview_url' => false, 'body' => $text],
        ]);
        if (!$res['ok']) {
            return $res;
        }
        return ['ok' => true, 'provider_message_id' => $res['data']['messages'][0]['id'] ?? null, 'data' => $res['data']];
    }

    /** List message templates from WABA */
    public function listMessageTemplates(int $limit = 100): array
    {
        if ($this->wabaId === '') {
            return ['ok' => false, 'error' => 'WABA ID is required to sync templates'];
        }
        $path = $this->wabaId . '/message_templates?limit=' . $limit . '&fields=name,status,language,category,components,id';
        $res = $this->graphRequest('GET', $path);
        if (!$res['ok']) {
            return $res;
        }
        return ['ok' => true, 'templates' => $res['data']['data'] ?? []];
    }

    /**
     * Submit a new template to Meta for approval.
     * @see https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
     */
    public function createMessageTemplate(string $name, string $category, string $language, string $bodyText, ?string $footer = null, string $headerType = 'none', ?string $headerText = null): array
    {
        if ($this->wabaId === '') {
            return ['ok' => false, 'error' => 'WABA ID is required to create templates'];
        }
        $name = self::sanitizeTemplateName($name);
        $cat = strtoupper($category);
        if (!in_array($cat, ['MARKETING', 'UTILITY', 'AUTHENTICATION'], true)) {
            $cat = 'MARKETING';
        }

        $components = [];
        if ($headerType === 'text' && $headerText) {
            $components[] = ['type' => 'HEADER', 'format' => 'TEXT', 'text' => $headerText];
        }
        $components[] = ['type' => 'BODY', 'text' => $bodyText];
        if ($footer) {
            $components[] = ['type' => 'FOOTER', 'text' => $footer];
        }

        $res = $this->graphRequest('POST', $this->wabaId . '/message_templates', [
            'name' => $name,
            'language' => self::metaLanguageCode($language),
            'category' => $cat,
            'components' => $components,
        ]);
        if (!$res['ok']) {
            return $res;
        }
        return [
            'ok' => true,
            'meta_template_id' => $res['data']['id'] ?? null,
            'status' => $res['data']['status'] ?? 'PENDING',
            'name' => $name,
        ];
    }

    /** Extract plain body text from Meta template components */
    public static function extractBodyFromComponents(array $components): string
    {
        foreach ($components as $c) {
            if (strtoupper((string) ($c['type'] ?? '')) === 'BODY') {
                return (string) ($c['text'] ?? '');
            }
        }
        return '';
    }

    /** Verify X-Hub-Signature-256 from Meta webhooks */
    public function verifyWebhookSignature(string $rawBody, ?string $signatureHeader): bool
    {
        if ($this->appSecret === null || $signatureHeader === null || $signatureHeader === '') {
            return $this->appSecret === null;
        }
        if (!str_starts_with($signatureHeader, 'sha256=')) {
            return false;
        }
        $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $this->appSecret);
        return hash_equals($expected, $signatureHeader);
    }
}
