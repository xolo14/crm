<?php

spl_autoload_register(static function (string $class): void {
    $prefix = 'PHPMailer\\PHPMailer\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $file = __DIR__ . '/phpmailer/phpmailer/src/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

// Dompdf / full Composer autoload when present (after `composer install` in php-backend
// or when vendor/ is uploaded next to this stub).
$composerCandidates = [
    __DIR__ . '/composer/autoload_real.php',
    __DIR__ . '/../composer/autoload_real.php',
    __DIR__ . '/../../php-backend/vendor/autoload.php',
    dirname(__DIR__, 2) . '/php-backend/vendor/autoload.php',
];
foreach ($composerCandidates as $composerAutoload) {
    if (is_file($composerAutoload)) {
        require_once $composerAutoload;
        break;
    }
}
