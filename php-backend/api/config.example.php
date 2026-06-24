<?php
// Copy to config.php and fill in your credentials (config.php is gitignored).

define('DB_HOST', 'localhost');
define('DB_NAME', 'your_database_name');
define('DB_USER', 'your_database_user');
define('DB_PASS', 'your_database_password');

define('JWT_SECRET', 'change-this-to-a-random-secret-key-at-least-32-chars');
define('FRONTEND_URL', '*');
define('TOKEN_EXPIRY', 86400);
define('GOOGLE_CLIENT_ID', '');

define('SMTP_ENABLED', true);
define('SMTP_HOST', 'smtp.gmail.com');
define('SMTP_PORT', 587);
define('SMTP_ENCRYPTION', 'tls');
define('SMTP_SUPPORT_USER', 'support@example.com');
define('SMTP_SUPPORT_PASS', '');
define('SMTP_HR_USER', 'hr@example.com');
define('SMTP_HR_PASS', '');

define('RAZORPAY_KEY_ID', '');
define('RAZORPAY_KEY_SECRET', '');
define('RAZORPAY_WEBHOOK_SECRET', '');
define('CRM_PUBLIC_URL', '');

define('META_WHATSAPP_ACCESS_TOKEN', '');
define('META_WHATSAPP_PHONE_NUMBER_ID', '');
define('META_WHATSAPP_WABA_ID', '');
define('META_WHATSAPP_APP_SECRET', '');
define('META_WHATSAPP_WEBHOOK_VERIFY_TOKEN', '');
