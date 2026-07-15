/** Public legal page URLs (use in Meta App Dashboard, footers, etc.). */

export const LEGAL_SITE_NAME = "Syncpedia Technologies";

export function legalPageOrigin(): string {
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  return "https://crm.syncpedia.in";
}

export const PRIVACY_POLICY_PATH = "/privacy";
export const TERMS_OF_SERVICE_PATH = "/terms";

export function privacyPolicyUrl(): string {
  return `${legalPageOrigin()}${PRIVACY_POLICY_PATH}`;
}

export function termsOfServiceUrl(): string {
  return `${legalPageOrigin()}${TERMS_OF_SERVICE_PATH}`;
}
