# WhatsApp Business API Webhook Setup

This CRM receives Meta WhatsApp Cloud API events at a single public callback URL and stores inbound messages in the database.

## Callback URL

After deploying to production (HTTPS required):

```
https://crm.syncpedia.in/api/whatsapp/webhook
```

Legacy URL `https://crm.syncpedia.in/api/whatsapp_webhook.php` still works.

## Verify token

1. Generate a random string (32+ characters recommended):

```bash
openssl rand -hex 16
```

Example output: `a3f8c2e91b4d7f6e8a0c1d2e3f4a5b6c`

2. Add it to `api/config.php` on the server:

```php
define('WHATSAPP_VERIFY_TOKEN', 'a3f8c2e91b4d7f6e8a0c1d2e3f4a5b6c');
// or
define('META_WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'a3f8c2e91b4d7f6e8a0c1d2e3f4a5b6c');
```

3. Paste the **same value** into Meta App Dashboard → WhatsApp → Configuration → Webhooks → **Verify token**.

## App secret (POST signature validation)

In `api/config.php`:

```php
define('WHATSAPP_APP_SECRET', 'your-meta-app-secret');
// or
define('META_WHATSAPP_APP_SECRET', 'your-meta-app-secret');
```

Meta signs every POST with `X-Hub-Signature-256`. Requests with an invalid signature are rejected (logged to `wa_webhook_logs`).

## Access token (outbound messages)

Per-organization tokens are stored in **Communications → WhatsApp Setup**. Platform-wide fallback:

```php
define('WHATSAPP_ACCESS_TOKEN', 'EAA...');
define('META_WHATSAPP_PHONE_NUMBER_ID', '1234567890');
define('META_WHATSAPP_WABA_ID', '987654321');
```

## Meta App Dashboard — Step by step

1. Open [Meta for Developers](https://developers.facebook.com/) → your app → **WhatsApp** → **Configuration**.
2. Under **Webhook**, click **Edit**.
3. **Callback URL:** `https://crm.syncpedia.in/api/whatsapp/webhook`
4. **Verify token:** same string as `WHATSAPP_VERIFY_TOKEN` in `config.php`.
5. Click **Verify and save**. Meta sends:

   `GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`

   The server must respond with HTTP 200 and the raw `hub.challenge` text.

6. Subscribe to webhook fields (minimum):
   - `messages` — inbound customer messages
   - `message_template_status_update` — template approval (optional)

7. While the app is **unpublished**, only test webhooks from the dashboard are delivered. Publish the app for production traffic.

## Test before going live

### A. Verification (GET)

From your machine (replace token and domain):

```bash
curl -s "https://crm.syncpedia.in/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=12345"
```

Expected: `12345` with HTTP 200. Wrong token → `403 Forbidden`.

### B. Meta dashboard test button

1. In Webhooks configuration, use **Test** on the `messages` field.
2. Check `wa_webhook_logs` in phpMyAdmin for `event_type = inbound` or `status`.
3. Check `wa_conversations` and `comm_whatsapp_messages` for new rows.

### C. Send a real message

Message your WhatsApp Business number from a personal phone. Within seconds you should see:

- A row in `wa_conversations` (thread by phone number)
- A row in `comm_whatsapp_messages` with `direction = inbound`
- A new `leads` row if the phone was unknown (`source = whatsapp_inbound`)

## Outbound replies from CRM

Authenticated API (JWT required):

```
POST /api/communications.php?action=send_whatsapp_reply
Content-Type: application/json
Authorization: Bearer <token>

{
  "org_id": "<org-uuid>",
  "recipient_phone": "+919876543210",
  "message": "Thanks for reaching out!",
  "lead_id": "<optional>"
}
```

Uses Meta Graph API `POST /v20.0/{phone_number_id}/messages` for session text (24-hour window). Template sends use `action=send_whatsapp`.

## Debugging failed deliveries

| Where | What |
|-------|------|
| `wa_webhook_logs` table | Every inbound message, status update, signature failure |
| Hostinger → Error Logs | PHP fatals, `[wa_webhook]` / `[WhatsAppInbox]` lines |
| Meta App Dashboard → Webhooks | Delivery errors, retry status |

Common issues:

- **403 on Verify and save** — verify token mismatch between Meta and `config.php`.
- **403 on POST** — wrong `WHATSAPP_APP_SECRET` or org `app_secret` in WhatsApp Setup.
- **No inbound messages** — app unpublished; `phone_number_id` not linked in org config; webhook field `messages` not subscribed.
- **HTTP not HTTPS** — Meta requires a valid SSL certificate.

## Database tables

| Table | Purpose |
|-------|---------|
| `wa_conversations` | One thread per org + phone number, linked to `leads` |
| `comm_whatsapp_messages` | All inbound/outbound messages (`direction`, `message_type`, `media_url`, status) |
| `wa_webhook_logs` | Webhook audit trail for debugging |

Run migration if tables are missing: `php-backend/migrations/wa_inbox_2026_07_02.sql` (also auto-applied on first webhook hit).
