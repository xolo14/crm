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
  /** Manager page toggles (feature keys). Empty/absent = unrestricted legacy access. */
  pages?: Record<string, boolean>;
};

export {
  FEATURE_OFFER_LETTERS,
  FEATURE_FRESHER_SALARY,
  FEATURE_CERTIFICATES,
  FEATURE_PAYSLIP,
} from "./orgFeatures";

export { isSyncpediaOrganization, isOrgFeatureEnabled, isPathAllowedByOrgFeatures, featureKeyForPath } from "./orgFeatures";

export function normalizePageAccess(raw?: PageAccess | null): Required<Pick<PageAccess, "payments" | "offer_letters">> & {
  pages: Record<string, boolean>;
} {
  const pages =
    raw?.pages && typeof raw.pages === "object" && !Array.isArray(raw.pages)
      ? Object.fromEntries(Object.entries(raw.pages).map(([k, v]) => [k, Boolean(v)]))
      : {};
  return {
    payments: Boolean(raw?.payments),
    offer_letters: Boolean(raw?.offer_letters),
    pages,
  };
}

/** Empty pages map = legacy unrestricted manager access. */
function managerPagesAllow(pageAccess: PageAccess | null | undefined, featureKey: string): boolean {
  const pages = pageAccess?.pages;
  if (!pages || Object.keys(pages).length === 0) return true;
  return pages[featureKey] === true;
}

/** Offer Letters: admin/super_admin/manager + feature flag; HR when page_access.offer_letters is on. */
export function canAccessOfferLetters(
  role: string | null,
  org: OrgAccessLite | null,
  pageAccess?: PageAccess | null,
): boolean {
  const r = normalizeAppRole(role);
  if (r === "super_admin" || r === "admin") {
    return isOrgFeatureEnabled(role, org, FEATURE_OFFER_LETTERS);
  }
  if (r === "manager") {
    if (!managerPagesAllow(pageAccess, FEATURE_OFFER_LETTERS)) return false;
    return isOrgFeatureEnabled(role, org, FEATURE_OFFER_LETTERS);
  }
  if (r === "hr") {
    if (!normalizePageAccess(pageAccess).offer_letters) return false;
    return isOrgFeatureEnabled(role, org, FEATURE_OFFER_LETTERS);
  }
  return false;
}

export function canAccessFresherSalary(role: string | null, org: OrgAccessLite | null, pageAccess?: PageAccess | null): boolean {
  const r = normalizeAppRole(role);
  // Admins manage roster; enrolled sales reps / managers open their own progress view.
  if (r !== "super_admin" && r !== "admin" && r !== "org" && r !== "sales_representative" && r !== "manager") {
    return false;
  }
  if (r === "manager" && !managerPagesAllow(pageAccess, FEATURE_FRESHER_SALARY)) return false;
  return isOrgFeatureEnabled(role, org, FEATURE_FRESHER_SALARY);
}

/** Full roster / add members / policy — org admins only (not sales reps). */
export function canManageFresherSalaryRoster(role: string | null): boolean {
  const r = normalizeAppRole(role);
  return r === "super_admin" || r === "admin" || r === "org";
}

/** Edit org-wide fresher policy numbers + manual achieved overrides. */
export function canEditFresherSalaryPolicy(role: string | null): boolean {
  return canManageFresherSalaryRoster(role);
}

export function canAccessCertificates(role: string | null, org: OrgAccessLite | null, pageAccess?: PageAccess | null): boolean {
  if (role === "super_admin" && !org) return true;
  const r = normalizeAppRole(role);
  if (r !== "super_admin" && r !== "admin" && r !== "manager") return false;
  if (r === "manager" && !managerPagesAllow(pageAccess, FEATURE_CERTIFICATES)) return false;
  return isOrgFeatureEnabled(role, org, FEATURE_CERTIFICATES);
}

export function canAccessPayslip(role: string | null, org: OrgAccessLite | null): boolean {
  if (role !== "super_admin" && role !== "admin" && role !== "org") return false;
  return isOrgFeatureEnabled(role, org, FEATURE_PAYSLIP);
}

export function canAccessPaymentsPage(role: string | null, pageAccess?: PageAccess | null): boolean {
  const r = normalizeAppRole(role);
  if (["super_admin", "admin", "org", "finance"].includes(r)) return true;
  if (r === "manager") return managerPagesAllow(pageAccess, "payments");
  if (r === "sales_representative") return normalizePageAccess(pageAccess).payments;
  return false;
}

export function canAccessPaymentRecords(role: string | null, pageAccess?: PageAccess | null): boolean {
  if (!role) return false;
  const r = normalizeAppRole(role);
  // Visible to all org members; managers still respect page grants when configured.
  if (r === "super_admin" || r === "admin" || r === "org") return true;
  if (r === "manager") return managerPagesAllow(pageAccess, "payments");
  if (
    r === "sales_representative" ||
    r === "finance" ||
    r === "hr" ||
    r === "marketing" ||
    r === "trainer"
  ) {
    return true;
  }
  return false;
}

/** Manual payment entry button — not for super_admin. */
export function canSubmitManualPayment(role: string | null): boolean {
  if (!role) return false;
  const r = normalizeAppRole(role);
  return r !== "super_admin" && canAccessPaymentRecords(role);
}

/** Approvals tab for manager / admin / org / super_admin. */
export function canApproveManualPayments(role: string | null): boolean {
  const r = normalizeAppRole(role);
  return r === "super_admin" || r === "admin" || r === "org" || r === "manager";
}
