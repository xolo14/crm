/**
 * Platform vs tenant access for gated HR / finance modules.
 */

import {
  FEATURE_FORM_MANAGEMENT,
  FEATURE_FRESHER_SALARY,
  FEATURE_MARKETING,
  FEATURE_OFFER_LETTERS,
  FEATURE_CERTIFICATES,
  FEATURE_PAYSLIP,
  isOrgFeatureEnabled,
} from "./orgFeatures";
import { normalizeAppRole } from "./roleUtils";
import {
  operationalManagerHasPageAccess,
} from "./managerPageAccess";

export type OrgAccessLite = {
  slug?: string | null;
  features?: Record<string, boolean> | null;
};

export type PageAccess = {
  payments?: boolean;
  offer_letters?: boolean;
  /** Manager / HR page toggles (feature keys). Empty/absent = unrestricted legacy access. */
  pages?: Record<string, boolean>;
};

export {
  FEATURE_OFFER_LETTERS,
  FEATURE_FRESHER_SALARY,
  FEATURE_CERTIFICATES,
  FEATURE_PAYSLIP,
  FEATURE_FORM_MANAGEMENT,
  FEATURE_MARKETING,
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

/** Offer Letters: org/super_admin/manager/operational_manager + feature flag; HR when page_access.offer_letters is on. */
export function canAccessOfferLetters(
  role: string | null,
  org: OrgAccessLite | null,
  pageAccess?: PageAccess | null,
): boolean {
  const r = normalizeAppRole(role);
  if (r === "super_admin" || r === "org") {
    return isOrgFeatureEnabled(role, org, FEATURE_OFFER_LETTERS);
  }
  if (r === "manager" || r === "operational_manager") {
    const allowed =
      r === "operational_manager"
        ? operationalManagerHasPageAccess(pageAccess, FEATURE_OFFER_LETTERS)
        : managerPagesAllow(pageAccess, FEATURE_OFFER_LETTERS);
    if (!allowed) return false;
    return isOrgFeatureEnabled(role, org, FEATURE_OFFER_LETTERS);
  }
  if (r === "hr") {
    const normalized = normalizePageAccess(pageAccess);
    const pages = normalized.pages;
    const fromPages =
      pages && Object.keys(pages).length > 0 && Object.prototype.hasOwnProperty.call(pages, "offer_letters")
        ? pages.offer_letters === true
        : null;
    const allowed = fromPages === null ? normalized.offer_letters : fromPages;
    if (!allowed) return false;
    return isOrgFeatureEnabled(role, org, FEATURE_OFFER_LETTERS);
  }
  return false;
}

/**
 * Form Management: org feature on + role allowed.
 * HR only when admin turns on pages.form_management (never legacy-default-on).
 */
export function canAccessFormManagement(
  role: string | null,
  org: OrgAccessLite | null,
  pageAccess?: PageAccess | null,
): boolean {
  if (!isOrgFeatureEnabled(role, org, FEATURE_FORM_MANAGEMENT)) return false;
  const r = normalizeAppRole(role);
  if (r === "super_admin" || r === "org" || r === "marketing") return true;
  if (r === "manager" || r === "operational_manager") {
    return r === "operational_manager"
      ? operationalManagerHasPageAccess(pageAccess, FEATURE_FORM_MANAGEMENT)
      : managerPagesAllow(pageAccess, FEATURE_FORM_MANAGEMENT);
  }
  if (r === "hr") {
    const pages = normalizePageAccess(pageAccess).pages;
    if (!pages || Object.keys(pages).length === 0) return false;
    return pages.form_management === true;
  }
  return false;
}

/** Marketing portal (email / WhatsApp campaigns): org feature + role / page grant. */
export function canAccessMarketing(
  role: string | null,
  org: OrgAccessLite | null,
  pageAccess?: PageAccess | null,
): boolean {
  if (!isOrgFeatureEnabled(role, org, FEATURE_MARKETING)) return false;
  const r = normalizeAppRole(role);
  if (r === "super_admin" || r === "org" || r === "marketing") return true;
  if (r === "operational_manager") {
    return operationalManagerHasPageAccess(pageAccess, FEATURE_MARKETING);
  }
  if (r === "manager") {
    return managerPagesAllow(pageAccess, FEATURE_MARKETING);
  }
  return false;
}

export function canAccessFresherSalary(role: string | null, org: OrgAccessLite | null, pageAccess?: PageAccess | null): boolean {
  const r = normalizeAppRole(role);
  // Org admins manage roster; enrolled sales reps / managers open their own progress view.
  if (r !== "super_admin" && r !== "org" && r !== "sales_representative" && r !== "manager" && r !== "operational_manager") {
    return false;
  }
  if (r === "manager" && !managerPagesAllow(pageAccess, FEATURE_FRESHER_SALARY)) return false;
  if (r === "operational_manager" && !operationalManagerHasPageAccess(pageAccess, FEATURE_FRESHER_SALARY)) return false;
  return isOrgFeatureEnabled(role, org, FEATURE_FRESHER_SALARY);
}

/** Full roster / add members / policy — org admins only (not sales reps). */
export function canManageFresherSalaryRoster(role: string | null): boolean {
  const r = normalizeAppRole(role);
  return r === "super_admin" || r === "org";
}

/** Edit org-wide fresher policy numbers + manual achieved overrides. */
export function canEditFresherSalaryPolicy(role: string | null): boolean {
  return canManageFresherSalaryRoster(role);
}

export function canAccessCertificates(role: string | null, org: OrgAccessLite | null, pageAccess?: PageAccess | null): boolean {
  if (role === "super_admin" && !org) return true;
  const r = normalizeAppRole(role);
  if (r !== "super_admin" && r !== "org" && r !== "manager" && r !== "operational_manager") return false;
  if (r === "manager" && !managerPagesAllow(pageAccess, FEATURE_CERTIFICATES)) return false;
  if (r === "operational_manager" && !operationalManagerHasPageAccess(pageAccess, FEATURE_CERTIFICATES)) return false;
  return isOrgFeatureEnabled(role, org, FEATURE_CERTIFICATES);
}

export function canAccessPayslip(role: string | null, org: OrgAccessLite | null, pageAccess?: PageAccess | null): boolean {
	const r = normalizeAppRole(role);
	if (r !== "super_admin" && r !== "org" && r !== "operational_manager") return false;
	if (r === "operational_manager" && !operationalManagerHasPageAccess(pageAccess, "payslip")) return false;
	return isOrgFeatureEnabled(role, org, FEATURE_PAYSLIP);
}
export function canAccessPaymentsPage(role: string | null, pageAccess?: PageAccess | null): boolean {
  const r = normalizeAppRole(role);
  if (["super_admin", "org"].includes(r)) return true;
  if (r === "manager") return managerPagesAllow(pageAccess, "payments");
  if (r === "operational_manager") return operationalManagerHasPageAccess(pageAccess, "payments");
  if (r === "sales_representative") return normalizePageAccess(pageAccess).payments;
  return false;
}

export function canAccessPaymentRecords(role: string | null, pageAccess?: PageAccess | null): boolean {
  if (!role) return false;
  const r = normalizeAppRole(role);
  // Visible to all org members; managers still respect page grants when configured.
  if (r === "super_admin" || r === "org") return true;
  if (r === "operational_manager" || r === "manager") {
    const allowed =
      r === "operational_manager"
        ? operationalManagerHasPageAccess(pageAccess, "payments")
        : managerPagesAllow(pageAccess, "payments");
    return allowed;
  }
  if (r === "sales_representative" || r === "hr" || r === "marketing") {
    return true;
  }
  return false;
}

/** Manual payment entry button — not for super_admin or read-only Operational Manager. */
export function canSubmitManualPayment(role: string | null): boolean {
  if (!role) return false;
  const r = normalizeAppRole(role);
  if (r === "super_admin" || r === "operational_manager") return false;
  return canAccessPaymentRecords(role);
}

/** Approvals tab for manager / org / super_admin / operational_manager. */
export function canApproveManualPayments(role: string | null): boolean {
  const r = normalizeAppRole(role);
  return r === "super_admin" || r === "org" || r === "manager" || r === "operational_manager";
}

/** Team summary table on Payment Records (org/manager/OM). */
export function isPaymentRecordsTeamView(role: string | null): boolean {
  const r = normalizeAppRole(role ?? "");
  return r === "org" || r === "manager" || r === "super_admin" || r === "operational_manager";
}

/** Org-wide candidate list (all reps) on Payment Records — Operational Manager. */
export function isPaymentRecordsOrgCandidatesView(role: string | null): boolean {
  return normalizeAppRole(role ?? "") === "operational_manager";
}

/** Edit pitch on a payment candidate — org/super_admin or owning rep only. */
export function canEditPaymentCandidatePitch(
  role: string | null,
  userId: string | null | undefined,
  ownerUserId: string | null | undefined,
): boolean {
  const r = normalizeAppRole(role);
  if (r === "super_admin" || r === "org") return true;
  const uid = String(userId ?? "").trim();
  const oid = String(ownerUserId ?? "").trim();
  return uid !== "" && oid !== "" && uid === oid;
}
