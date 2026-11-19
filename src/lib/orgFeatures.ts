/**
 * Org feature flags (Super Admin → Portals & Access) mapped to real CRM routes.
 * Only keys listed here are persisted and shown in the feature toggles UI.
 */

export const FEATURE_OFFER_LETTERS = "offer_letters";
export const FEATURE_FRESHER_SALARY = "fresher_salary";
export const FEATURE_CERTIFICATES = "certificates";
export const FEATURE_MARKETING = "marketing_access";
export const FEATURE_PAYSLIP = "payslip";
export const FEATURE_FORM_MANAGEMENT = "form_management";
export const FEATURE_TIMETABLES = "timetables";
export const FEATURE_COMMUNICATIONS = "communications";
export const FEATURE_VIDEO_INTROS = "video_intros";
export const FEATURE_COUPONS = "coupons";
export const FEATURE_LIVE_CLASSES = "live_classes";
export const FEATURE_PAYMENT_RECORDS = "payment_records";

/** Features that exist as pages in this CRM build. */
export const IMPLEMENTED_ORG_FEATURES: {
  key: string;
  label: string;
  description: string;
  section: string;
}[] = [
  { key: "leads", section: "CRM", label: "Leads & Dashboard", description: "Dashboard, lead lists, referrals, and assignments" },
  { key: FEATURE_FORM_MANAGEMENT, section: "CRM", label: "Form Management", description: "Build and publish lead capture forms" },
  { key: "tasks", section: "CRM", label: "Tasks", description: "Team tasks and follow-ups" },
  { key: "notifications", section: "CRM", label: "Notifications", description: "In-app alerts" },
  { key: "students", section: "Learning", label: "Students", description: "Enrolled student profiles" },
  { key: "courses", section: "Learning", label: "Courses", description: "Course catalog" },
  { key: "batches", section: "Learning", label: "Batches", description: "Batch schedules and enrollment" },
  { key: FEATURE_TIMETABLES, section: "Learning", label: "Timetables", description: "Weekly/monthly class schedules and email delivery" },
  { key: FEATURE_LIVE_CLASSES, section: "Learning", label: "Live Classes", description: "Live class schedule synced from the LMS" },
  { key: FEATURE_COMMUNICATIONS, section: "Engagement", label: "Communications", description: "WhatsApp hub and messaging" },
  { key: FEATURE_MARKETING, section: "Engagement", label: "Marketing Portal", description: "Email / WhatsApp marketing for org users" },
  { key: "payments", section: "Finance", label: "Payment Links", description: "Create and track Razorpay payment links" },
  { key: FEATURE_PAYMENT_RECORDS, section: "Finance", label: "Payment Records", description: "Collected payments, manual payment approvals and candidate balances" },
  { key: FEATURE_COUPONS, section: "Finance", label: "Coupons", description: "Person-specific discount coupons and the coupon API" },
  { key: FEATURE_PAYSLIP, section: "Finance", label: "Payslip", description: "Employee payslip generation" },
  { key: "daily_reports", section: "Reports", label: "Daily Reports", description: "Daily activity reports, call log, analytics" },
  { key: "holidays", section: "Reports", label: "Holidays", description: "Org holiday calendar" },
  { key: FEATURE_CERTIFICATES, section: "HR & Docs", label: "Certificates", description: "Certificate templates and issuance" },
  { key: FEATURE_OFFER_LETTERS, section: "HR & Docs", label: "Offer Letters", description: "Offer letter templates and sending" },
  { key: FEATURE_VIDEO_INTROS, section: "HR & Docs", label: "Video introductions", description: "Candidate self-introduction video invitations and review" },
  { key: FEATURE_FRESHER_SALARY, section: "HR & Docs", label: "Fresher Salary Tracker", description: "Sales fresher salary evaluation" },
];

export const IMPLEMENTED_FEATURE_KEYS = IMPLEMENTED_ORG_FEATURES.map((f) => f.key);

