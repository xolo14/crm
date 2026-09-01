<?php
/**
 * DECOY-ONLY config — edit this file on the server (kept as config.example.php).
 * Optional: copy to config.php if you want redeploys to leave secrets untouched.
 * NEVER use production Hostinger MySQL DB_* / JWT_SECRET here.
 * NEVER upload this file into public/api/ (real CRM).
 *
 * Decoy data lives on Neon (PostgreSQL) — separate project from Syncpedia MySQL.
 */

// Preferred: full Neon connection string from Neon Console → Connection details
// Example: postgresql://user:pass@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
define('DECOY_DATABASE_URL', '');

// Or fill these instead of DECOY_DATABASE_URL (Neon host, not localhost):
define('DECOY_DB_HOST', 'ep-xxxx.ap-southeast-1.aws.neon.tech');
define('DECOY_DB_PORT', '5432');
define('DECOY_DB_NAME', 'neondb');
define('DECOY_DB_USER', 'neondb_owner');
define('DECOY_DB_PASS', 'change-me-neon-password');
define('DECOY_DB_SSLMODE', 'require'); // Neon requires SSL

// Must be different from real JWT_SECRET — generate: openssl rand -hex 32
define('DECOY_JWT_SECRET', 'replace-with-random-64-hex-chars-decoy-only-not-prod');
define('DECOY_TOKEN_EXPIRY', 3600); // 1 hour

// Same-domain path for the decoy SPA
define('DECOY_FRONTEND_PATH', '/legacy');
define('DECOY_COOKIE_NAME', 'syncpedia_decoy_session');

// Slack / Discord / generic webhook (optional)
define('DECOY_ALERT_WEBHOOK_URL', '');

define('DECOY_APP_DEBUG', false);
