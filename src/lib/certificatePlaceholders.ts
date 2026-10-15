/**
 * Certificate bulk/issue helpers: columns = placeholders actually present on the template.
 */

import { applyPlaceholders, extractPlaceholderKeys } from "@/modules/docForms/types";

/** Auto-filled at issue time — never shown as manual bulk columns. */
export const CERT_AUTO_PLACEHOLDER_KEYS = new Set([
  "certID",
  "cert_id",
  "sync_id",
  "date", // <<Date>> / {{date}} — issue form has its own date control
  "issue_date",
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
    start: "start",
    start_date: "start",
    from: "start",
    end: "end",
    end_date: "end",
    to: "end",
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
    date: "issue_date",
  };
  return aliases[lower] || lower || compact;
}

/** True when sample text is certificate wording with merge tokens, not a real course/domain value. */
export function certSampleTextHasPlaceholderTokens(text: string): boolean {
  return layerHasCertPlaceholderTokens(String(text || ""));
}

function isAutoCertIssueKey(key: string): boolean {
  const canon = canonicalCertPlaceholderKey(key);
  if (CERT_AUTO_PLACEHOLDER_KEYS.has(canon)) return true;
  if (canon === "cert_id" || canon === "sync_id") return true;
  return false;
}

function addCanonicalIssuePlaceholderKey(found: Set<string>, rawKey: string): void {
  const canon = canonicalCertPlaceholderKey(rawKey);
  if (!canon || isAutoCertIssueKey(canon)) return;
  if (canon === "recipient_name") found.add("recipient_name");
  else if (canon === "recipient_email") found.add("recipient_email");
  else if (canon === "domain_name") found.add("domain_name");
  else if (canon === "company_name") found.add("company_name");
  else found.add(canon);
}

export function lookupCertPlaceholderValue(raw: string, values: Record<string, string>): string | undefined {
  const token = String(raw || "").trim();
  if (!token) return undefined;
  const canonical = canonicalCertPlaceholderKey(token);
  const direct = values[canonical];
  if (direct != null && String(direct).trim() !== "") return String(direct);
  const keysToTry = new Set<string>([
    token,
    canonical,
    token.replace(/\s+/g, "_"),
    token.toLowerCase(),
  ]);
  for (const k of Object.keys(values)) {
    if (canonicalCertPlaceholderKey(k) === canonical) keysToTry.add(k);
  }
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
 * - {{...}} and <<...>> tokens in layer/field text (canvas + fields only; not email body)
 * Email is collected on the Email step / bulk send, not as a canvas-required field.
 * Excludes auto cert ID / sync id / issue date tokens.
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
    if (col && !isAutoCertIssueKey(col)) found.add(col);
  }

  const tokenChunks = [
    ...layers.map((l) => String(l?.content || "")),
    String(fields.title || ""),
    String(fields.bodyText || ""),
    String(style.pdf_filename_pattern || ""),
  ];
  const fromTokens = [
    ...extractPlaceholderKeys(...tokenChunks),
    ...extractAnglePlaceholderLabels(...tokenChunks),
  ];

  for (const key of fromTokens) {
    addCanonicalIssuePlaceholderKey(found, key);
  }

  // Email is collected on the Email step / bulk send — not as a canvas-required field.
  found.delete("candidate_name");

  const order = [
    "recipient_name",
    "recipient_email",
    "domain_name",
    "company_name",
    "start",
    "end",
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

/** Sample values for template builder / saved preview (not issue-time). */
export function buildCertTemplatePreviewPlaceholderValues(
  template: CertLike | null | undefined,
  opts?: {
    recipientName?: string;
    domainName?: string;
    companyName?: string;
    issueDate?: string;
    certId?: string;
    start?: string;
    end?: string;
  },
): Record<string, string> {
  const fields = template?.fields || {};
  const domainSample = String(opts?.domainName ?? fields.domainName ?? "").trim();
  const coursePreview = certSampleTextHasPlaceholderTokens(domainSample) ? "Sample Course" : domainSample;
  const issueDate = opts?.issueDate ?? new Date().toISOString().slice(0, 10);
  const certId = opts?.certId ?? "OR-CC-XXXXXX";
  const recipient = String(opts?.recipientName ?? fields.recipientName ?? "Recipient Name").trim();
  const company = String(opts?.companyName ?? fields.companyName ?? "Organization").trim();
  const start = String(opts?.start ?? "01 Jan 2026").trim();
  const end = String(opts?.end ?? "28 Sep 2026").trim();

  return {
    recipient_name: recipient,
    name: recipient,
    recipient_email: "recipient@example.com",
    email: "recipient@example.com",
    domain_name: coursePreview,
    domain: coursePreview,
    course: coursePreview,
    course_name: coursePreview,
    Course: coursePreview,
    company_name: company,
    company: company,
    issue_date: issueDate,
    date: issueDate,
    start,
    Start: start,
    end,
    End: end,
    cert_id: certId,
    certID: certId,
    CertID: certId,
    sync_id: certId,
  };
}

/** Keys the user fills per recipient (exclude shared issue_date / company if you split them). */
export function getCertificateBulkRowKeys(keys: string[]): string[] {
  return keys.filter((k) => k !== "issue_date" && k !== "company_name" && !CERT_AUTO_PLACEHOLDER_KEYS.has(k));
}

export function getCertificateSharedKeys(keys: string[]): string[] {
  return keys.filter((k) => k === "issue_date" || k === "company_name");
}