/** When an org has no feature rows yet (legacy), these modules stay enabled. */
export const CORE_DEFAULT_FEATURES = [
  "leads",
  FEATURE_FORM_MANAGEMENT,
  "tasks",
  "notifications",
  "students",
  "courses",
  "batches",
  FEATURE_TIMETABLES,
  FEATURE_COMMUNICATIONS,
  "payments",
  "daily_reports",
  "holidays",
  FEATURE_VIDEO_INTROS,
  FEATURE_COUPONS,
  FEATURE_LIVE_CLASSES,
  FEATURE_PAYMENT_RECORDS,
];

/**
 * Switches added after orgs were already configured. Until a super admin sets them, they stay ON
 * (these pages were always visible before), so no org loses a page. Payment Records instead follows
 * the Payment Links switch, which used to cover it. Keep in sync with helpers.php.
 */
export const DEFAULT_ON_WHEN_UNSET: readonly string[] = [FEATURE_VIDEO_INTROS, FEATURE_COUPONS, FEATURE_LIVE_CLASSES];

/** Value a never-saved switch has for an org that already has feature rows. */
function unsetFeatureValue(feats: Record<string, boolean>, featureKey: string): boolean {
  if (featureKey === FEATURE_PAYMENT_RECORDS) {
    return Object.prototype.hasOwnProperty.call(feats, "payments") ? feats.payments === true : true;
  }
  return DEFAULT_ON_WHEN_UNSET.includes(featureKey);
}

/**
 * Switch states to show in the Features dialog, filling in never-saved switches with the value the
 * org actually gets at runtime (instead of showing them OFF).
 */
export function resolveFeatureToggles(rows: { feature: string; enabled: unknown }[]): Record<string, boolean> {
  const stored: Record<string, boolean> = {};
  for (const r of rows) stored[r.feature] = !!r.enabled;
  const out: Record<string, boolean> = {};
  const hasRows = Object.keys(stored).length > 0;
  for (const key of IMPLEMENTED_FEATURE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(stored, key)) out[key] = stored[key];
    else out[key] = hasRows ? unsetFeatureValue(stored, key) : CORE_DEFAULT_FEATURES.includes(key);
  }
  return out;
}

export function isSyncpediaOrganization(org: { slug?: string | null } | null): boolean {
  return String(org?.slug ?? "")
    .toLowerCase()
    .trim() === "syncpedia";
}

/** True when org has at least one row in org_features (strict toggle mode). */
export function orgHasConfiguredFeatures(org: { features?: Record<string, boolean> | null } | null): boolean {
  const feats = org?.features;
  return !!feats && Object.keys(feats).length > 0;
}

/**
 * Whether a module is enabled for the current org context.
 * - Platform super_admin (no org in context): all modules.
 * - Syncpedia org: offer letters + fresher salary always on.
 * - Orgs with feature rows: only explicitly enabled keys.
 * - Legacy orgs (no rows): core defaults only.
 */
export function isOrgFeatureEnabled(
  role: string | null,
  org: { slug?: string | null; features?: Record<string, boolean> | null } | null,
  featureKey: string,
): boolean {
  // Super admin keeps full module access after switchOrg (org context is for data scoping only).
  if (role === "super_admin") return true;

  if (isSyncpediaOrganization(org)) {
    if (featureKey === FEATURE_OFFER_LETTERS || featureKey === FEATURE_FRESHER_SALARY || featureKey === FEATURE_VIDEO_INTROS) {
      return true;
    }
  }

  const feats = org?.features;
  if (!orgHasConfiguredFeatures(org)) {
    return CORE_DEFAULT_FEATURES.includes(featureKey);
  }

  if (feats && !Object.prototype.hasOwnProperty.call(feats, featureKey)) {
    return unsetFeatureValue(feats, featureKey);
  }

  return feats?.[featureKey] === true;
}

