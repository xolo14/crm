/**
 * Sync php-backend/api → public/api (and database schema).
 * Source of truth: php-backend/. Run automatically before dev and full build.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`[sync-api] missing: ${src}`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

copyDir(path.join(root, "php-backend", "api"), path.join(root, "public", "api"));
copyFile(
  path.join(root, "php-backend", "database.mysql.sql"),
  path.join(root, "public", "database.sql"),
);

const vendorSrc = path.join(root, "php-backend", "vendor");
if (fs.existsSync(path.join(vendorSrc, "autoload.php"))) {
  copyDir(vendorSrc, path.join(root, "public", "vendor"));
}

console.log("[sync-api] php-backend/api → public/api");
