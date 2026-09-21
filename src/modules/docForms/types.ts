/** Shared types for Certificates & Offer Letters document forms. */

import type { MediaBlockData } from "@/components/forms/MediaBlock";
import type { RatingIcon } from "@/components/forms/StarRating";
import type { GoToTarget } from "@/components/forms/sectionFlow";
import type { ValidationRule } from "@/components/forms/formValidation";

export type DocFormType = "offer_letter" | "certificate";

export type DocFormFieldType =
  | "text"
  | "email"
  | "textarea"
  | "multiple_choice"
  | "checkboxes"
  | "select"
  | "file_upload"
  | "linear_scale"
  | "mc_grid"
  | "checkbox_grid"
  | "date"
  | "time"
  | "number"
  | "section_break"
  | "image"
  | "video"
  | "rating";

export const DOC_FORM_FIELD_TYPE_LABELS: Record<DocFormFieldType, string> = {
  text: "Short answer",
  textarea: "Paragraph",
  multiple_choice: "Multiple choice",
  checkboxes: "Checkboxes",
  select: "Dropdown",
  file_upload: "File upload",
  linear_scale: "Linear scale",
  mc_grid: "Multiple choice grid",
  checkbox_grid: "Checkbox grid",
  date: "Date",
  time: "Time",
  number: "Number",
  section_break: "Section break",
  email: "Email",
  image: "Image",
  video: "Video",
  rating: "Rating",
};

export const DOC_FORM_FIELD_TYPES = Object.keys(DOC_FORM_FIELD_TYPE_LABELS) as DocFormFieldType[];

export function docFormFieldNeedsOptions(type: string): boolean {
  return type === "select" || type === "multiple_choice" || type === "checkboxes";
}

export function docFormFieldIsContent(type: string): boolean {
  return type === "section_break" || type === "image" || type === "video";
}

export function docFormFieldNeedsGrid(type: string): boolean {
  return type === "mc_grid" || type === "checkbox_grid";
}

export type DocFormField = {
  id: string;
  key: string;
  label: string;
  type: DocFormFieldType;
  required?: boolean;
  placeholder?: string;
  /** Longer hint under the label (may contain links). */
  description?: string;
  options?: string[];
  rows?: string[];
  columns?: string[];
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
  includeOther?: boolean;
  shuffleOptions?: boolean;
  goTo?: Record<string, GoToTarget>;
  validation?: ValidationRule;
  media?: MediaBlockData;
  ratingMax?: number;
  ratingIcon?: RatingIcon;
  points?: number;
};

export type DocFormAccessRow = {
  id: string;
  form_id: string;
  access_type: "user" | "role";
  user_id?: string | null;
  role_key?: string | null;
};

export type DocFormColumnMap = {
  id: string;
  label: string;
  placeholder_key: string;
  editable?: boolean;
};

export type DocFormTemplateLink = {
  id: string;
  form_id: string;
  template_kind: DocFormType;
  template_id: string;
  column_maps_json: DocFormColumnMap[];
};

export type DocForm = {
  id: string;
  org_id?: string | null;
  org_name?: string | null;
  name: string;
  slug: string;
  description?: string | null;
  form_type: DocFormType;
  fields_json: DocFormField[];
  /** Presentation / branding (same keys as lead form meta_json). */
  meta_json?: Record<string, unknown> | null;
  is_active: boolean;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at?: string;
  updated_at?: string;
  submission_count?: number;
  template_link?: DocFormTemplateLink | null;
  access?: DocFormAccessRow[];
};

export type DocFormSubmission = {
  id: string;
  form_id: string;
  respondent_name?: string | null;
  respondent_email?: string | null;
  answers_json: Record<string, string>;
  values_json: Record<string, string>;
  status: string;
  referred_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type DocIssuedDocument = {
  id: string;
  doc_kind: DocFormType;
  form_id?: string | null;
  submission_id?: string | null;
  template_id?: string | null;
  recipient_name?: string | null;
  recipient_email?: string | null;
  subject?: string | null;
  pdf_url?: string | null;
  status: string;
  issued_at?: string;
  meta_json?: Record<string, unknown>;
};

export type TemplateMailConfig = {
  mail_subject?: string;
  mail_body?: string;
  recipient_email_placeholder?: string;
  pdf_filename_pattern?: string;
};

const CERT_TOKEN_ALIASES: Record<string, string> = {
  name: "name",
  domain: "domain",
  date: "date",
  company: "company",
  certid: "certID",
  cert_id: "cert_id",
  certificate_id: "certificate_id",
};

export function extractPlaceholderKeys(...chunks: string[]): string[] {
  const found = new Set<string>();
  const reMustache = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const reChevrons = /<<\s*([a-zA-Z0-9_]+)\s*>>/g;
  for (const chunk of chunks) {
    if (!chunk) continue;
    const text = String(chunk);
    let m: RegExpExecArray | null;
    reMustache.lastIndex = 0;
    while ((m = reMustache.exec(text))) found.add(m[1]);
    reChevrons.lastIndex = 0;
    while ((m = reChevrons.exec(text))) {
      const raw = m[1];
      const alias = CERT_TOKEN_ALIASES[raw.toLowerCase()] || raw;
      found.add(alias);
    }
  }
  return [...found];
}

export function applyPlaceholders(text: string, values: Record<string, string>): string {
  const withMustache = text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? "") : `{{${key}}}`,
  );
  return withMustache.replace(/<<\s*([a-zA-Z0-9_]+)\s*>>/g, (_, key: string) => {
    const alias = CERT_TOKEN_ALIASES[String(key).toLowerCase()] || key;
    if (Object.prototype.hasOwnProperty.call(values, alias)) return String(values[alias] ?? "");
    if (Object.prototype.hasOwnProperty.call(values, key)) return String(values[key] ?? "");
    return `<<${key}>>`;
  });
}

