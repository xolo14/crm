<?php
/**
 * Interakt WhatsApp API client.
 * @see https://www.interakt.shop/resource-center/how-to-send-whatsapp-templates-using-apis-webhooks/
 */
class InteraktWhatsApp
{
    private const API_BASE = 'https://api.interakt.ai/v1/public';

    private string $apiKey;
    private ?string $webhookSecret;

    public function __construct(array $config)
    {
        $this->apiKey = trim((string) ($config['api_key'] ?? ''));
        $secret = $config['app_secret'] ?? null;
        $this->webhookSecret = is_string($secret) && $secret !== '' ? $secret : null;
    }

    public static function fromPlatformConfig(array $config): self
    {
        return new self($config);
    }

    public function isConfigured(): bool
    {
        return $this->apiKey !== '';
    }

    /** @return array{countryCode:string,phoneNumber:string} */
    public static function splitPhone(string $phone): array
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        if ($digits === '') {
            return ['countryCode' => '+91', 'phoneNumber' => ''];
        }

        if (strlen($digits) === 10 && $digits[0] >= '6' && $digits[0] <= '9') {
            return ['countryCode' => '+91', 'phoneNumber' => $digits];
        }
        if (str_starts_with($digits, '91') && strlen($digits) === 12) {
            return ['countryCode' => '+91', 'phoneNumber' => substr($digits, 2)];
        }
        if (str_starts_with($digits, '1') && strlen($digits) === 11) {
            return ['countryCode' => '+1', 'phoneNumber' => substr($digits, 1)];
        }

        if (strlen($digits) > 10) {
            $ccLen = strlen($digits) - 10;
            $cc = substr($digits, 0, $ccLen);
            $local = substr($digits, $ccLen);
            return ['countryCode' => '+' . $cc, 'phoneNumber' => $local];
        }

        return ['countryCode' => '+91', 'phoneNumber' => $digits];
    }

    public static function interaktLanguageCode(string $lang): string
    {
        $lang = strtolower(trim(str_replace('_', '-', $lang)));
        $map = [
            'en-us' => 'en',
            'en-gb' => 'en_GB',
            'en' => 'en',
            'hi' => 'hi',
            'ta' => 'ta',
            'te' => 'te',
            'mr' => 'mr',
            'gu' => 'gu',
            'kn' => 'kn',
            'ml' => 'ml',
            'bn' => 'bn',
        ];
        return $map[$lang] ?? explode('-', $lang)[0] ?: 'en';
    }

    /**
     * @return array{ok:bool,status?:int,data?:array,error?:string,raw?:string}
     */
    public function apiRequest(string $method, string $path, ?array $body = null): array
    {
        if ($this->apiKey === '') {
            return ['ok' => false, 'error' => 'Interakt API key is not configured'];
        }

        $url = self::API_BASE . '/' . ltrim($path, '/');
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 45,
            CURLOPT_HTTPHEADER => [
                'Authorization: Basic ' . $this->apiKey,
                'Content-Type: application/json',
            ],
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
            return ['ok' => false, 'error' => 'Interakt API unreachable: ' . ($curlErr ?: 'unknown'), 'status' => 0];
        }

        $data = json_decode($raw, true);
        if (!is_array($data)) {
            if ($status === 401 || $status === 403) {
                return ['ok' => false, 'error' => 'Invalid Interakt API key', 'status' => $status, 'raw' => $raw];
            }
            return ['ok' => false, 'error' => 'Invalid JSON from Interakt', 'status' => $status, 'raw' => $raw];
        }

        if ($status >= 400 || (isset($data['result']) && $data['result'] === false)) {
            $err = $data['message'] ?? $data['error'] ?? $data['detail'] ?? null;
            if (is_array($err)) {
                $err = json_encode($err);
            }
            if ($err === null || $err === '') {
                $err = json_encode($data);
            }
            return ['ok' => false, 'error' => (string) $err, 'status' => $status, 'data' => $data];
        }

        return ['ok' => true, 'status' => $status, 'data' => $data];
    }

    /** Verify API key (Interakt users API requires POST, not GET). */
    public function testConnection(): array
    {
        if (!$this->isConfigured()) {
            return ['ok' => false, 'error' => 'Interakt API key is required'];
        }
        $res = $this->apiRequest('POST', 'apis/users/?offset=0&limit=1', []);
        if (!$res['ok']) {
            return $res;
        }
        return [
            'ok' => true,
            'provider' => 'interakt',
            'message' => 'Connected to Interakt',
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
        array $headerTextParams = [],
        ?string $callbackData = null
    ): array {
        $parts = self::splitPhone($toPhone);
        if ($parts['phoneNumber'] === '') {
            return ['ok' => false, 'error' => 'Invalid recipient phone number'];
        }

        $template = [
            'name' => trim($templateName),
            'languageCode' => self::interaktLanguageCode($languageCode),
        ];
        if ($bodyParams !== []) {
            $template['bodyValues'] = array_values(array_map('strval', $bodyParams));
        }
        if ($headerTextParams !== []) {
            $template['headerValues'] = array_values(array_map('strval', $headerTextParams));
        }

        $payload = [
            'countryCode' => $parts['countryCode'],
            'phoneNumber' => $parts['phoneNumber'],
            'type' => 'Template',
            'template' => $template,
        ];
        if ($callbackData !== null && $callbackData !== '') {
            $payload['callbackData'] = substr($callbackData, 0, 512);
        }

        $res = $this->apiRequest('POST', 'message/', $payload);
        if (!$res['ok']) {
            return $res;
        }

        $msgId = $res['data']['id'] ?? ($res['data']['data']['id'] ?? null);
        return ['ok' => true, 'provider_message_id' => $msgId, 'data' => $res['data']];
    }

    public function verifyWebhookSignature(string $rawBody, ?string $signatureHeader): bool
    {
        if ($this->webhookSecret === null || $signatureHeader === null || $signatureHeader === '') {
            return $this->webhookSecret === null;
        }
        $received = $signatureHeader;
        if (str_starts_with($received, 'sha256=')) {
            $received = substr($received, 7);
        }
        $expected = hash_hmac('sha256', $rawBody, $this->webhookSecret);
        return hash_equals($expected, $received);
    }
}
