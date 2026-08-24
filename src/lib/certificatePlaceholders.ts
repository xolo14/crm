/**
 * Certificate bulk/issue helpers: columns = placeholders actually present on the template.
 */

import { applyPlaceholders, extractPlaceholderKeys } from "@/modules/docForms/types";

/** Auto-filled at issue time — never shown as manual bulk columns. */
export const CERT_AUTO_PLACEHOLDER_KEYS = new Set([
  "certID",
  "cert_id",
  "date", // typed date layer uses issue_date when issuing
]);

/** Typed layer → bulk/sheet column key. */
export const CERT_LAYER_TO_COLUMN: Record<string, string> = {
  name: "recipient_name",
  domain: "domain_name",
  date: "issue_date",
  company: "company_name",
};

export const CERT_COLUMN_LABELS: Record<string, string> = {
  recipient_name: "Recipient name",
  recipient_email: "Recipient email",
  candidate_name: "Recipient name",
  domain_name: "Course / Domain",
  course_name: "Course / Domain",
  issue_date: "Issue date",
  company_name: "Company",
  name: "Recipient name",
  domain: "Course / Domain",
  email: "Recipient email",
};

export function certPlaceholderLabel(key: string): string {
  if (CERT_COLUMN_LABELS[key]) return CERT_COLUMN_LABELS[key];
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Map <<Name>> / Date / certID tokens onto the issue-form keys. */
export function canonicalCertPlaceholderKey(raw: string): string {
  const compact = String(raw || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const lower = compact.toLowerCase();
  const aliases: Record<string, string> = {
    name: "recipient_name",
    recipient_name: "recipient_name",
    candidate_name: "recipient_name",
    date: "issue_date",
    issue_date: "issue_date",
    domain: "domain_name",
    course: "domain_name",
    course_name: "domain_name",
    domain_name: "domain_name",
    company: "company_name",
    company_name: "company_name",
    certid: "cert_id",
    cert_id: "cert_id",
    certificate_id: "cert_id",
    sync_id: "cert_id",
    email: "recipient_email",
    recipient_email: "recipient_email",
  };
  return aliases[lower] || lower || compact;
}

export function lookupCertPlaceholderValue(raw: string, values: Record<string, string>): string | undefined {
  const token = String(raw || "").trim();
  if (!token) return undefined;
  const canonical = canonicalCertPlaceholderKey(token);
  const keysToTry = [token, canonical, token.replace(/\s+/g, "_"), token.toLowerCase()];
  for (const k of keysToTry) {
    if (!k || !Object.prototype.hasOwnProperty.call(values, k)) continue;
    const v = values[k];
    if (v != null && String(v) !== "") return String(v);
  }
  return undefined;
}

export function layerHasCertPlaceholderTokens(text: string): boolean {
  return /<<\s*[^<>]+?\s*>>/.test(text) || /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(text);
}

/** Replace <<Date>> and {{date}} tokens; leave any surrounding text in place. */
export function applyCertPlaceholders(text: string, values: Record<string, string>): string {
  const withAngle = String(text || "").replace(/<<\s*([^<>]+?)\s*>>/g, (full, raw: string) => {
    const v = lookupCertPlaceholderValue(raw, values);
    return v !== undefined ? v : full;
  });
  const withMustache = withAngle.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, key: string) => {
    const v = lookupCertPlaceholderValue(key, values);
    return v !== undefined ? v : full;
  });
  return applyPlaceholders(withMustache, values);
}

export function extractAnglePlaceholderLabels(...chunks: string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (!chunk) continue;
    const text = String(chunk);
    const re = /<<\s*([^<>]+?)\s*>>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const label = String(m[1] || "").trim();
      if (!label) continue;
      const key = canonicalCertPlaceholderKey(label).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      found.push(label);
    }
  }
  return found;
}

type CertLike = {
  layers?: Array<{ type?: string; content?: string }>;
  fields?: { title?: string; bodyText?: string; companyName?: string; domainName?: string };
  style?: Record<string, unknown>;
};

/**
 * Placeholders used by a certificate template:
 * - typed layers present on the canvas (name/domain/date/company)
 * - {{...}} and <<...>> tokens in layer/field text
 * - mail subject/body/filename if stored on style
 * Always includes recipient_email so certificates can be emailed.
 * Excludes auto cert ID.
 */
export function getCertificateTemplatePlaceholderKeys(template: CertLike | null | undefined): string[] {
  if (!template) return [];
  const layers = Array.isArray(template.layers) ? template.layers : [];
  const fields = template.fields || {};
  const style = (template.style || {}) as Record<string, unknown>;

  const found = new Set<string>();

  for (const layer of layers) {
    const t = String(layer?.type || "");
    if (t === "certID" || t === "qr" || t === "logo" || t === "signature" || t === "image") continue;
    const col = CERT_LAYER_TO_COLUMN[t];
    if (col) found.add(col);
  }

  const tokenChunks = [
    ...layers.map((l) => String(l?.content || "")),
    String(fields.title || ""),
    String(fields.bodyText || ""),
    String(style.mail_subject || ""),
    String(style.mail_body || ""),
    String(style.pdf_filename_pattern || ""),
  ];
  const fromTokens = [
    ...extractPlaceholderKeys(...tokenChunks),
    ...extractAnglePlaceholderLabels(...tokenChunks).map((label) => canonicalCertPlaceholderKey(label)),
  ];

  for (const key of fromTokens) {
    if (CERT_AUTO_PLACEHOLDER_KEYS.has(key)) continue;
    if (key === "name") found.add("recipient_name");
    else if (key === "domain" || key === "course_name") found.add("domain_name");
    else if (key === "company") found.add("company_name");
    else if (key === "email") found.add("recipient_email");
    else found.add(key);
  }

  // Needed to send the certificate email
  found.add("recipient_email");

  // Prefer canonical names
  if (found.has("candidate_name")) {
    found.add("recipient_name");
    found.delete("candidate_name");
  }

  const order = [
    "recipient_name",
    "recipient_email",
    "domain_name",
    "issue_date",
    "company_name",
  ];
  const ordered: string[] = [];
  for (const k of order) {
    if (found.has(k)) {
      ordered.push(k);
      found.delete(k);
    }
  }
  return [...ordered, ...[...found].sort()];
}

/** Keys the user fills per recipient (exclude shared issue_date / company if you split them). */
export function getCertificateBulkRowKeys(keys: string[]): string[] {
  return keys.filter((k) => k !== "issue_date" && k !== "company_name" && !CERT_AUTO_PLACEHOLDER_KEYS.has(k));
}

export function getCertificateSharedKeys(keys: string[]): string[] {
  return keys.filter((k) => k === "issue_date" || k === "company_name");
}
