/**
 * Access model:
 * - Admin / org: pages enabled for the organisation (org_features).
 * - Manager: subset granted by admin via users.page_access_json.pages.
 */
import { IMPLEMENTED_ORG_FEATURES, featureKeyForPath } from "@/lib/orgFeatures";
import { normalizeAppRole } from "@/lib/roleUtils";
import type { PageAccess } from "@/lib/orgAccess";

export type ManagerPageOption = {
  key: string;
  label: string;
  description: string;
  section: string;
};

/** Pages an admin can toggle for a manager account. */
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

export function defaultManagerPages(allOn = true): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of MANAGER_PAGE_ACCESS_KEYS) {
    out[key] = allOn;
  }
  return out;
}

/**
 * Merge stored pages for the Configure pages UI.
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
 * Manager page grant check.
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
  return pages[featureKey] === true;
}

/** Map a route to the manager page-access key (home uses "dashboard"). */
export function managerFeatureKeyForPath(pathname: string): string | null {
  const p = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (p === "/") return "dashboard";
  return featureKeyForPath(pathname);
}

/** Non-managers ignore page map; managers honor admin grants. */
export function roleAllowsFeaturePage(
  role: string | null | undefined,
  pageAccess: PageAccess | null | undefined,
  featureKey: string | null | undefined,
): boolean {
  const r = normalizeAppRole(role);
  if (r !== "manager") return true;
  return managerHasPageAccess(pageAccess, featureKey);
}

export function managerPagesBySection(): { title: string; options: ManagerPageOption[] }[] {
  const map = new Map<string, ManagerPageOption[]>();
  for (const o of MANAGER_PAGE_ACCESS_OPTIONS) {
    const list = map.get(o.section) ?? [];
    list.push(o);
    map.set(o.section, list);
  }
  return Array.from(map.entries()).map(([title, options]) => ({ title, options }));
}
