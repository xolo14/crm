/**
 * Access model:
 * - Org admin / super_admin: pages enabled for the organisation (org_features).
 * - Manager / Operational Manager: subset granted by org admin via users.page_access_json.pages.
 */
import {
  FEATURE_COMMUNICATIONS,
  FEATURE_FORM_MANAGEMENT,
  FEATURE_MARKETING,
  FEATURE_OFFER_LETTERS,
  FEATURE_TIMETABLES,
  IMPLEMENTED_ORG_FEATURES,
  featureKeyForPath,
} from "@/lib/orgFeatures";
import { normalizeAppRole } from "@/lib/roleUtils";
import type { PageAccess } from "@/lib/orgAccess";

export type ManagerPageOption = {
  key: string;
  label: string;
  description: string;
  section: string;
};

/** Pages an org admin can toggle for a manager account. */
export const MANAGER_PAGE_ACCESS_OPTIONS: ManagerPageOption[] = [
  { key: "dashboard", section: "Core", label: "Dashboard", description: "Home dashboard" },
  { key: "team", section: "Core", label: "Team", description: "View and manage downline team" },
  { key: "settings", section: "Core", label: "Settings", description: "Profile and preferences" },
  { key: "trash", section: "Core", label: "Trash", description: "Deleted records" },
  ...IMPLEMENTED_ORG_FEATURES.map((f) => ({
    key: f.key,
    label: f.label,
    description: f.description,
    section: f.section,
  })),
];

export const MANAGER_PAGE_ACCESS_KEYS = MANAGER_PAGE_ACCESS_OPTIONS.map((o) => o.key);

/** Always on for Operational Manager — not shown in Configure pages. */
export const OPERATIONAL_MANAGER_AUTO_GRANTED_PAGE_KEYS = [
  FEATURE_MARKETING,
  FEATURE_FORM_MANAGEMENT,
  "dashboard",
  "payments",
  "students",
  FEATURE_OFFER_LETTERS,
  FEATURE_TIMETABLES,
  "settings",
  "tasks",
  "notifications",
  "holidays",
] as const;

/**
 * Optional pages — shown in Configure pages (OFF until org admin toggles ON).
 */
export const OPERATIONAL_MANAGER_PAGE_ACCESS_OPTIONS: ManagerPageOption[] = [
  {
    key: FEATURE_COMMUNICATIONS,
    section: "Engagement",
    label: "Communications",
    description: "Calls and messaging hub",
  },
  { key: "courses", section: "Learning", label: "Courses", description: "Course catalog" },
  { key: "batches", section: "Learning", label: "Batches", description: "Batch schedules" },
  { key: "daily_reports", section: "Reports", label: "Daily Reports", description: "Daily activity reports" },
  { key: "leads", section: "CRM", label: "Leads & Dashboard", description: "Lead lists and referrals" },
];

export const OPERATIONAL_MANAGER_PAGE_ACCESS_KEYS =
  OPERATIONAL_MANAGER_PAGE_ACCESS_OPTIONS.map((o) => o.key);

/** Always-on OM pages — shown read-only in Configure pages (not persisted). */
export const OPERATIONAL_MANAGER_ALWAYS_ON_OPTIONS: ManagerPageOption[] = [
  { key: "dashboard", section: "Always on", label: "Dashboard", description: "Payments overview home" },
  { key: FEATURE_FORM_MANAGEMENT, section: "Always on", label: "Form Management", description: "Lead / HR capture forms" },
  { key: "payments", section: "Always on", label: "Payment Records", description: "Candidate pitches and collections" },
  { key: "students", section: "Always on", label: "Students", description: "Enrolled students roster" },
  { key: FEATURE_TIMETABLES, section: "Always on", label: "Timetables", description: "Class schedules and email delivery" },
  { key: FEATURE_OFFER_LETTERS, section: "Always on", label: "Offer Letters", description: "Templates and sending" },
  { key: FEATURE_MARKETING, section: "Always on", label: "Email & WhatsApp marketing", description: "Marketing portal" },
  { key: "tasks", section: "Always on", label: "Tasks", description: "Assigned tasks" },
  { key: "notifications", section: "Always on", label: "Notifications", description: "In-app alerts" },
  { key: "holidays", section: "Always on", label: "Holidays", description: "Holiday calendar" },
  { key: "settings", section: "Always on", label: "Settings", description: "Profile and preferences" },
];

export function defaultManagerPages(allOn = true): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of MANAGER_PAGE_ACCESS_KEYS) {
    out[key] = allOn;
  }
  return out;
}

/**
 * Merge stored pages for the Configure pages UI (Manager).
 * - No pages map (legacy): show all on.
 * - Configured map: missing keys = off (same as runtime managerHasPageAccess).
 */
export function resolveManagerPagesForEdit(pageAccess?: PageAccess | null): Record<string, boolean> {
  const stored = pageAccess?.pages;
  if (!stored || typeof stored !== "object" || Object.keys(stored).length === 0) {
    return defaultManagerPages(true);
  }
  return { ...defaultManagerPages(false), ...stored };
}

