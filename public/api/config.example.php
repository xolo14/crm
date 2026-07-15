<?php
// Copy this file to config.php on Hostinger and fill in values from hPanel → Databases.

// ── MySQL (Hostinger shared hosting) ───────────────────────────────────────
define('DB_DRIVER', 'mysql');              // mysql on Hostinger
define('DB_HOST', 'localhost');            // almost always localhost on Hostinger
define('DB_PORT', '3306');
define('DB_NAME', 'u123456789_syncpedia'); // database name from hPanel
define('DB_USER', 'u123456789_crmuser');   // database user from hPanel
define('DB_PASS', 'your_mysql_password');
define('DB_CHARSET', 'utf8mb4');

// ── Auth ────────────────────────────────────────────────────────────────────
define('JWT_SECRET', 'change-this-to-a-random-secret-key-at-least-32-chars');
define('FRONTEND_URL', 'https://your-domain.com'); // REQUIRED in production — never use * (locks CORS to this origin)
define('TOKEN_EXPIRY', 86400);
define('GOOGLE_CLIENT_ID', ''); // optional
define('APP_DEBUG', false); // true only on local dev — hides server paths in API errors
define('SIGNUP_ENABLED', false); // public self-registration (requires invite codes below)
define('MIN_PASSWORD_LENGTH', 8);
// Uncomment and set strong random values if SIGNUP_ENABLED is true:
// define('SIGNUP_INVITE_ADMIN', '');
// define('SIGNUP_INVITE_MANAGER', '');
// define('SIGNUP_INVITE_SALES', '');

// ── Email (REQUIRED for password-reset OTP + welcome emails) ────────────────
// Hostinger → Emails → Email Accounts → create/reset support@… → copy THAT password.
// Use single quotes for the password (special chars like $ break double-quoted strings).
// If webmail opens Titan (titan.email), use smtp.titan.email + port 465 + ssl instead.
define('SMTP_ENABLED', true);
define('SMTP_HOST', 'smtp.hostinger.com'); // or smtp.titan.email
define('SMTP_PORT', 587);                  // or 465 with ssl
define('SMTP_ENCRYPTION', 'tls');          // 'tls' for 587, 'ssl' for 465
define('SMTP_SUPPORT_USER', 'support@syncpedia.in');
define('SMTP_SUPPORT_PASS', ''); // e.g. define('SMTP_SUPPORT_PASS', 'your-mailbox-password');
define('SMTP_HR_USER', 'hr@syncpedia.in');
define('SMTP_HR_PASS', '');

// ── Razorpay (optional — payment links) ─────────────────────────────────────
define('RAZORPAY_KEY_ID', '');
define('RAZORPAY_KEY_SECRET', '');
define('RAZORPAY_WEBHOOK_SECRET', '');
define('CRM_PUBLIC_URL', ''); // leave empty to auto-detect from your domain

// ── Website lead ingest (no CRM form required) ───────────────────────────────
// Used by syncpedia.in / other sites: POST /api/lead-ingest.php with header X-Lead-Api-Key
define('PUBLIC_LEAD_API_KEY', ''); // e.g. openssl rand -hex 24

// ── WhatsApp (optional — per-org config in Communications → WhatsApp Setup) ─
// Meta Cloud API (direct):
define('META_WHATSAPP_APP_ID', '');        // Meta App ID (for Embedded Signup OAuth)
define('META_WHATSAPP_ACCESS_TOKEN', '');
define('META_WHATSAPP_PHONE_NUMBER_ID', '');
define('META_WHATSAPP_WABA_ID', '');
define('META_WHATSAPP_APP_SECRET', '');
define('META_WHATSAPP_WEBHOOK_VERIFY_TOKEN', '');
// Optional aliases (webhook handler reads these or META_* above):
define('WHATSAPP_VERIFY_TOKEN', '');   // e.g. openssl rand -hex 16 — paste same value in Meta App Dashboard
define('WHATSAPP_APP_SECRET', '');     // Meta App → Settings → Basic → App secret (X-Hub-Signature-256)
define('WHATSAPP_ACCESS_TOKEN', '');   // System user / permanent token for Graph API sends

// ── Optional n8n automation (server-side only — never put these in VITE_*) ───
define('N8N_WHATSAPP_WEBHOOK', '');
define('N8N_EMAIL_WEBHOOK', '');
