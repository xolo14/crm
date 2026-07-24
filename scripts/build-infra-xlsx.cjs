const fs = require("fs");
const path = require("path");

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sheet(name, rows) {
  const tableRows = rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const s = cell === null || cell === undefined ? "" : String(cell);
          const isNum = s !== "" && /^-?\d+(\.\d+)?$/.test(s);
          if (isNum) {
            return `<Cell><Data ss:Type="Number">${esc(s)}</Data></Cell>`;
          }
          return `<Cell><Data ss:Type="String">${esc(s)}</Data></Cell>`;
        })
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("\n");
  return `
<Worksheet ss:Name="${esc(name)}">
  <Table>${tableRows}</Table>
</Worksheet>`;
}

const overview = [
  ["APPLICATION NAME", "Syncpedia CRM"],
  [
    "TYPE",
    "Multi-tenant SaaS CRM (leads, forms, team, marketing, WhatsApp, payments, certificates, offer letters, payslip, reports)",
  ],
  ["DOMAIN", "https://crm.syncpedia.in"],
  ["API", "https://crm.syncpedia.in/api/"],
  ["HEALTH CHECK", "https://crm.syncpedia.in/api/ping.php"],
  [
    "ARCHITECTURE",
    "1 frontend + 1 PHP API + 1 MySQL database (same domain, same-origin /api)",
  ],
  ["AUTH", "JWT"],
  ["TIMEZONE", "Asia/Kolkata (IST)"],
  ["HOSTING", "Hostinger shared hosting (public_html)"],
  ["FRONTEND RUNTIME", "React / Vite static (Node.js 18+ build only)"],
  ["BACKEND RUNTIME", "PHP 8.1+"],
  ["DATABASE", "MySQL utf8mb4"],
  ["DATA SOURCE", "Hostinger Analytics + Resource Usage screenshots (Jul 15–22, 2026)"],
  ["CAPACITY VERDICT", "Current Hostinger plan is enough for present and expected typical load"],
];

const services = [
  ["#", "Service", "Details", "Notes"],
  [
    "1",
    "Web Frontend Hosting",
    "React / Vite static website",
    "Domain crm.syncpedia.in, HTTPS/SSL, SPA routing via Apache .htaccess",
  ],
  [
    "2",
    "PHP API Backend Hosting",
    "Custom PHP 8 REST API at /api/",
    "HTTPS/SSL, Apache rewrite, writable uploads/ and storage/",
  ],
  [
    "3",
    "MySQL Database",
    "One database for whole application",
    "users, orgs, leads, forms, students, courses, batches, tasks, communications, marketing, payments, certificates, offer letters, payslips, daily reports, settings",
  ],
  [
    "4",
    "Email Service",
    "SMTP (Hostinger / Titan)",
    "Password-reset OTP, welcome emails, notifications",
  ],
  ["5", "Payments", "Razorpay", "Payment links + webhook"],
  ["6", "WhatsApp", "Meta WhatsApp Cloud API", "Messaging + webhook"],
  [
    "7",
    "DNS + SSL",
    "crm.syncpedia.in → frontend + API",
    "SSL on the domain",
  ],
];

