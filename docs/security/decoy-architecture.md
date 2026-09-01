# Decoy Layer 1 architecture (Syncpedia CRM)

**DECOY-ONLY** infrastructure. The real CRM lives at `/` + `/api/`.  
The decoy lives at `/legacy` + `/api-decoy/` on the **same domain**, with **zero shared DB / JWT / auth**.

## Isolation boundary

| Concern | Real (Layer 2) | Decoy (Layer 1) |
|---------|----------------|-----------------|
| URL | `https://crm.example.com/` | `https://crm.example.com/legacy` |
| API | `/api/*.php` | `/api-decoy/*.php` |
| Config | `public/api/config.php` | `public/api-decoy/config.example.php` |
| DB | Hostinger **MySQL** (`DB_*`) | **Neon PostgreSQL** (`DECOY_DATABASE_URL` / `DECOY_DB_*`) |
| JWT | `JWT_SECRET` | `DECOY_JWT_SECRET` |
| Cookie | `syncpedia_session` | `syncpedia_decoy_session` |
| Frontend | `src/` → `/` | `decoy/` → `/legacy/` |

**Never:**
- Point decoy config at the Syncpedia Hostinger MySQL database
- Reuse `JWT_SECRET` as `DECOY_JWT_SECRET`
- Import `src/lib/api.ts` into the decoy app
- Put decoy routes inside `src/App.tsx`

## Neon setup

1. Create a project at [Neon](https://neon.tech) (free tier is fine).
2. Copy the connection URI (`sslmode=require`).
3. On the server, edit `api-decoy/config.example.php` (kept as the example file — no rename required):
   ```php
   define('DECOY_DATABASE_URL', 'postgresql://…@ep-….neon.tech/neondb?sslmode=require');
   define('DECOY_JWT_SECRET', '…'); // openssl rand -hex 32
   ```
   On redeploy, do not overwrite that filled-in file (or optionally copy it to `config.php`, which is also loaded if present).
4. Hostinger PHP must have the **pgsql** PDO driver enabled (hPanel → PHP Configuration).
5. Seed from a machine that can reach Neon:
   ```bash
   php scripts/seed-decoy.php
   ```
6. Check: `/api-decoy/ping.php` → `"provider":"neon","database":"connected"`.

Assume Layer 1 will be compromised. Design so that outcome only exposes fake admins + synthetic leads on Neon — never Syncpedia MySQL.

## Alerts

`public/api-decoy/lib/decoyAlert.php` fires on:
- login page load (`beacon`)
- login attempt / success / fail
- dashboard view
- CSV export

Fire-and-forget; failures never change the HTTP response to the visitor.

## Theme

`decoy/theme.ts` — teal/slate “Syncpedia Legacy” skin so screenshots are visually distinct from the real green CRM.

## PII masking

Stored unmasked in the decoy DB; masked in API JSON and CSV via `decoyMaskPhone` / `decoyMaskEmail`.
