/** Canonical browser paths for each login portal (no query string). */
export const AUTH_PORTAL = {
  login: "/login",
  /** @deprecated Use `login` — kept for redirects from old URLs */
  salesRep: "/login",
  admin: "/admin",
  /** @deprecated Use `login` */
  manager: "/login",
  /** @deprecated Use `login` */
  marketing: "/login",
  superAdmin: "/super_admin",
} as const;

/** SessionStorage key used on 401 — values: login | admin | superadmin */
export type AuthPortalSession = "login" | "admin" | "superadmin";

export function loginPathFromSessionPortal(portal: string | null | undefined): string {
  switch (portal) {
    case "superadmin":
      return AUTH_PORTAL.superAdmin;
    case "admin":
    case "organisation":
      return AUTH_PORTAL.admin;
    default:
      return AUTH_PORTAL.login;
  }
}

/**
 * Maps dedicated portal pathnames to internal portal keys.
 * Returns null for `/login` and legacy routes (handled via redirects).
 */
export function pathnameToAuthRoleParam(pathname: string): string | null {
  if (pathname === AUTH_PORTAL.admin) return "admin";
  if (pathname === "/organisation") return "admin";
  if (pathname === AUTH_PORTAL.superAdmin) return "superadmin";
  return null;
}

/**
 * Where to send the user when a protected route needs login again.
 */
export function getPortalLoginRedirect(pathname: string, _search = ""): string {
  if (pathname === "/auth" || pathname.endsWith("/auth")) {
    return AUTH_PORTAL.login;
  }
  if (pathname === "/organisation" || pathname.startsWith("/organisation")) {
    return AUTH_PORTAL.admin;
  }
  if (
    pathname === "/superadmin" ||
    pathname === "/super-admin" ||
    pathname.startsWith("/org-crm") ||
    pathname === "/organizations" ||
    pathname === "/certificates"
  ) {
    return AUTH_PORTAL.superAdmin;
  }
  if (pathname === "/marketing-admin") {
    return AUTH_PORTAL.admin;
  }
  const adminMarketingPrefixes = [
    "/marketing/analytics",
    "/marketing/whatsapp-analytics",
    "/marketing/form-leads",
    "/marketing/imported-leads",
  ];
  if (adminMarketingPrefixes.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return AUTH_PORTAL.admin;
  }
  if (pathname.startsWith("/hr")) {
    return AUTH_PORTAL.login;
  }
  return AUTH_PORTAL.login;
}
