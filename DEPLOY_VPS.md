# VPS deploy (crm.syncpedia.in)

Server: `root@213.210.37.247` (Ubuntu 24.04). Site root: `/var/www/crm`.

## How requests reach the CRM

```
browser -> Docker nginx (dealdhamaka-nginx-1, ports 80/443, TLS)
        -> host.docker.internal:8090
        -> host nginx (systemd) server block for crm.syncpedia.in
        -> /var/www/crm  (SPA + PHP-FPM 8.3 for api/*.php)
```

| Piece | Location |
| --- | --- |
| Docker proxy route | `/opt/dealdhamaka/deploy/nginx/conf.d/crm.conf` (`upstream crm_upstream { server host.docker.internal:8090; }`) |
| Host nginx site | `/etc/nginx/sites-available/crm.syncpedia.in` (`listen 8090;`), symlinked in `sites-enabled` |
| API secrets | `/var/www/crm/api/config.php` (never in the zip or git) |

Ports on this box that belong to other apps — do not reuse:

- `80` / `443`: Docker nginx (`dealdhamaka-nginx-1`)
- `8088`: syncpedia website Node proxy (pm2 `syncpedia-origin`)
- `8089`: host nginx, okaype origin
- `3000` / `3001`: other Node apps

The host nginx must not have any site that listens on `80`, `443` or `8088`, or it fails to start
and the CRM goes down. The old `walkinready.cloud` and `syncpedia.in` host sites were disabled for
this reason (files still in `sites-available`).

## 1. Build and pack (Windows)

```powershell
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
npm run build
node _pack_vps_zip.mjs
```

Produces `crm-vps-deploy.zip` (no `api/config.php`, `vendor`, `uploads`, `storage`).
The "composer not recognized" build warning is expected; the server keeps its own `api/vendor`.

## 2. Upload

```powershell
scp "crm-vps-deploy.zip" root@213.210.37.247:/root/crm-vps-deploy.zip
```

## 3. Install on the server

```bash
rm -rf /tmp/crm-new && mkdir -p /tmp/crm-new
unzip -qo /root/crm-vps-deploy.zip -d /tmp/crm-new

# Stop if any PHP file has a syntax error
BAD=0; for f in $(find /tmp/crm-new/api -name '*.php'); do php -l "$f" >/dev/null 2>&1 || { echo "SYNTAX ERROR: $f"; BAD=1; }; done; echo "php lint bad=$BAD"
```

Only if `php lint bad=0`:

```bash
cp -a /var/www/crm/api/config.php /root/crm-config.php.vps
rsync -a --delete /tmp/crm-new/assets/ /var/www/crm/assets/
cp -a /tmp/crm-new/index.html /var/www/crm/index.html
rsync -a --exclude config.php /tmp/crm-new/api/ /var/www/crm/api/
cp -a /tmp/crm-new/.htaccess /var/www/crm/.htaccess
cp -a /root/crm-config.php.vps /var/www/crm/api/config.php
chown -R www-data:www-data /var/www/crm
```

## 4. Verify

```bash
systemctl is-active nginx
curl -s -H "Host: crm.syncpedia.in" http://127.0.0.1:8090/api/ping.php; echo
curl -s https://crm.syncpedia.in/api/ping.php; echo
```

Both pings should return `"status":"ok"`. Compare the entry script in
`/var/www/crm/index.html` (`assets/index-*.js`) with the local `dist/index.html`.

## Troubleshooting

- **Public URL shows a Next.js 404 or `{"ok":false,"error":"Not found"}`**: the request is not
  reaching the CRM. Check `systemctl status nginx` (host nginx down?) and that `crm.conf` still
  points to `host.docker.internal:8090`.
- **Host nginx won't start (`bind() ... Address already in use`)**: run
  `nginx -T 2>/dev/null | grep -nE "# configuration file|^\s*listen"` and disable whichever
  enabled site listens on a port owned by another app (see the port list above).
- **After a reboot**: confirm `systemctl is-active nginx` is `active`.
- **Reload Docker proxy after editing `crm.conf`**:
  `docker exec dealdhamaka-nginx-1 nginx -t && docker exec dealdhamaka-nginx-1 nginx -s reload`
  (the `proxy_headers_hash` warnings are harmless).
