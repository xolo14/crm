/**
 * Unified production build → everything lands in /dist for Hostinger upload.
 *
 * dist/
 *   index.html, assets/     ← Vite React app (from public/)
 *   api/                    ← PHP CRM backend
 *   vendor/                 ← PHP Composer deps
 *   uploads/                ← writable upload dirs
 *   .htaccess, database.sql, DEPLOY.md
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

function log(msg) {
  console.log(`[build] ${msg}`);
}

function run(cmd, cwd = root) {
  log(`${cmd}  (in ${path.relative(root, cwd) || "."})`);
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── 1. React frontend (also copies public/ → dist/) ──────────
// .env.production sets VITE_API_URL= so the built app uses same-origin /api (no Hostinger env vars).
run("npm run build:vite");

// ── 2. PHP API (source of truth: php-backend/) ─────────────
log("Syncing PHP api → dist/api + public/api");
run("node scripts/sync-api.mjs");
copyDir(path.join(root, "php-backend", "api"), path.join(dist, "api"));
copyFile(
  path.join(root, "php-backend", "composer.json"),
  path.join(dist, "composer.json"),
);
copyFile(
  path.join(root, "php-backend", "install-vendor.sh"),
  path.join(dist, "install-vendor.sh"),
);

// ── 2b. api/config.php — ship template for first Hostinger deploy ─────────────
const localConfig = path.join(root, "php-backend", "api", "config.php");
const exampleConfig = path.join(root, "php-backend", "api", "config.example.php");
const distConfig = path.join(dist, "api", "config.php");
if (fs.existsSync(localConfig)) {
  copyFile(localConfig, distConfig);
  log("Copied php-backend/api/config.php → dist/api/config.php");
} else if (fs.existsSync(exampleConfig)) {
  copyFile(exampleConfig, distConfig);
  log("Shipped dist/api/config.php from config.example.php — edit MySQL credentials on Hostinger before use");
}

// ── 3. PHP vendor + database ─────────────────────────────────
const vendorDir = path.join(root, "php-backend", "vendor");
const composerJson = path.join(root, "php-backend", "composer.json");
if (fs.existsSync(composerJson) && !fs.existsSync(path.join(vendorDir, "autoload.php"))) {
  log("Running composer install in php-backend/ (dompdf + PHPMailer for invoices)");
  try {
    run("composer install --no-dev --optimize-autoloader", path.join(root, "php-backend"));
  } catch (e) {
    log("WARN: composer install failed — upload php-backend/vendor manually or run composer on server");
  }
}
copyDir(path.join(root, "php-backend", "vendor"), path.join(dist, "vendor"));
copyDir(path.join(root, "php-backend", "vendor"), path.join(root, "public", "vendor"));
copyFile(
  path.join(root, "php-backend", "database.mysql.sql"),
  path.join(dist, "database.sql"),
);

// ── 4. Upload + invoice storage (must exist & be writable on server) ─
for (const sub of [
  "uploads/resumes",
  "uploads/call_recordings",
  "uploads/certificates",
  "uploads/certificate_assets",
  "uploads/payslips",
  "storage/payment_invoices",
  "storage/tmp",
  "storage/payslips",
  "storage/offer_letters",
]) {
  ensureDir(path.join(dist, sub));
  ensureDir(path.join(root, "public", sub));
}
copyDir(path.join(root, "php-backend", "storage"), path.join(dist, "storage"));
copyDir(path.join(root, "php-backend", "storage"), path.join(root, "public", "storage"));
ensureDir(path.join(root, "php-backend", "storage", "payment_invoices"));
ensureDir(path.join(root, "php-backend", "storage", "tmp"));

// ── 5. Ensure root .htaccess is in dist (Vite copies public/, but verify) ─
const htaccess = path.join(root, "public", ".htaccess");
if (fs.existsSync(htaccess)) {
  copyFile(htaccess, path.join(dist, ".htaccess"));
}

// ── 6. Deploy instructions inside dist ─────────────────────
const deployMd = `# SYNCPedia CRM — Hostinger shared hosting

Upload **everything inside this \`dist/\` folder** to \`public_html\`.
No Node.js or server environment variables are required on Hostinger.

## Stack

| Path | Purpose |
|------|---------|
| \`index.html\`, \`assets/\` | React CRM frontend |
| \`api/\` | PHP backend (login, leads, forms, payments, etc.) |
| \`api/config.php\` | **MySQL + secrets** (edit on server) |
| \`vendor/\` | PHP libraries (PHPMailer, etc.) |
| \`uploads/\` | User uploads (chmod 755, writable) |
| \`storage/payment_invoices/\` | **Payment invoice PDFs** (chmod 775, writable — do not delete on re-deploy) |
| \`vendor/\` | PHP libraries (**dompdf** for invoices, PHPMailer) |
| \`database.sql\` | Import once in phpMyAdmin |
| \`.htaccess\` | Routes \`/api/*.php\` to PHP (not React) |

## Step 1 — Upload files

1. **Recommended:** upload \`syncpedia-crm-deploy.zip\` (created next to \`dist/\` when you run \`npm run build\`), extract into \`public_html\`.
2. Or upload **all contents** of \`dist/\` to Hostinger \`public_html\` (not the \`dist\` folder itself).
3. **Critical:** upload the entire \`assets/\` folder together with \`index.html\` — partial uploads cause "MIME type text/html" JS errors.
4. Confirm \`.htaccess\` uploaded (show hidden files in File Manager).

## Step 2 — MySQL (phpMyAdmin)

1. hPanel → **Databases** → create MySQL database + user (note all four values).
2. phpMyAdmin → **Import** → select \`database.sql\`.
3. Edit \`api/config.php\` on the server (included in dist as a template — replace placeholder DB values):

\`\`\`php
define('DB_HOST', 'localhost');           // almost always localhost on Hostinger
define('DB_NAME', 'u123456789_syncpedia'); // from Databases panel
define('DB_USER', 'u123456789_crmuser');
define('DB_PASS', 'your_password');
define('JWT_SECRET', 'random-32-char-string'); // change this!
\`\`\`

4. Optional: Razorpay keys, SMTP, \`GOOGLE_CLIENT_ID\` in the same file.

## Step 3 — Verify (must return JSON, not HTML)

Open in browser:

\`https://your-domain.com/api/ping.php\`

Expected: \`{"status":"ok","database":"connected",...}\`

If you see HTML or a blank page, PHP is not running or \`.htaccess\` is missing.

## Step 4 — PHP version

hPanel → **Advanced** → **PHP Configuration** → use **PHP 8.1+** and enable \`pdo_mysql\`.

## Step 5 — Invoice PDF storage

Payment invoices are saved to \`storage/payment_invoices/\` on the server (not in MySQL).

1. After upload, set folder permissions: **storage/** and **storage/payment_invoices/** → **775** (writable).
2. Open \`/api/ping.php\` — you should see \`"storage": { "payment_invoices": "writable" }\`.
3. \`vendor/\` must include **dompdf** (run \`sh install-vendor.sh\` via Hostinger SSH if PDFs fail).
4. On re-deploy, **do not delete** \`storage/payment_invoices/\` — it holds saved invoices.

Download invoice in CRM: Payment Links → view link → **Download Invoice**.

## Forgot password / login errors

If the app says "Server returned HTML" or "Database not configured":
- \`api/config.php\` still has placeholder DB values, or
- \`database.sql\` was not imported, or
- \`api/\` folder was not uploaded.

## Razorpay webhook (optional)

\`https://your-domain.com/api/payment-links.php?action=webhook\`

## Rebuild locally

\`npm run build\` → re-upload \`dist/\` **except** do not overwrite your live \`api/config.php\` if it is already configured.
`;

fs.writeFileSync(path.join(dist, "DEPLOY.md"), deployMd, "utf8");

const staleNodeApi = path.join(dist, "node-api");
if (fs.existsSync(staleNodeApi)) {
  fs.rmSync(staleNodeApi, { recursive: true, force: true });
  log("Removed stale dist/node-api/ (PHP-only deploy)");
}

log("Done. Upload the contents of /dist to Hostinger public_html.");
log("  Then edit api/config.php on Hostinger and open /api/ping.php to verify.");
log(`  Frontend + PHP: ${dist}`);

// ── 7. Zip for one-shot Hostinger upload (avoids partial deploy / MIME errors) ─
try {
  const zipPath = path.join(root, "syncpedia-crm-deploy.zip");
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const isWin = process.platform === "win32";
  if (isWin) {
    run(
      `powershell -NoProfile -Command "Compress-Archive -Path '${dist.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
    );
  } else {
    run(`cd "${dist}" && zip -r "${zipPath}" .`);
  }
  log(`Created ${zipPath} — upload & extract in public_html (overwrite files, keep api/config.php)`);
} catch (e) {
  log("WARN: could not create deploy zip — upload dist/ folder manually");
}
