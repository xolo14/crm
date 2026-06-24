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

// Dompdf (optional) — load full Composer autoload if present alongside this file
$composerAutoload = __DIR__ . '/../composer/autoload_real.php';
if (is_file($composerAutoload)) {
    require $composerAutoload;
}
