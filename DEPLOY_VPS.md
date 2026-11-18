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

## 5. Required nginx hardening (uploads + security headers)

> **Use `deploy/nginx-crm-security.conf`** (shipped in the deploy zip as
> `nginx-crm-security.conf`). It supersedes the block below: its CSP allows Razorpay
> checkout, Google sign-in, the Facebook SDK and YouTube/Vimeo/Drive embeds, keeps
> camera/microphone for video intros, and ships the full CSP as Report-Only first.
> Copy it to `/etc/nginx/snippets/crm-security.conf`, add
> `include /etc/nginx/snippets/crm-security.conf;` inside the `crm.syncpedia.in`
> server block, set `server_tokens off;` in the `http { }` block of
> `/etc/nginx/nginx.conf`, then `nginx -t && systemctl reload nginx`.

**This step is mandatory, not optional.** Every `.htaccess` file shipped in this repo
(`public/.htaccess`, `public/uploads/*/.htaccess`, `public/storage/*/.htaccess`) is
Apache-only syntax — **nginx ignores `.htaccess` entirely.** On this VPS, the host
nginx site is the only thing actually serving requests, so without the block below:
- The security headers (CSP, X-Frame-Options, HSTS, etc.) are never sent.
- `/uploads/payment_proofs/...`, `/uploads/resumes/...`, `/uploads/call_recordings/...`,
  `/uploads/form_attachments/...`, `/uploads/hr_resumes/...`, `/uploads/assessment_answers/...`,
  `/uploads/video_intros/...`, `/storage/...` are all directly downloadable by anyone who has
  (or guesses/leaks) the URL — no login required — even though `api/files.php` enforces
  per-request ownership checks for the *intended* path through the app.

Add this to the host nginx server block for `crm.syncpedia.in`
(`/etc/nginx/sites-available/crm.syncpedia.in`, inside the existing `server { ... }`):

```nginx
# Security headers — mirrors public/.htaccess, which nginx does not read.
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://connect.facebook.net https://accounts.google.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https: blob:; connect-src 'self' https: wss:; frame-src https://www.facebook.com https://web.facebook.com https://accounts.google.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests" always;

# Private uploads — deny direct access; everything here must go through
# api/files.php (resumes, call recordings, payment proofs, form attachments, …),
# which checks the caller's auth and ownership before streaming the file.
location ~ ^/uploads/(resumes|call_recordings|recordings|form_attachments|form_leads|hr_resumes|assessment_answers|video_intros|payment_proofs)/ {
    deny all;
}

# Private app storage — served only through authenticated endpoints
# (payment-links.php?action=invoice, video-intros.php?action=media).
location ^~ /storage/ {
    deny all;
}
location ^~ /private/ {
    deny all;
}

# Explicitly public upload folders (branding/logos/avatars/certificate backgrounds
# shown as <img> on the public site) — never execute PHP from inside /uploads.
location ~ ^/uploads/.*\.(php|phtml|phar|cgi|pl|py|sh)$ {
    deny all;
}
```

Reload after editing: `nginx -t && systemctl reload nginx`, then confirm a direct hit on
a known private file 404s/403s (not 200) — e.g.
`curl -i https://crm.syncpedia.in/uploads/payment_proofs/<any-filename>` should **not** return the file.

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
