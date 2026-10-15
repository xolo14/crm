/**
 * Pack dist/ → crm-vps-deploy.zip with POSIX paths (no config.php / vendor / uploads).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, "dist");
const safe = path.join(root, "dist-vps-safe");
const out = path.join(root, "crm-vps-deploy.zip");
const excludeNames = new Set(["config.php", "database.sql", "DEPLOY.md"]);
const excludeDirs = new Set(["uploads", "storage", "vendor", "private"]);

if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
  console.error("dist/ missing — run npm run build first");
  process.exit(1);
}

fs.rmSync(safe, { recursive: true, force: true });
fs.mkdirSync(safe, { recursive: true });

function copyTree(frm, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(frm)) {
    const p = path.join(frm, name);
    const st = fs.statSync(p);
    if (st.isDirectory() && excludeDirs.has(name)) continue;
    if (st.isFile() && excludeNames.has(name)) continue;
    const dest = path.join(to, name);
    if (st.isDirectory()) copyTree(p, dest);
    else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(p, dest);
    }
  }
}

copyTree(src, safe);
const cfg = path.join(safe, "api", "config.php");
if (fs.existsSync(cfg)) fs.unlinkSync(cfg);
if (fs.existsSync(out)) fs.unlinkSync(out);

const ps1 = path.join(root, "_pack_vps_zip.tmp.ps1");
const safeLit = safe.replace(/'/g, "''");
const outLit = out.replace(/'/g, "''");
fs.writeFileSync(
  ps1,
  `
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$safe = '${safeLit}'
$out = '${outLit}'
if (Test-Path $out) { Remove-Item $out -Force }
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
$n = 0
try {
  Get-ChildItem -Path $safe -Recurse -File | ForEach-Object {
    if ($_.Name -ieq 'config.php') { return }
    $rel = $_.FullName.Substring($safe.Length).TrimStart('\\','/').Replace('\\','/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal
    )
    $n++
  }
} finally { $zip.Dispose() }
$zr = [System.IO.Compression.ZipFile]::OpenRead($out)
$names = @($zr.Entries | ForEach-Object { $_.FullName })
$zr.Dispose()
Write-Output ("files $n zip_files $($names.Count) bytes $((Get-Item $out).Length)")
Write-Output ("backslash $(($names | Where-Object { $_.Contains('\\') }).Count)")
Write-Output ("config $(($names | Where-Object { $_.EndsWith('config.php') }) -join ',')")
Write-Output ("banks $(($names | Where-Object { $_.EndsWith('SyncpediaBasicsBanks.php') }).Count)")
`,
  "utf8",
);

try {
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1], { stdio: "inherit" });
} finally {
  fs.unlinkSync(ps1);
}
console.log("wrote", out);
