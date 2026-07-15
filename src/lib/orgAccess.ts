/**
 * Platform vs tenant access for gated HR / finance modules.
 */

import {
  FEATURE_FRESHER_SALARY,
  FEATURE_OFFER_LETTERS,
  FEATURE_CERTIFICATES,
  FEATURE_PAYSLIP,
  isOrgFeatureEnabled,
} from "./orgFeatures";
import { normalizeAppRole } from "./roleUtils";

export type OrgAccessLite = {
  slug?: string | null;
  features?: Record<string, boolean> | null;
};

export type PageAccess = {
  payments?: boolean;
  offer_letters?: boolean;
};

export {
  FEATURE_OFFER_LETTERS,
  FEATURE_FRESHER_SALARY,
  FEATURE_CERTIFICATES,
  FEATURE_PAYSLIP,
} from "./orgFeatures";

export { isSyncpediaOrganization, isOrgFeatureEnabled, isPathAllowedByOrgFeatures, featureKeyForPath } from "./orgFeatures";

export function normalizePageAccess(raw?: PageAccess | null): Required<PageAccess> {
  return {
    payments: Boolean(raw?.payments),
    offer_letters: Boolean(raw?.offer_letters),
  };
}

/** Offer Letters: admin/super_admin/manager + feature flag; HR when page_access.offer_letters is on. */
export function canAccessOfferLetters(
  role: string | null,
  org: OrgAccessLite | null,
  pageAccess?: PageAccess | null,
): boolean {
  const r = normalizeAppRole(role);
  if (r === "super_admin" || r === "admin" || r === "manager") {
    return isOrgFeatureEnabled(role, org, FEATURE_OFFER_LETTERS);
  }
  if (r === "hr") {
    if (!normalizePageAccess(pageAccess).offer_letters) return false;
    return isOrgFeatureEnabled(role, org, FEATURE_OFFER_LETTERS);
  }
  return false;
}

export function canAccessFresherSalary(role: string | null, org: OrgAccessLite | null): boolean {
  if (role !== "super_admin" && role !== "admin") return false;
  return isOrgFeatureEnabled(role, org, FEATURE_FRESHER_SALARY);
}

export function canAccessCertificates(role: string | null, org: OrgAccessLite | null): boolean {
  if (role === "super_admin" && !org) return true;
  if (role !== "super_admin" && role !== "admin" && role !== "manager") return false;
  return isOrgFeatureEnabled(role, org, FEATURE_CERTIFICATES);
}

export function canAccessPayslip(role: string | null, org: OrgAccessLite | null): boolean {
  if (role !== "super_admin" && role !== "admin" && role !== "org") return false;
  return isOrgFeatureEnabled(role, org, FEATURE_PAYSLIP);
}

/** Payment Records — team summaries; super admin, admin, and managers only. */
export function canAccessPaymentRecords(role: string | null): boolean {
  if (!role) return false;
  return role === "super_admin" || role === "admin" || role === "manager";
}

/**
 * Payment links page:
 * - Admin / org / finance / manager: always
 * - Sales rep: only when page_access.payments is enabled (default OFF)
 */
export function canAccessPaymentsPage(role: string | null, pageAccess?: PageAccess | null): boolean {
  const r = normalizeAppRole(role);
  if (["super_admin", "admin", "org", "finance", "manager"].includes(r)) return true;
  if (r === "sales_representative") return normalizePageAccess(pageAccess).payments;
  return false;
}
