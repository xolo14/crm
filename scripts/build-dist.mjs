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
run("npm run build:vite");

// ── 2. PHP API (source of truth: php-backend/) ─────────────
log("Syncing PHP api → dist/api + public/api");
copyDir(path.join(root, "php-backend", "api"), path.join(dist, "api"));
copyDir(path.join(root, "php-backend", "api"), path.join(root, "public", "api"));

// ── 3. PHP vendor + database ─────────────────────────────────
copyDir(path.join(root, "php-backend", "vendor"), path.join(dist, "vendor"));
copyDir(path.join(root, "php-backend", "vendor"), path.join(root, "public", "vendor"));
copyFile(
  path.join(root, "php-backend", "database.sql"),
  path.join(dist, "database.sql"),
);

// ── 4. Upload directories (must exist & be writable on server) ─
for (const sub of [
  "uploads/resumes",
  "uploads/call_recordings",
  "uploads/certificates",
  "uploads/payslips",
  "storage/payment_invoices",
]) {
  ensureDir(path.join(dist, sub));
  ensureDir(path.join(root, "public", sub));
}
ensureDir(path.join(root, "php-backend", "storage", "payment_invoices"));

// ── 5. Deploy instructions inside dist ─────────────────────
const deployMd = `# SYNCPedia CRM — deploy from this folder

Upload **everything inside this \`dist/\` folder** to Hostinger \`public_html\`
(or your site root). Stack: **React (Vite) + PHP API + MySQL** — no Node.js required.

## Folder layout

| Path | Purpose |
|------|---------|
| \`index.html\`, \`assets/\` | React CRM frontend |
| \`api/\` | PHP backend (login, leads, payment links, email, etc.) |
| \`vendor/\` | PHP Composer libraries |
| \`uploads/\` | User uploads (must be writable, chmod 755) |
| \`database.sql\` | MySQL schema reference |

## Step 1 — Upload & configure

1. Upload all files from \`dist/\` to \`public_html\`.
2. Edit \`api/config.php\`:
   - MySQL: \`DB_HOST\`, \`DB_NAME\`, \`DB_USER\`, \`DB_PASS\`
   - Razorpay: \`RAZORPAY_KEY_ID\`, \`RAZORPAY_KEY_SECRET\`, \`RAZORPAY_WEBHOOK_SECRET\`
   - Optional: \`CRM_PUBLIC_URL=https://your-crm-domain.com\`
   - SMTP (fresher emails): \`SMTP_HR_USER\`, \`SMTP_HR_PASS\`, etc.
3. Ensure \`uploads/\` subfolders are writable.
4. Upload root \`.htaccess\` (keeps \`/api/*.php\` on PHP, not React).

## Step 2 — Razorpay webhook

\`https://your-crm-domain.com/api/payment-links.php?action=webhook\`

## Verify

- CRM: \`https://yourdomain.com\`
- Payment links (logged in): \`https://yourdomain.com/api/payment-links.php?count=5\`
- Should return JSON \`{"success":true,"data":{...}}\` — not HTML.

## After deploy

Hard-refresh the browser (Ctrl+F5) so cached HTML responses are cleared.
`;

fs.writeFileSync(path.join(dist, "DEPLOY.md"), deployMd, "utf8");

const staleNodeApi = path.join(dist, "node-api");
if (fs.existsSync(staleNodeApi)) {
  fs.rmSync(staleNodeApi, { recursive: true, force: true });
  log("Removed stale dist/node-api/ (PHP-only deploy)");
}

log("Done. Upload the contents of /dist to Hostinger public_html.");
log(`  Frontend + PHP: ${dist}`);
