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
export const FEATURE_COMMUNICATIONS = "communications";

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
  { key: FEATURE_COMMUNICATIONS, section: "Engagement", label: "Communications", description: "WhatsApp hub and messaging" },
  { key: FEATURE_MARKETING, section: "Engagement", label: "Marketing Portal", description: "Email / WhatsApp marketing for org users" },
  { key: "payments", section: "Finance", label: "Payment Links", description: "Razorpay payment links and records" },
  { key: FEATURE_PAYSLIP, section: "Finance", label: "Payslip", description: "Employee payslip generation" },
  { key: "daily_reports", section: "Reports", label: "Daily Reports", description: "Daily activity reports, call log, analytics" },
  { key: "holidays", section: "Reports", label: "Holidays", description: "Org holiday calendar" },
  { key: FEATURE_CERTIFICATES, section: "HR & Docs", label: "Certificates", description: "Certificate templates and issuance" },
  { key: FEATURE_OFFER_LETTERS, section: "HR & Docs", label: "Offer Letters", description: "Offer letter templates and sending" },
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
  FEATURE_COMMUNICATIONS,
  "payments",
  "daily_reports",
  "holidays",
];

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
    if (featureKey === FEATURE_OFFER_LETTERS || featureKey === FEATURE_FRESHER_SALARY) {
      return true;
    }
  }

  const feats = org?.features;
  if (!orgHasConfiguredFeatures(org)) {
    return CORE_DEFAULT_FEATURES.includes(featureKey);
  }

  return feats?.[featureKey] === true;
}

/** Map a route path to the feature key that gates it (longest prefix wins). */
export function featureKeyForPath(pathname: string): string | null {
  const p = pathname.split("?")[0].replace(/\/+$/, "") || "/";

  if (p === "/" || p.startsWith("/leads") || p.startsWith("/my-leads") || p.startsWith("/assigned-leads")
    || p.startsWith("/my-referrals") || p.startsWith("/referral-analytics") || p.startsWith("/leads-management")) {
    return "leads";
  }
  if (p.startsWith("/form-management") || p.startsWith("/form-api-integrations")) return FEATURE_FORM_MANAGEMENT;
  if (p.startsWith("/students")) return "students";
  if (p.startsWith("/courses")) return "courses";
  if (p.startsWith("/batches")) return "batches";
  if (p.startsWith("/tasks")) return "tasks";
  if (p.startsWith("/notifications")) return "notifications";
  if (p.startsWith("/payments") || p.startsWith("/payment-links")) return "payments";
  if (p.startsWith("/payslip")) return FEATURE_PAYSLIP;
  if (p.startsWith("/daily-reports") || p.startsWith("/sales/call-log")) return "daily_reports";
  if (p.startsWith("/holidays")) return "holidays";
  if (p.startsWith("/communications")) return FEATURE_COMMUNICATIONS;
  if (p.startsWith("/marketing")) return FEATURE_MARKETING;
  if (p.startsWith("/certificates")) return FEATURE_CERTIFICATES;
  if (p.startsWith("/offer-letters")) return FEATURE_OFFER_LETTERS;
  if (p.startsWith("/fresher-salary-tracker")) return FEATURE_FRESHER_SALARY;

  return null;
}

export function isPathAllowedByOrgFeatures(
  role: string | null,
  org: { slug?: string | null; features?: Record<string, boolean> | null } | null,
  pathname: string,
): boolean {
  const key = featureKeyForPath(pathname);
  if (!key) return true;
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
