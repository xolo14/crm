/**
 * Org role model (higher level = more authority):
 *   L4 — super_admin
 *   L3 — admin / org admin
 *   L2 — manager
 *   L1 — sales_representative, hr, marketing
 */

/** Normalize role key; legacy aliases map to current roles. */
export function normalizeAppRole(role?: string | null): string {
  const r = String(role || "")
    .trim()
    .toLowerCase()
    .replace(/^superadmin$/, "super_admin")
    .replace(/^organisation$/, "org");
  if (r === "sales_executive") return "sales_representative";
  if (r === "team_lead" || r === "sales_manager") return "manager";
  if (r.startsWith("marketing")) return "marketing";
  return r;
}

export const ROLE_HIERARCHY_LEVELS: Record<string, number> = {
  super_admin: 4,
  admin: 3,
  org: 3,
  manager: 2,
  sales_representative: 1,
  hr: 1,
  marketing: 1,
  trainer: 1,
  finance: 1,
  student: 0,
};

/** Display order for Team page groups (L4 → L1). */
export const TEAM_ROLE_GROUPS = [
  { key: "super_admin", label: "Super Admin", level: 4 },
  { key: "admin", label: "Admin", level: 3 },
  { key: "org", label: "Org Admin", level: 3 },
  { key: "manager", label: "Manager", level: 2 },
  { key: "sales_representative", label: "Sales Rep", level: 1 },
  { key: "hr", label: "HR", level: 1 },
  { key: "marketing", label: "Marketing", level: 1 },
] as const;

export const L1_OPERATIONAL_ROLES = [
  "sales_representative",
  "hr",
  "marketing",
] as const;

export const L3_ADMIN_ROLES = ["admin", "org"] as const;

export function getRoleLevel(role?: string | null): number {
  return ROLE_HIERARCHY_LEVELS[normalizeAppRole(role)] ?? 0;
}

export function canRoleManageRole(actorRole?: string | null, targetRole?: string | null): boolean {
  return getRoleLevel(actorRole) > getRoleLevel(targetRole);
}

export function isL3AdminRole(role?: string | null): boolean {
  const r = normalizeAppRole(role);
  return r === "admin" || r === "org";
}

export function isL1OperationalRole(role?: string | null): boolean {
  return (L1_OPERATIONAL_ROLES as readonly string[]).includes(normalizeAppRole(role));
}

/** Field sales roles (Sales Rep portal, payment links, my leads, etc.). */
export function isSalesRepRole(role?: string | null): boolean {
  return normalizeAppRole(role) === "sales_representative";
}

/** Marketing-family roles (L1) — shared lead/form visibility patterns. */
export function isMarketingFamilyRole(role?: string | null): boolean {
  return normalizeAppRole(role) === "marketing";
}

export function isSalesMarketingRole(role?: string | null): boolean {
  return false;
}
