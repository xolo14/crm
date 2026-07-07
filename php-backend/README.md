# LeadOrbit / SYNCPedia CRM — PHP backend

**Source of truth for the API:** `php-backend/api/`  
On build or `npm run dev`, files sync to `public/api/` and `dist/api/`.

## Deploy

Run `npm run build` and upload everything inside `dist/` to Hostinger `public_html`.  
See `dist/DEPLOY.md` after build for full steps.

## Local development

```bash
npm run dev          # syncs API, then starts Vite
npm run sync:api     # sync php-backend/api → public/api only
npm run build        # production bundle + deploy zip
```

## Database

Import `php-backend/database.mysql.sql` in phpMyAdmin (shipped as `database.sql` in dist).

## Configuration

Copy `api/config.example.php` → `api/config.php` and set MySQL + `JWT_SECRET`.