export function defaultOperationalManagerPages(allOn = false): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of OPERATIONAL_MANAGER_PAGE_ACCESS_KEYS) {
    out[key] = allOn;
  }
  return out;
}

/** Keep only optional OM page keys from a stored pages map. */
export function pickOperationalManagerPages(
  pages?: Record<string, boolean> | null,
): Record<string, boolean> {
  const out = defaultOperationalManagerPages(false);
  if (!pages || typeof pages !== "object") return out;
  for (const key of OPERATIONAL_MANAGER_PAGE_ACCESS_KEYS) {
    const v = pages[key];
    out[key] = v === true || v === 1 || v === "1" || v === "true";
  }
  return out;
}

export function buildOperationalManagerPageAccessPayload(
  pages: Record<string, boolean>,
): PageAccess {
  return {
    payments: false,
    offer_letters: false,
    pages: pickOperationalManagerPages(pages),
  };
}

/**
 * Merge stored pages for the Configure pages UI (Operational Manager).
 * Only optional pages appear; all default OFF until toggled on.
 */
export function resolveOperationalManagerPagesForEdit(
  pageAccess?: PageAccess | null,
): Record<string, boolean> {
  const stored = pageAccess?.pages;
  if (!stored || typeof stored !== "object" || Object.keys(stored).length === 0) {
    return defaultOperationalManagerPages(false);
  }
  return pickOperationalManagerPages(stored);
}

/**
 * Operational Manager page grant:
 * - Core ops + email/WhatsApp marketing: always on (auto-granted).
 * - Optional pages (in Configure): OFF unless explicitly toggled on.
 */
export function operationalManagerHasPageAccess(
  pageAccess: PageAccess | null | undefined,
  featureKey: string | null | undefined,
): boolean {
  if (!featureKey) return true;
  if ((OPERATIONAL_MANAGER_AUTO_GRANTED_PAGE_KEYS as readonly string[]).includes(featureKey)) {
    return true;
  }
  const pages = pageAccess?.pages;
  if (!pages || Object.keys(pages).length === 0) return false;
  const v = pages[featureKey];
  return v === true || v === 1 || v === "1" || v === "true";
}

/** Operational Manager home — dashboard is auto-granted. */
export function firstAllowedOperationalManagerPath(
  _pageAccess?: PageAccess | null,
): string {
  return "/";
}

/**
 * Page grant check for manager / operational_manager.
 * - No pages map (legacy): allow everything the org already allows.
 * - Configured map: only keys explicitly set to true are allowed.
 */
export function managerHasPageAccess(
  pageAccess: PageAccess | null | undefined,
  featureKey: string | null | undefined,
): boolean {
  if (!featureKey) return true;
  const pages = pageAccess?.pages;
  if (!pages || Object.keys(pages).length === 0) return true;
  const v = pages[featureKey];
  return v === true || v === 1 || v === "1" || v === "true";
}

/** Map a route to the manager/OM page-access key (home uses "dashboard"). */
export function managerFeatureKeyForPath(pathname: string): string | null {
  const p = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (p === "/") return "dashboard";
  return featureKeyForPath(pathname);
}

export function roleUsesConfigurablePages(role: string | null | undefined): boolean {
  const r = normalizeAppRole(role);
  return r === "manager" || r === "operational_manager";
}

/** Non-managers/OM ignore page map; managers and operational managers honor org-admin grants. */
export function roleAllowsFeaturePage(
  role: string | null | undefined,
  pageAccess: PageAccess | null | undefined,
  featureKey: string | null | undefined,
): boolean {
  if (!roleUsesConfigurablePages(role)) return true;
  const r = normalizeAppRole(role);
  if (r === "operational_manager") {
    return operationalManagerHasPageAccess(pageAccess, featureKey);
  }
  return managerHasPageAccess(pageAccess, featureKey);
}

export function managerPagesBySection(): { title: string; options: ManagerPageOption[] }[] {
  return groupPageOptions(MANAGER_PAGE_ACCESS_OPTIONS);
}

export function operationalManagerPagesBySection(): {
  title: string;
  options: ManagerPageOption[];
}[] {
  return groupPageOptions(OPERATIONAL_MANAGER_PAGE_ACCESS_OPTIONS);
}

export function operationalManagerAlwaysOnPagesBySection(): {
  title: string;
  options: ManagerPageOption[];
}[] {
  return groupPageOptions(OPERATIONAL_MANAGER_ALWAYS_ON_OPTIONS);
}

function groupPageOptions(
  options: ManagerPageOption[],
): { title: string; options: ManagerPageOption[] }[] {
  const map = new Map<string, ManagerPageOption[]>();
  for (const o of options) {
    const list = map.get(o.section) ?? [];
    list.push(o);
    map.set(o.section, list);
  }
  return Array.from(map.entries()).map(([title, opts]) => ({ title, options: opts }));
}
