<?php
// Copy this file to config.php on Hostinger and fill in values from hPanel → Databases.

// ── MySQL (Hostinger shared hosting) ───────────────────────────────────────
define('DB_DRIVER', 'mysql');              // mysql on Hostinger; use pgsql only for Neon
define('DB_HOST', 'localhost');            // almost always localhost on Hostinger
define('DB_PORT', '3306');
define('DB_NAME', 'u123456789_syncpedia'); // database name from hPanel
define('DB_USER', 'u123456789_crmuser');   // database user from hPanel
define('DB_PASS', 'your_mysql_password');
define('DB_CHARSET', 'utf8mb4');

// ── Auth ────────────────────────────────────────────────────────────────────
define('JWT_SECRET', 'change-this-to-a-random-secret-key-at-least-32-chars');
define('FRONTEND_URL', 'https://your-domain.com'); // set your real domain (not * in production)
define('TOKEN_EXPIRY', 86400);
define('GOOGLE_CLIENT_ID', ''); // optional
define('APP_DEBUG', false); // true only on local dev — hides server paths in API errors
define('SIGNUP_ENABLED', false); // public self-registration (requires invite codes below)
define('MIN_PASSWORD_LENGTH', 8);
// Uncomment and set strong random values if SIGNUP_ENABLED is true:
// define('SIGNUP_INVITE_ADMIN', '');
// define('SIGNUP_INVITE_MANAGER', '');
// define('SIGNUP_INVITE_SALES', '');

// ── Email (optional) ────────────────────────────────────────────────────────
define('SMTP_ENABLED', true);
define('SMTP_HOST', 'smtp.hostinger.com');
define('SMTP_PORT', 587);
define('SMTP_ENCRYPTION', 'tls');
define('SMTP_SUPPORT_USER', 'support@syncpedia.in');
define('SMTP_SUPPORT_PASS', '');
define('SMTP_HR_USER', 'hr@syncpedia.in');
define('SMTP_HR_PASS', '');

// ── Razorpay (optional — payment links) ─────────────────────────────────────
define('RAZORPAY_KEY_ID', '');
define('RAZORPAY_KEY_SECRET', '');
define('RAZORPAY_WEBHOOK_SECRET', '');
define('CRM_PUBLIC_URL', ''); // leave empty to auto-detect from your domain

// ── WhatsApp (optional — per-org config in Communications → WhatsApp Setup) ─
// Meta Cloud API (direct):
define('META_WHATSAPP_ACCESS_TOKEN', '');
define('META_WHATSAPP_PHONE_NUMBER_ID', '');
define('META_WHATSAPP_WABA_ID', '');
define('META_WHATSAPP_APP_SECRET', '');
define('META_WHATSAPP_WEBHOOK_VERIFY_TOKEN', '');
// Interakt: configure per organization in CRM (api_key + webhook secret in org_whatsapp_config).
