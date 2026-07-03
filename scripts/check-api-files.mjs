/**
 * Verify frontend API routes map to PHP files in php-backend/api and public/api.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const apiTs = fs.readFileSync(path.join(root, "src", "lib", "api.ts"), "utf8");
const commTs = fs.readFileSync(path.join(root, "src", "services", "communications.ts"), "utf8");
const hrLeadsTs = fs.readFileSync(path.join(root, "src", "services", "hrLeads.ts"), "utf8");
const callLogsTs = fs.readFileSync(path.join(root, "src", "services", "callLogs.ts"), "utf8");

const sources = [apiTs, commTs, hrLeadsTs, callLogsTs].join("\n");
const matches = [...sources.matchAll(/['"`](\/[a-z0-9_./?=&%-]+)['"`]/gi)];
const endpoints = new Set();

for (const m of matches) {
  const raw = m[1];
  if (!raw.endsWith(".php") && !raw.includes(".php?")) continue;
  const file = raw.split("?")[0].replace(/^\//, "");
  if (file.endsWith(".php")) endpoints.add(file);
}

const phpBackendDir = path.join(root, "php-backend", "api");
const publicApiDir = path.join(root, "public", "api");

const missingBackend = [];
const missingPublic = [];

for (const file of [...endpoints].sort()) {
  if (!fs.existsSync(path.join(phpBackendDir, file))) missingBackend.push(file);
  if (!fs.existsSync(path.join(publicApiDir, file))) missingPublic.push(file);
}

const requiredBootstrap = ["bootstrap.php", "db.php", "helpers.php", "ping.php"];
const missingCore = requiredBootstrap.filter(
  (f) => !fs.existsSync(path.join(phpBackendDir, f)) || !fs.existsSync(path.join(publicApiDir, f)),
);

console.log(`Checked ${endpoints.size} API endpoint file(s).`);
if (missingCore.length) {
  console.error("Missing core API files:", missingCore.join(", "));
  process.exitCode = 1;
}
if (missingBackend.length) {
  console.error("Missing in php-backend/api:", missingBackend.join(", "));
  process.exitCode = 1;
}
if (missingPublic.length) {
  console.error("Missing in public/api:", missingPublic.join(", "));
  process.exitCode = 1;
}
if (!process.exitCode) {
  console.log("All API route files exist in php-backend/api and public/api.");
}
