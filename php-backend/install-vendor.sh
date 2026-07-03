#!/bin/sh
# Run on Hostinger SSH from public_html:
#   sh install-vendor.sh
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
if ! command -v php >/dev/null 2>&1; then
  echo "PHP CLI not found. Enable SSH in Hostinger hPanel."
  exit 1
fi
if [ ! -f composer.json ]; then
  echo "composer.json missing in $ROOT"
  exit 1
fi
if [ ! -f composer.phar ]; then
  php -r "copy('https://getcomposer.org/installer', 'composer-setup.php');"
  php composer-setup.php
  rm -f composer-setup.php
fi
php composer.phar install --no-dev --optimize-autoloader
mkdir -p storage/payment_invoices storage/tmp
chmod -R 775 storage 2>/dev/null || true
php -r "require 'vendor/autoload.php'; echo class_exists('Dompdf\\\\Dompdf') ? 'dompdf ok\n' : 'dompdf missing — check composer install\n';"