/** Map a route path to the feature key that gates it (longest prefix wins). */
export function featureKeyForPath(pathname: string): string | null {
  const p = pathname.split("?")[0].replace(/\/+$/, "") || "/";

  // Home dashboard is part of the Leads & Dashboard org module (not a separate org feature).
  if (p === "/") return "leads";
  if (p.startsWith("/leads") || p.startsWith("/my-leads") || p.startsWith("/assigned-leads")
    || p.startsWith("/my-referrals") || p.startsWith("/referral-analytics") || p.startsWith("/leads-management")) {
    return "leads";
  }
  if (p.startsWith("/form-management") || p.startsWith("/form-api-integrations") || p.startsWith("/hr/form-management")) {
    return FEATURE_FORM_MANAGEMENT;
  }
  if (p.startsWith("/students") || p.startsWith("/access-users")) return "students"; // /access-users redirects to Students
  if (p.startsWith("/courses")) return "courses";
  if (p.startsWith("/batches")) return "batches";
  if (p.startsWith("/timetables")) return FEATURE_TIMETABLES;
  if (p.startsWith("/tasks")) return "tasks";
  if (p.startsWith("/notifications")) return "notifications";
  if (p.startsWith("/payments/records") || p.startsWith("/payment-links/records")) return FEATURE_PAYMENT_RECORDS;
  if (p.startsWith("/payments") || p.startsWith("/payment-links")) return "payments";
  if (p.startsWith("/coupons")) return FEATURE_COUPONS;
  if (p.startsWith("/live-classes")) return FEATURE_LIVE_CLASSES;
  if (p.startsWith("/payslip")) return FEATURE_PAYSLIP;
  if (p.startsWith("/daily-reports") || p.startsWith("/sales/call-log")) return "daily_reports";
  if (p.startsWith("/holidays")) return "holidays";
  if (p.startsWith("/communications")) return FEATURE_COMMUNICATIONS;
  if (p.startsWith("/marketing")) return FEATURE_MARKETING;
  if (p.startsWith("/certificates")) return FEATURE_CERTIFICATES;
  if (p.startsWith("/offer-letters")) return FEATURE_OFFER_LETTERS;
  if (p.startsWith("/video-intros")) return FEATURE_VIDEO_INTROS;
  if (p.startsWith("/fresher-salary-tracker")) return FEATURE_FRESHER_SALARY;
  if (p.startsWith("/team")) return "team";
  if (p.startsWith("/settings")) return "settings";
  if (p.startsWith("/trash")) return "trash";

  return null;
}

/** Keys that are not org_features rows — always on for the org; managers still need page grants. */
const ORG_SHELL_FEATURES = new Set(["team", "settings", "trash"]);

/**
 * Organisation-level route access (admin / org / manager all respect this first).
 * Home `/` uses the "leads" org module (Leads & Dashboard).
 */
export function isPathAllowedByOrgFeatures(
  role: string | null,
  org: { slug?: string | null; features?: Record<string, boolean> | null } | null,
  pathname: string,
): boolean {
  const key = featureKeyForPath(pathname);
  if (!key) return true;
  if (ORG_SHELL_FEATURES.has(key)) return true;
  return isOrgFeatureEnabled(role, org, key);
}

/** Group implemented features for Super Admin UI. */
export function implementedFeaturesBySection(): { title: string; features: typeof IMPLEMENTED_ORG_FEATURES }[] {
  const sections = new Map<string, typeof IMPLEMENTED_ORG_FEATURES>();
  for (const f of IMPLEMENTED_ORG_FEATURES) {
    const list = sections.get(f.section) ?? [];
    list.push(f);
    sections.set(f.section, list);
  }
  return Array.from(sections.entries()).map(([title, features]) => ({ title, features }));
}

/** Default toggles when creating a new organization. */
export function defaultFeaturesForNewOrg(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of IMPLEMENTED_FEATURE_KEYS) {
    out[key] = ![
      FEATURE_CERTIFICATES,
      FEATURE_OFFER_LETTERS,
      FEATURE_FRESHER_SALARY,
      FEATURE_MARKETING,
      FEATURE_PAYSLIP,
    ].includes(key);
  }
  return out;
}
