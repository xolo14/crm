# LeadOrbit CRM - Hostinger Deployment Guide

## 📁 Files to Upload

### Database
1. Log in to **Hostinger hPanel** → **Databases** → **MySQL Databases**
2. Create a new database and user
3. Open **phpMyAdmin** and import `database.sql`

### PHP API  
Upload the entire `api/` folder to your Hostinger `public_html/api/` directory:
```
public_html/
├── api/
│   ├── .htaccess
│   ├── config.php      ← UPDATE with your DB credentials
│   ├── helpers.php
│   ├── index.php
│   ├── auth.php
│   ├── leads.php
│   ├── contacts.php
│   ├── deals.php
│   ├── tasks.php
│   ├── activities.php
│   ├── reports.php
│   └── settings.php
```

### Frontend (React Build)
1. Run `npm run build` in the Lovable project
2. Upload the `dist/` contents to `public_html/`

## ⚙️ Configuration

### 1. Update `config.php`
```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'your_db_name');        // From Hostinger
define('DB_USER', 'your_db_user');        // From Hostinger  
define('DB_PASS', 'your_db_password');    // From Hostinger
define('JWT_SECRET', 'random-32-char-string');
define('FRONTEND_URL', 'https://yourdomain.com');
```

### 2. Set API URL in React
Add to your environment or update `src/lib/api.ts`:
```
VITE_API_URL=https://yourdomain.com/api
```

## 🔒 Security Notes
- Change `JWT_SECRET` to a random string
- Update `FRONTEND_URL` in config.php
- Use HTTPS on Hostinger (free SSL available)
