/**
 * Access model for HR accounts:
 * - Admin grants a subset via users.page_access_json.pages (Team → Configure pages).
 * - offer_letters is both a pages{} key and the top-level offer_letters flag (API compatibility).
 */
import type { PageAccess } from "@/lib/orgAccess";

export type HrPageOption = {
  key: string;
  label: string;
  description: string;
  section: string;
};

/** Pages an admin can toggle for an HR account (HR portal + Offer Letters). */
export const HR_PAGE_ACCESS_OPTIONS: HrPageOption[] = [
  { key: "dashboard", section: "Core", label: "Dashboard", description: "HR home dashboard" },
  { key: "my_leads", section: "Leads", label: "My Leads", description: "Leads created by this HR user" },
  { key: "assigned_leads", section: "Leads", label: "Assigned Leads", description: "Leads assigned to this HR user" },
  { key: "tasks", section: "Work", label: "Tasks", description: "Assigned tasks" },
  { key: "reports", section: "Work", label: "Reports", description: "HR reports" },
  { key: "notifications", section: "Work", label: "Notifications", description: "In-app notifications" },
  { key: "communications", section: "Work", label: "Communications", description: "Calls and messages hub" },
  { key: "holidays", section: "Work", label: "Holidays", description: "Holiday calendar" },
  { key: "settings", section: "Core", label: "Settings", description: "Profile and password" },
  {
    key: "offer_letters",
    section: "Documents",
    label: "Offer Letters",
    description: "Create and send offer letters (HR portal)",
  },
];

export const HR_PAGE_ACCESS_KEYS = HR_PAGE_ACCESS_OPTIONS.map((o) => o.key);

/** Map HR portal path → page_access.pages key. */
export function hrFeatureKeyForPath(pathname: string): string | null {
  const p = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (p === "/hr" || p === "/hr/dashboard") return "dashboard";
  if (p === "/hr/my-leads") return "my_leads";
  if (p === "/hr/assigned-leads") return "assigned_leads";
  if (p === "/hr/tasks") return "tasks";
  if (p === "/hr/reports") return "reports";
  if (p === "/hr/notifications") return "notifications";
  if (p === "/hr/communications") return "communications";
  if (p === "/hr/holidays") return "holidays";
  if (p === "/hr/settings") return "settings";
  if (p === "/hr/offer-letters" || p === "/offer-letters") return "offer_letters";
  return null;
}

/**
 * Default grants for a new / fully-enabled HR user.
 * Portal pages default on; offer_letters stays off unless explicitly granted.
 */
export function defaultHrPages(allOn = true): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of HR_PAGE_ACCESS_KEYS) {
    out[key] = key === "offer_letters" ? false : allOn;
  }
  return out;
}

/**
 * Merge stored pages for the Configure pages UI.
 * - No pages map (legacy): portal pages on; offer_letters from top-level flag.
 * - Configured map: missing keys = off.
 */
export function resolveHrPagesForEdit(pageAccess?: PageAccess | null): Record<string, boolean> {
  const stored = pageAccess?.pages;
  if (!stored || typeof stored !== "object" || Object.keys(stored).length === 0) {
    return {
      ...defaultHrPages(true),
      offer_letters: Boolean(pageAccess?.offer_letters),
    };
  }
  return { ...defaultHrPages(false), ...stored };
}

/**
 * HR page grant check.
 * - No pages map (legacy): allow all portal pages; offer_letters uses top-level flag.
 * - Configured map: only keys explicitly set to true are allowed.
 */
export function hrHasPageAccess(
  pageAccess: PageAccess | null | undefined,
  featureKey: string | null | undefined,
): boolean {
  if (!featureKey) return true;
  const pages = pageAccess?.pages;
  if (!pages || Object.keys(pages).length === 0) {
    if (featureKey === "offer_letters") return Boolean(pageAccess?.offer_letters);
    return true;
  }
  return pages[featureKey] === true;
}

/** First allowed HR portal path (fallback settings → dashboard). */
export function firstAllowedHrPath(pageAccess?: PageAccess | null): string {
  const order = [
    { key: "dashboard", path: "/hr/dashboard" },
    { key: "my_leads", path: "/hr/my-leads" },
    { key: "assigned_leads", path: "/hr/assigned-leads" },
    { key: "tasks", path: "/hr/tasks" },
    { key: "reports", path: "/hr/reports" },
    { key: "notifications", path: "/hr/notifications" },
    { key: "communications", path: "/hr/communications" },
    { key: "holidays", path: "/hr/holidays" },
    { key: "offer_letters", path: "/hr/offer-letters" },
    { key: "settings", path: "/hr/settings" },
  ];
  for (const item of order) {
    if (hrHasPageAccess(pageAccess, item.key)) return item.path;
  }
  return "/hr/settings";
}

/** Build page_access payload for HR create/update (keeps offer_letters flag in sync). */
export function buildHrPageAccessPayload(pages: Record<string, boolean>): PageAccess {
  return {
    payments: false,
    offer_letters: pages.offer_letters === true,
    pages,
  };
}

export function hrPagesBySection(): { title: string; options: HrPageOption[] }[] {
  const map = new Map<string, HrPageOption[]>();
  for (const o of HR_PAGE_ACCESS_OPTIONS) {
    const list = map.get(o.section) ?? [];
    list.push(o);
    map.set(o.section, list);
  }
  return Array.from(map.entries()).map(([title, options]) => ({ title, options }));
}
