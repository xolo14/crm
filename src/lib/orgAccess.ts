/**
 * Platform vs tenant access for HR modules that default to Syncpedia-only.
 * Other organizations enable via Super Admin → Portals & Access when creating/editing features.
 */

export const FEATURE_OFFER_LETTERS = "offer_letters";
export const FEATURE_FRESHER_SALARY = "fresher_salary";

export type OrgAccessLite = {
  slug?: string | null;
  features?: Record<string, boolean> | null;
};

export function isSyncpediaOrganization(org: OrgAccessLite | null): boolean {
  return String(org?.slug ?? "")
    .toLowerCase()
    .trim() === "syncpedia";
}

/** Offer Letters + Fresher Salary: only super_admin / admin; Syncpedia org always; else org feature flag. */
export function canAccessOfferLetters(role: string | null, org: OrgAccessLite | null): boolean {
  if (role !== "super_admin" && role !== "admin") return false;
  if (!org && role === "super_admin") return true;
  if (isSyncpediaOrganization(org)) return true;
  return org?.features?.[FEATURE_OFFER_LETTERS] === true;
}

export function canAccessFresherSalary(role: string | null, org: OrgAccessLite | null): boolean {
  if (role !== "super_admin" && role !== "admin") return false;
  if (!org && role === "super_admin") return true;
  if (isSyncpediaOrganization(org)) return true;
  return org?.features?.[FEATURE_FRESHER_SALARY] === true;
}
