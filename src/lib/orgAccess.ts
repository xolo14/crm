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

export type OrgAccessLite = {
  slug?: string | null;
  features?: Record<string, boolean> | null;
};

export {
  FEATURE_OFFER_LETTERS,
  FEATURE_FRESHER_SALARY,
  FEATURE_CERTIFICATES,
  FEATURE_PAYSLIP,
} from "./orgFeatures";

export { isSyncpediaOrganization, isOrgFeatureEnabled, isPathAllowedByOrgFeatures, featureKeyForPath } from "./orgFeatures";

/** Offer Letters: admin/super_admin + feature flag (Syncpedia always). */
export function canAccessOfferLetters(role: string | null, org: OrgAccessLite | null): boolean {
  if (role !== "super_admin" && role !== "admin") return false;
  return isOrgFeatureEnabled(role, org, FEATURE_OFFER_LETTERS);
}

export function canAccessFresherSalary(role: string | null, org: OrgAccessLite | null): boolean {
  if (role !== "super_admin" && role !== "admin") return false;
  return isOrgFeatureEnabled(role, org, FEATURE_FRESHER_SALARY);
}

export function canAccessCertificates(role: string | null, org: OrgAccessLite | null): boolean {
  if (role === "super_admin" && !org) return true;
  if (role !== "super_admin" && role !== "admin") return false;
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
