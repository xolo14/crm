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
  FEATURE_VIDEO_INTROS,
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

/** Core/needed pages toggled ON by default for Operational Manager (others default OFF). */
export const OPERATIONAL_MANAGER_DEFAULT_ON_PAGE_KEYS: readonly string[] = [
  "dashboard",
  "students",
  FEATURE_TIMETABLES,
  FEATURE_FORM_MANAGEMENT,
  "payments",
  FEATURE_COMMUNICATIONS,
  FEATURE_OFFER_LETTERS,
  FEATURE_MARKETING,
  "tasks",
  "notifications",
  "holidays",
  "settings",
 "team",
];

/** Operational Manager has the full page list configurable like Manager/Admin. */
export const OPERATIONAL_MANAGER_PAGE_ACCESS_OPTIONS: ManagerPageOption[] =
  MANAGER_PAGE_ACCESS_OPTIONS;

export const OPERATIONAL_MANAGER_PAGE_ACCESS_KEYS = MANAGER_PAGE_ACCESS_KEYS;

/** Legacy reference kept for backward compatibility */
export const OPERATIONAL_MANAGER_AUTO_GRANTED_PAGE_KEYS = OPERATIONAL_MANAGER_DEFAULT_ON_PAGE_KEYS;

/** Legacy reference kept for backward compatibility */
export const OPERATIONAL_MANAGER_ALWAYS_ON_OPTIONS: ManagerPageOption[] = [];

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

/**
 * Default pages for Operational Manager:
 * - allOn === true: all pages ON
 * - allOn === false: all pages OFF
 * - allOn === undefined: needed pages ON, other admin pages OFF
 */
export function defaultOperationalManagerPages(allOn?: boolean): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of OPERATIONAL_MANAGER_PAGE_ACCESS_KEYS) {
    out[key] =
      allOn !== undefined
        ? allOn
        : OPERATIONAL_MANAGER_DEFAULT_ON_PAGE_KEYS.includes(key);
  }
  return out;
}

export function pickOperationalManagerPages(
  pages?: Record<string, boolean> | null,
): Record<string, boolean> {
  const out = defaultOperationalManagerPages();
  if (!pages || typeof pages !== "object") return out;
  for (const key of OPERATIONAL_MANAGER_PAGE_ACCESS_KEYS) {
    if (key in pages) {
      const v = pages[key];
      out[key] = v === true || v === 1 || v === "1" || v === "true";
    }
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
 * Merge stored pages for Configure pages UI (Operational Manager).
 * Unconfigured/new shows needed pages ON, others OFF.
 */
export function resolveOperationalManagerPagesForEdit(
  pageAccess?: PageAccess | null,
): Record<string, boolean> {
  const stored = pageAccess?.pages;
  const defaults = defaultOperationalManagerPages();
  if (!stored || typeof stored !== "object" || Object.keys(stored).length === 0) {
    return defaults;
  }
  return { ...defaults, ...stored };
}

/**
 * Operational Manager page grant check:
 * - If admin saved a configured page map, honors exact toggles.
 * - Otherwise defaults to needed pages ON, others OFF.
 */
export function operationalManagerHasPageAccess(
  pageAccess: PageAccess | null | undefined,
  featureKey: string | null | undefined,
): boolean {
  if (!featureKey) return true;
  const pages = pageAccess?.pages;
  if (!pages || Object.keys(pages).length === 0) {
    return OPERATIONAL_MANAGER_DEFAULT_ON_PAGE_KEYS.includes(featureKey);
  }
  const v = pages[featureKey];
  return v === true || v === 1 || v === "1" || v === "true";
}

/** Operational Manager home is always `/` (auto-granted dashboard). */
export function firstAllowedOperationalManagerPath(
 pageAccess?: PageAccess | null,
): string {
 const order = [
 { key: "dashboard", path: "/" },
 { key: "students", path: "/students" },
 { key: FEATURE_TIMETABLES, path: "/timetables" },
 { key: FEATURE_FORM_MANAGEMENT, path: "/form-management" },
 { key: "payments", path: "/payments" },
 { key: FEATURE_COMMUNICATIONS, path: "/communications" },
 { key: FEATURE_OFFER_LETTERS, path: "/offer-letters" },
 { key: FEATURE_VIDEO_INTROS, path: "/video-intros" },
 { key: FEATURE_MARKETING, path: "/marketing/portal" },
 { key: "tasks", path: "/tasks" },
 { key: "notifications", path: "/notifications" },
 { key: "holidays", path: "/holidays" },
 { key: "team", path: "/team" },
 { key: "trash", path: "/trash" },
 { key: "settings", path: "/settings" },
 ];
 for (const item of order) {
 if (operationalManagerHasPageAccess(pageAccess, item.key)) return item.path;
 }
 return "";
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