/** Placeholder key derived from a question label: "Phone Number" → "phone_number". */
export function docFormKeyFromLabel(label: string): string {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/** Auto-generated keys (field_1, field_2 …) or blanks may be replaced by a label-derived key. */
export function isAutoDocFormKey(key: string): boolean {
  const k = String(key || "").trim();
  return k === "" || /^field_\d+$/.test(k);
}

/** Returns `base` or `base_2`, `base_3` … so it is not in `taken`. */
export function uniqueDocFormKey(base: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken).map((k) => String(k || "").trim()));
  const root = String(base || "").trim() || "field";
  if (!used.has(root)) return root;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${root}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${root}_${Date.now()}`;
}

/**
 * Every field gets a distinct key so answers never overwrite each other.
 * Blank keys are filled from the label; duplicates get a numeric suffix.
 * Returns the list of keys that had to be changed, for surfacing in the UI.
 */
export function ensureUniqueDocFormKeys(fields: DocFormField[]): { fields: DocFormField[]; renamed: Array<{ label: string; from: string; to: string }> } {
  const taken = new Set<string>();
  const renamed: Array<{ label: string; from: string; to: string }> = [];
  const out = fields.map((f, idx) => {
    const original = String(f.key || "").trim();
    let base = original || docFormKeyFromLabel(f.label) || `field_${idx + 1}`;
    if (f.type === "section_break" && !original) base = `section_${idx + 1}`;
    const key = uniqueDocFormKey(base, taken);
    taken.add(key);
    if (key !== original) renamed.push({ label: f.label || key, from: original, to: key });
    return key === f.key ? f : { ...f, key };
  });
  return { fields: out, renamed };
}

/** True when a submitted value should count as "not answered" for a required field. */
export function docFormValueIsEmpty(field: DocFormField, value: string | undefined | null): boolean {
  const raw = String(value ?? "").trim();
  if (raw === "") return true;
  if (field.type === "checkboxes") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.length === 0;
    } catch {
      /* pipe list */
    }
    return raw.split("|").map((s) => s.trim()).filter(Boolean).length === 0;
  }
  if (field.type === "mc_grid" || field.type === "checkbox_grid") {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") return true;
      return !Object.values(parsed).some((v) => (Array.isArray(v) ? v.length > 0 : String(v ?? "").trim() !== ""));
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Human-readable value for storage/templates: checkbox lists become "A, B" and grids
 * become "Row: Col; Row 2: Col" instead of raw JSON showing up in a letter.
 */
export function docFormValueForSubmit(field: DocFormField, value: string | undefined | null): string {
  const raw = String(value ?? "").trim();
  if (raw === "") return "";
  if (field.type === "checkboxes") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean).join(", ");
    } catch {
      /* already a plain string */
    }
    return raw;
  }
  if (field.type === "mc_grid" || field.type === "checkbox_grid") {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        return Object.entries(parsed)
          .map(([row, col]) => {
            const cols = Array.isArray(col) ? col.map(String).filter(Boolean).join(", ") : String(col ?? "").trim();
            return cols ? `${row}: ${cols}` : "";
          })
          .filter(Boolean)
          .join("; ");
      }
    } catch {
      /* already a plain string */
    }
    return raw;
  }
  return raw;
}

export function defaultDocFormFields(formType: DocFormType): DocFormField[] {
  if (formType === "certificate") {
    return [
      { id: crypto.randomUUID(), key: "name", label: "Full name", type: "text", required: true },
      { id: crypto.randomUUID(), key: "email", label: "Email", type: "email", required: true },
      { id: crypto.randomUUID(), key: "domain", label: "Course / Domain", type: "text", required: true },
      { id: crypto.randomUUID(), key: "date", label: "Completion date", type: "date", required: false },
    ];
  }
  return [
    { id: crypto.randomUUID(), key: "candidate_name", label: "Candidate name", type: "text", required: true },
    { id: crypto.randomUUID(), key: "recipient_email", label: "Email", type: "email", required: true },
    { id: crypto.randomUUID(), key: "role_title", label: "Role / Title", type: "text", required: true },
    { id: crypto.randomUUID(), key: "start_date", label: "Joining date", type: "date", required: false },
    { id: crypto.randomUUID(), key: "salary", label: "Salary / CTC", type: "text", required: false },
  ];
}

export const DOC_FORM_ASSIGNABLE_ROLES = [
  { key: "manager", label: "Manager" },
  { key: "hr", label: "HR" },
  { key: "sales_representative", label: "Sales Representative" },
  { key: "marketing", label: "Marketing" },
  { key: "org", label: "Org Admin" },
] as const;
