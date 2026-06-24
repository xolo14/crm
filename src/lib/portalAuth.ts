/** Canonical browser paths for each login portal (no query string). */
export const AUTH_PORTAL = {
  salesRep: '/sales_rep_portal',
  admin: '/admin',
  manager: '/manager',
  marketing: '/marketing',
  superAdmin: '/super_admin',
} as const;

/** SessionStorage key used on 401 — values: rep | admin | manager | marketing | superadmin */
export type AuthPortalSession = 'rep' | 'admin' | 'manager' | 'marketing' | 'superadmin';

export function loginPathFromSessionPortal(portal: string | null | undefined): string {
  switch (portal) {
    case 'superadmin':
      return AUTH_PORTAL.superAdmin;
    case 'admin':
    case 'organisation':
      return AUTH_PORTAL.admin;
    case 'manager':
      return AUTH_PORTAL.manager;
    case 'marketing':
      return AUTH_PORTAL.marketing;
    default:
      return AUTH_PORTAL.salesRep;
  }
}

/**
 * Maps current pathname to Auth `role` search param value (empty = sales rep).
 * Returns null if path is not a dedicated portal route (e.g. `/auth` uses query only).
 */
export function pathnameToAuthRoleParam(pathname: string): string | null {
  if (pathname === AUTH_PORTAL.admin) return 'admin';
  if (pathname === '/organisation') return 'admin';
  if (pathname === AUTH_PORTAL.manager) return 'manager';
  if (pathname === AUTH_PORTAL.marketing) return 'marketing';
  if (pathname === AUTH_PORTAL.superAdmin) return 'superadmin';
  if (pathname === AUTH_PORTAL.salesRep) return '';
  return null;
}

/**
 * Where to send the user when a protected route needs login again.
 * Must not return the same path as an unauthenticated app route (avoid redirect loops).
 */
export function getPortalLoginRedirect(pathname: string, search = ''): string {
  if (pathname === '/auth' || pathname.endsWith('/auth')) {
    return search ? `/auth${search}` : '/auth';
  }
  if (pathname.startsWith('/organisation')) {
    return AUTH_PORTAL.admin;
  }
  if (pathname === '/superadmin' || pathname === '/super-admin' || pathname.startsWith('/org-crm')) {
    return AUTH_PORTAL.superAdmin;
  }
  if (pathname === '/organizations') {
    return AUTH_PORTAL.superAdmin;
  }
  if (pathname === '/marketing-admin') {
    return AUTH_PORTAL.admin;
  }
  const adminMarketingPrefixes = ['/marketing/analytics', '/marketing/whatsapp-analytics', '/marketing/form-leads', '/marketing/imported-leads'];
  if (adminMarketingPrefixes.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return AUTH_PORTAL.admin;
  }
  if (pathname.startsWith('/marketing')) {
    return AUTH_PORTAL.marketing;
  }
  if (pathname === '/sales-rep') {
    return AUTH_PORTAL.salesRep;
  }
  return AUTH_PORTAL.salesRep;
}