const config = [
  ["Category", "Config / Variable", "Purpose", "Secret?"],
  ["Frontend", "VITE_API_URL", "API base URL", "No"],
  ["Frontend", "VITE_RAZORPAY_KEY_ID", "Razorpay public key", "No (public)"],
  ["Frontend", "VITE_GOOGLE_CLIENT_ID", "Google OAuth client", "No (public)"],
  ["Database", "DB_HOST", "MySQL host", "Yes"],
  ["Database", "DB_NAME", "MySQL database name", "Yes"],
  ["Database", "DB_USER", "MySQL user", "Yes"],
  ["Database", "DB_PASS", "MySQL password", "Yes"],
  ["Database", "DB_CHARSET", "Usually utf8mb4", "No"],
  ["Auth", "JWT_SECRET", "JWT signing secret", "Yes"],
  ["Auth", "TOKEN_EXPIRY", "Token lifetime", "No"],
  ["Auth", "FRONTEND_URL", "App public URL", "No"],
  ["Email", "SMTP_HOST", "SMTP host", "No"],
  ["Email", "SMTP_PORT", "SMTP port", "No"],
  ["Email", "SMTP_ENCRYPTION", "tls/ssl", "No"],
  ["Email", "SMTP_SUPPORT_USER", "Support mailbox user", "Yes"],
  ["Email", "SMTP_SUPPORT_PASS", "Support mailbox password", "Yes"],
  ["Email", "SMTP_HR_USER", "HR mailbox user", "Yes"],
  ["Email", "SMTP_HR_PASS", "HR mailbox password", "Yes"],
  ["Payments", "RAZORPAY_KEY_ID", "Razorpay key id", "Yes"],
  ["Payments", "RAZORPAY_KEY_SECRET", "Razorpay secret", "Yes"],
  ["Payments", "RAZORPAY_WEBHOOK_SECRET", "Webhook verification", "Yes"],
  ["App", "CRM_PUBLIC_URL", "Public CRM URL", "No"],
  ["App", "PUBLIC_LEAD_API_KEY", "Public form ingest key", "Yes"],
  ["WhatsApp", "META_WHATSAPP_* / WHATSAPP_*", "Meta Cloud API credentials", "Yes"],
  ["Auth", "GOOGLE_CLIENT_ID", "Google client (server)", "No (public)"],
];

const planLimits = [
  ["Resource", "Plan limit", "Observed usage", "% used / note", "Enough?"],
  ["Disk", "100 GB", "3.43 GB", "3%", "Yes"],
  ["Inodes (files/dirs)", "400000", "10201", "3%", "Yes"],
  ["CPU", "100%", "~0% live average", "Near idle", "Yes"],
  ["Memory (RAM)", "2048 MB", "~2 MB live average", "<1%", "Yes"],
  ["Throughput (I/O)", "12288 KB/s", "~1 KB/s live", "Near idle", "Yes"],
  ["PHP Workers", "40", "~0 live", "Near idle", "Yes"],
  ["Storage IOPS", "128", "~0 live", "Near idle", "Yes"],
  ["Max Processes", "80", "~0 live", "Near idle", "Yes"],
];

const resources = [
  ["Resource", "Current / Typical", "Notes"],
  ["Hosting plan", "Hostinger shared (public_html)", "Frontend + API same host"],
  ["CPU", "Low (near 0% at sample)", "Higher only during imports / exports"],
  ["RAM", "Very light (~2 MB live of 2048 MB)", "PHP request/response model"],
  ["App + data disk", "3.43 GB of 100 GB", "Includes code, assets, uploads/storage"],
  ["Inodes", "10201 of 400000", "Plenty of headroom"],
  ["Email", "Transactional SMTP", "OTP, welcome, notifications"],
  [
    "Peak load window",
    "Business hours IST",
    "Lead list, forms, marketing, WhatsApp",
  ],
];

const traffic = [
  ["Metric", "Planned / expected", "Observed (Hostinger, last 7 days)", "Enough?"],
  ["Concurrent / unique visitors", "10–50 typical, ~100 peak concurrent", "Unique IPs peak ~24/day (Jul 17)", "Yes"],
  ["Requests / day", "5,000–30,000", "~26,203 total / 7 days ≈ 3,743/day avg", "Yes"],
  ["Peak request burst", "~50–150 req/min work hours", "Graph peak ~2,000 requests on Jul 21 (period spike)", "Yes"],
  ["Bandwidth / month", "5–50 GB", "~53 MB in 7 days (≈0.2 GB/month pace)", "Yes"],
  ["Bandwidth daily peak", "—", "~4.8 MB peak day (Jul 21)", "Yes"],
  ["Geography", "India primary", "India 26,029; US 164; others negligible", "Yes"],
  ["Emails / day", "Tens to a few hundred", "Not shown in Hostinger Analytics screen", "N/A"],
  ["Webhooks", "Razorpay + WhatsApp", "Included in request totals when active", "Yes"],
];

