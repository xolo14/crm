from pathlib import Path
import shutil
import time
import zipfile

root = Path(r"C:\Users\nages\Downloads\crm-main\crm-main")
src = root / "dist"
safe = root / "dist-vps-safe"
out = root / "crm-vps-deploy.zip"
exclude_names = {"config.php", "database.sql", "DEPLOY.md"}
exclude_dirs = {"uploads", "storage", "vendor", "private"}

if not src.is_dir():
    raise SystemExit("dist/ missing — run npm run build first")

if safe.exists():
    shutil.rmtree(safe, ignore_errors=True)
    time.sleep(0.4)
safe.mkdir(parents=True, exist_ok=True)


def copy_tree(frm: Path, to: Path) -> None:
    to.mkdir(parents=True, exist_ok=True)
    for p in frm.iterdir():
        if p.is_dir() and p.name in exclude_dirs:
            continue
        if p.is_file() and p.name in exclude_names:
            continue
        dest = to / p.name
        if p.is_dir():
            copy_tree(p, dest)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, dest)


copy_tree(src, safe)
cfg = safe / "api" / "config.php"
if cfg.exists():
    cfg.unlink()

if out.exists():
    out.unlink()

n = 0
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for p in safe.rglob("*"):
        if not p.is_file():
            continue
        if p.name.lower() == "config.php":
            continue
        z.write(p, p.relative_to(safe).as_posix())
        n += 1

names = zipfile.ZipFile(out).namelist()
print("files", n, "zip_files", len(names), "bytes", out.stat().st_size)
print("backslash", any("\\" in x for x in names))
print("config", [x for x in names if x.endswith("config.php")])
print("banks", any(x.endswith("SyncpediaBasicsBanks.php") for x in names))
print("basics", any(x.endswith("SyncpediaFresherBasics.php") for x in names))
print("qnav", any("SyncpediaFresherAssessment" in x or "sf-qnav" in x for x in names))
