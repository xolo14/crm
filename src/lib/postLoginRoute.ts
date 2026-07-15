import { api } from "@/lib/api";
import { normalizeAppRole } from "@/lib/roleUtils";

/** Org-level admin roles (L3), not a separate login URL anymore. */
export function isAdminPortalRole(role?: string | null): boolean {
  const n = normalizeAppRole(role);
  return n === "admin" || n === "org";
}

/** Roles that must use `/super_admin`. */
export function isSuperAdminPortalRole(role?: string | null): boolean {
  return normalizeAppRole(role) === "super_admin";
}

/** Shared login at `/login` — all roles except super_admin. */
export function isLoginPortalRole(role?: string | null): boolean {
  return !isSuperAdminPortalRole(role);
}

export function getPostLoginPath(role?: string | null): string {
  const n = normalizeAppRole(role);
  if (n === "super_admin") return "/";
  if (n === "marketing") return "/marketing/dashboard";
  if (n === "hr") return "/hr/dashboard";
  return "/";
}

/** HR module still reads hr_token / hr_user — mirror main auth session after login. */
export function syncHrLocalSession(user: Record<string, unknown> | null | undefined): void {
  if (!user || normalizeAppRole(String(user.role ?? "")) !== "hr") return;
  const token = api.auth.getToken();
  if (!token) return;
  localStorage.setItem("hr_token", token);
  localStorage.setItem("hr_user", JSON.stringify(user));
}

/** Marketing members table can upgrade legacy aliases to marketing dashboard. */
export async function resolveMarketingLoginUser(
  storedUser: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  if (!storedUser?.email) return storedUser;
  const n = normalizeAppRole(String(storedUser.role ?? ""));
  if (n === "marketing") return storedUser;
  try {
    const membersRes = await api.marketing.members();
    const rows = Array.isArray(membersRes) ? membersRes : (membersRes?.data || membersRes?.members || []);
    const email = String(storedUser.email).trim().toLowerCase();
    const found = rows.some((m: { email?: string }) => String(m?.email || "").trim().toLowerCase() === email);
    if (found) {
      const upgraded = { ...storedUser, role: "marketing" };
      localStorage.setItem("auth_user", JSON.stringify(upgraded));
      return upgraded;
    }
  } catch {
    /* ignore */
  }
  return storedUser;
}
