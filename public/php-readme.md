# Syncpedia CRM - Hostinger Deployment Guide

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
│   ├── config.php           ← UPDATE with your DB credentials
│   ├── helpers.php
│   ├── index.php
│   ├── auth.php
│   ├── leads.php
│   ├── lead-assignments.php
│   ├── contacts.php
│   ├── deals.php
│   ├── tasks.php
│   ├── activities.php
│   ├── students.php
│   ├── courses.php
│   ├── batches.php
│   ├── payments.php
│   ├── reports.php
│   ├── settings.php
│   ├── profiles.php
│   ├── notifications.php
│   ├── daily-reports.php
│   ├── team.php
│   ├── organizations.php
│   ├── public-lead.php
│   ├── offer-letters.php
│   ├── holidays.php
│   └── marketing.php
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

## 📋 API Endpoints Summary

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/auth.php` | POST | Login, signup, me, switch_org |
| `/api/leads.php` | CRUD | Lead management |
| `/api/lead-assignments.php` | GET/POST/DELETE | Lead assignment & bulk assign |
| `/api/contacts.php` | CRUD | Contact management |
| `/api/deals.php` | CRUD | Deal & pipeline management |
| `/api/tasks.php` | CRUD | Task management |
| `/api/activities.php` | GET/POST | Activity tracking |
| `/api/students.php` | CRUD | Student management |
| `/api/courses.php` | CRUD | Course management |
| `/api/batches.php` | CRUD | Batch management |
| `/api/payments.php` | CRUD | Payment management |
| `/api/reports.php` | GET | Reports & analytics |
| `/api/profiles.php` | GET/PUT | User profiles & dashboard data |
| `/api/settings.php` | GET/PUT | Settings & team management |
| `/api/team.php` | CRUD | Team member management |
| `/api/notifications.php` | CRUD | Notification management |
| `/api/daily-reports.php` | GET/POST | Daily performance reports |
| `/api/organizations.php` | CRUD | Organization management (super admin) |
| `/api/offer-letters.php` | CRUD | Offer letter templates & sending |
| `/api/holidays.php` | CRUD | Holiday management |
| `/api/marketing.php` | CRUD | Marketing members, email & WhatsApp campaigns |
| `/api/public-lead.php` | POST | Public lead capture (no auth required) |

## 🔒 Security Notes
- Change `JWT_SECRET` to a random string
- Update `FRONTEND_URL` in config.php
- Use HTTPS on Hostinger (free SSL available)
