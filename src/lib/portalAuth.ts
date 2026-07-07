/** Canonical browser paths for each login portal (no query string). */
export const AUTH_PORTAL = {
  login: "/login",
  /** @deprecated Use `login` — kept for redirects from old URLs */
  salesRep: "/login",
  /** @deprecated Org admins now use `/login` */
  admin: "/login",
  /** @deprecated Use `login` */
  manager: "/login",
  /** @deprecated Use `login` */
  marketing: "/login",
  superAdmin: "/super_admin",
} as const;

/** SessionStorage key used on 401 — values: login | superadmin */
export type AuthPortalSession = "login" | "superadmin";

export function loginPathFromSessionPortal(portal: string | null | undefined): string {
  if (portal === "superadmin") {
    return AUTH_PORTAL.superAdmin;
  }
  return AUTH_PORTAL.login;
}

/**
 * Maps dedicated portal pathnames to internal portal keys.
 * Returns null for `/login` and legacy routes (handled via redirects).
 */
export function pathnameToAuthRoleParam(pathname: string): string | null {
  if (pathname === AUTH_PORTAL.superAdmin) return "superadmin";
  return null;
}

/**
 * Where to send the user when a protected route needs login again.
 */
export function getPortalLoginRedirect(pathname: string, _search = ""): string {
  if (
    pathname === "/superadmin" ||
    pathname === "/super-admin" ||
    pathname.startsWith("/org-crm") ||
    pathname === "/organizations" ||
    pathname === "/certificates"
  ) {
    return AUTH_PORTAL.superAdmin;
  }
  return AUTH_PORTAL.login;
}
