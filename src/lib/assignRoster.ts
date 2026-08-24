/**
 * Assign pickers: show all active org / downline members (team.list already scopes managers).
 * Excludes platform admins and students — not typical lead/form assignees.
 * Callers should use ensureAssignRosterIncludesSelf() so manager/admin can assign to themselves.
 */

const EXCLUDED_ASSIGN_ROLES = new Set(["super_admin", "admin", "org", "student"]);

export function isActiveTeamMemberFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

/** Roles that can appear in Assign dialogs (full downline / org roster). */
export function isOrgAssignableMemberRole(role?: string | null): boolean {
  const normalized = String(role || "")
    .trim()
    .toLowerCase();
  if (!normalized || EXCLUDED_ASSIGN_ROLES.has(normalized)) return false;
  return true;
}

export type AssignRosterMember = {
  id: string;
  full_name: string;
  email?: string;
  phone?: string;
  role?: string;
  is_active?: boolean | number | string;
  reports_to_id?: string | null;
  reports_to_name?: string | null;
  org_id?: string;
  created_at?: string;
};

/** Filter + hierarchy-friendly sort for Assign UIs. */
export function filterAndSortAssignRoster<T extends AssignRosterMember>(
  members: T[],
  opts?: { excludeUserId?: string | null },
): T[] {
  const exclude = opts?.excludeUserId ? String(opts.excludeUserId) : "";
  const active = members.filter((m) => {
    if (!m?.id || (exclude && String(m.id) === exclude)) return false;
    if (!isOrgAssignableMemberRole(m.role)) return false;
    if (!isActiveTeamMemberFlag(m.is_active)) return false;
    return true;
  });

  const managers = active
    .filter((m) => String(m.role || "").toLowerCase() === "manager")
    .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
  const managerIds = new Set(managers.map((m) => m.id));
  const underManager: T[] = [];
  for (const mgr of managers) {
    const kids = active
      .filter((m) => !managerIds.has(m.id) && String(m.reports_to_id || "") === mgr.id)
      .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
    underManager.push(...kids);
  }
  const placed = new Set([...managers.map((m) => m.id), ...underManager.map((m) => m.id)]);
  const rest = active
    .filter((m) => !placed.has(m.id))
    .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
  return [...managers, ...underManager, ...rest];
}

/**
 * Ensure the logged-in manager/admin/org appears in bulk/single assign pickers
 * so they can assign leads to themselves.
 */
export function ensureAssignRosterIncludesSelf<T extends AssignRosterMember>(
  members: T[],
  self?: {
    id?: string | null;
    full_name?: string | null;
    name?: string | null;
    role?: string | null;
    email?: string | null;
  } | null,
): T[] {
  const id = String(self?.id || "").trim();
  if (!id) return members;
  if (members.some((m) => String(m.id) === id)) return members;

  const role = String(self?.role || "")
    .trim()
    .toLowerCase()
    .replace(/^superadmin$/, "super_admin")
    .replace(/^organisation$/, "org");
  const canSelfAssign = ["manager", "admin", "org", "super_admin"].includes(role);
  if (!canSelfAssign) return members;

  const fullName =
    String(self?.full_name || self?.name || "").trim() || "Me (self)";
  const selfRow = {
    id,
    full_name: fullName,
    email: self?.email ? String(self.email) : undefined,
    role: role || "manager",
    is_active: 1,
  } as T;

  return [selfRow, ...members];
}