const analytics7d = [
  ["Period", "Last 7 days (Hostinger Analytics filter)"],
  ["Domain", "crm.syncpedia.in"],
  ["Total requests", "26203"],
  ["Total data transferred", "53.06 MB"],
  ["Country - India requests", "26029"],
  ["Country - United States", "164"],
  ["Country - Austria", "3"],
  ["Country - Lithuania", "2"],
  ["Country - Sweden", "2"],
  ["Unique IP peak (approx)", "~24 on Jul 17"],
  ["Bandwidth peak (approx)", "~4.8 MB on Jul 21"],
  ["Request graph peak (approx)", "~2000+ on Jul 21"],
];

const daily = [
  [
    "Date",
    "Requests (approx from graph)",
    "Unique IPs (approx)",
    "Bandwidth MB (approx)",
    "Avg CPU %",
    "Avg RAM MB",
    "Notes",
  ],
  ["2026-07-15", "~1000 peak spikes", "~18", "~2–3", "Not in daily export", "Not in daily export", "Active day"],
  ["2026-07-16", "<500", "low", "~2–3", "", "", "Quieter"],
  ["2026-07-17", "<500", "~24 peak", "~2–4", "", "", "Highest unique IPs"],
  ["2026-07-18", "<500", "low", "~2–3", "", "", ""],
  ["2026-07-19", "<500", "low", "low", "", "", ""],
  ["2026-07-20", "<500", "~12", "~2–3", "", "", ""],
  ["2026-07-21", "peak ~2000+", "~10", "~4.8", "", "", "Highest request + bandwidth spike"],
  ["2026-07-22", "very low", "low", "low", "~0 live sample", "~2 live sample", "Live resource sample near idle"],
  ["TOTAL 7d", "26203", "—", "53.06", "—", "—", "From Analytics summary cards"],
];

const hourly = [
  [
    "Note",
    "Hostinger Analytics shows period charts, not exact per-hour export. Live Resource Usage sample (≈1 hour window ~10:26–11:27) filled below.",
  ],
  [
    "Date",
    "Hour (IST)",
    "CPU %",
    "RAM MB",
    "Disk used (GB)",
    "Requests",
    "Active users / IPs",
    "Bandwidth (MB)",
    "PHP workers",
    "I/O KB/s",
    "Notes",
  ],
  [
    "2026-07-22",
    "Live sample (~1h)",
    "0",
    "2",
    "3.43",
    "see Analytics",
    "see Unique IPs chart",
    "see Bandwidth chart",
    "0",
    "1",
    "CPU/RAM/PHP/I-O from Resource Usage Live",
  ],
];

const short = [
  ["Ultra-short summary"],
  ["React + PHP 8 API + MySQL + SSL + SMTP on Hostinger."],
  ["Domain: crm.syncpedia.in (frontend + /api)."],
  ["JWT auth, IST timezone."],
  ["Also use Razorpay and Meta WhatsApp."],
  ["Health: https://crm.syncpedia.in/api/ping.php"],
  [""],
  ["Measured (last 7 days): ~26,203 requests, 53.06 MB transfer, mostly India."],
  ["Plan headroom: disk 3%, inodes 3%, RAM/CPU/PHP workers near idle."],
  ["Verdict: Hostinger shared plan is enough; no upgrade needed now."],
];

const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${sheet("Overview", overview)}
${sheet("Services", services)}
${sheet("Configuration", config)}
${sheet("Plan Limits vs Usage", planLimits)}
${sheet("Current Resource Usage", resources)}
${sheet("Expected vs Observed", traffic)}
${sheet("Analytics 7 Days", analytics7d)}
${sheet("Utilization Daily", daily)}
${sheet("Utilization Hourly", hourly)}
${sheet("Ultra Short", short)}
</Workbook>
`;

const out = path.join(__dirname, "..", "Syncpedia_CRM_Infrastructure.xls");
fs.writeFileSync(out, xml, "utf8");
console.log("Wrote", out);
