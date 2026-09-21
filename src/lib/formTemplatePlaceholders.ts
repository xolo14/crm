/**
 * Match certificate / offer-letter template placeholders to lead-form fields.
 * Unmatched placeholders keep a template prefill instead of being wiped.
 */

import { questionFieldKey, type BuilderQuestion } from "@/components/forms/formBuilderTypes";

export const KEEP_TEMPLATE_PREFILL = "__prefill__";

export type FormFieldOption = {
  id: string;
  key: string;
  label: string;
  type?: string;
};

export type TemplatePlaceholder = {
  key: string;
  token: string;
  label: string;
  auto?: boolean;
  prefill?: string;
};

export type PlaceholderMapping = {
  key: string;
  /** Empty / KEEP_TEMPLATE_PREFILL = keep template text or the prefill value. */
  field_key: string;
  prefill: string;
};

export type PlaceholderMapState = {
  template_id: string;
  mappings: PlaceholderMapping[];
};

export const EMPTY_PLACEHOLDER_MAP: PlaceholderMapState = { template_id: "", mappings: [] };

const ALIAS_GROUPS: Record<string, string[]> = {
  name: ["name", "full_name", "full name", "recipient_name", "candidate_name", "student_name"],
  email: ["email", "email_address", "e_mail", "recipient_email"],
  phone: ["phone", "mobile", "whatsapp", "phone_number", "whatsapp_number"],
  course: [
    "course",
    "domain",
    "program",
    "course_interest",
    "specialization",
    "domain_name",
    "course_name",
    "internship",
  ],
  start: [
    "start",
    "start_date",
    "from",
    "from_date",
    "joining_date",
    "internship_start",
    "internship_start_date",
    "begin",
    "commencing",
    "date_from",
  ],
  end: [
    "end",
    "end_date",
    "to",
    "until",
    "completion_date",
    "internship_end",
    "internship_end_date",
    "finishing",
    "date_to",
    "to_date",
  ],
  company: ["company", "company_name", "organization", "organisation", "org"],
  date: ["date", "issue_date", "issued_on", "issue date"],
  cert_id: ["cert_id", "certid", "certificate_id", "sync_id"],
  college: ["college", "institution", "university"],
  role_title: ["role", "role_title", "title", "designation", "position"],
  department: ["department", "dept"],
  salary: ["salary", "ctc", "compensation"],
  work_location: ["work_location", "location", "city"],
};

function normalizeKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function placeholderGroup(raw: string): string {
  const n = normalizeKey(raw);
  if (!n) return "";
  if (ALIAS_GROUPS[n]) return n;
  for (const [group, aliases] of Object.entries(ALIAS_GROUPS)) {
    if (aliases.includes(n) || aliases.includes(raw.trim().toLowerCase())) return group;
  }
  return n;
}

export function coerceTemplatePlaceholders(raw: unknown): TemplatePlaceholder[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplatePlaceholder[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const rawKey = String(rec.key || rec.token || rec.label || "");
    const key = placeholderGroup(rawKey) || normalizeKey(rawKey);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const token = String(rec.token || "").trim() || `<<${key}>>`;
    out.push({
      key,
      token,
      label: String(rec.label || "").trim() || key.replace(/_/g, " "),
      auto: Boolean(rec.auto),
      prefill: String(rec.prefill ?? ""),
    });
  }
  return out;
}

export function parsePlaceholderMap(raw: unknown): PlaceholderMapState {
  if (!raw) return { template_id: "", mappings: [] };
  if (Array.isArray(raw)) {
    return { template_id: "", mappings: normalizeMappings(raw) };
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      template_id: String(obj.template_id || ""),
      mappings: normalizeMappings(obj.mappings),
    };
  }
  return { template_id: "", mappings: [] };
}

function normalizeMappings(raw: unknown): PlaceholderMapping[] {
  if (!Array.isArray(raw)) return [];
  const out: PlaceholderMapping[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const key = normalizeKey(String(rec.key || ""));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const fieldKey = String(rec.field_key || "").trim();
    out.push({
      key,
      field_key: fieldKey === KEEP_TEMPLATE_PREFILL ? "" : fieldKey,
      prefill: String(rec.prefill ?? ""),
    });
  }
  return out;
}

export function placeholderMapsEqual(a: PlaceholderMapping[], b: PlaceholderMapping[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (row, i) =>
      row.key === b[i].key && row.field_key === b[i].field_key && row.prefill === b[i].prefill,
  );
}

function usableTemplatePrefill(raw: string): string {
  const t = String(raw || "").trim();
  if (!t) return "";
  if (t.length > 80) return "";
  if (/<<|\{\{/.test(t)) return "";
  if (/\bsuccessfully\b/i.test(t) || /\binternship in\b/i.test(t)) return "";
  return t;
}

function matchField(ph: TemplatePlaceholder, fields: FormFieldOption[]): FormFieldOption | null {
  const pg = placeholderGroup(ph.key) || placeholderGroup(ph.label);
  let best: FormFieldOption | null = null;
  let bestScore = 0;
  for (const field of fields) {
    const fg = placeholderGroup(field.key) || placeholderGroup(field.label);
    const type = String(field.type || "");
    const blob = `${field.label} ${field.key}`;
    let score = 0;
    if (normalizeKey(field.key) === normalizeKey(ph.key)) score = 100;
    else if (normalizeKey(field.label) === normalizeKey(ph.label) || normalizeKey(field.label) === normalizeKey(ph.key))
      score = 90;
    else if (pg && fg && pg === fg) score = 80;
    else if (type === "date" && pg === "start" && /start|from|begin|join|commenc/i.test(blob)) score = 85;
    else if (type === "date" && pg === "end" && /end|to|until|complet|finish/i.test(blob)) score = 85;
    else if (normalizeKey(field.label).includes(normalizeKey(ph.key)) && normalizeKey(ph.key).length >= 4) score = 40;
    if (score > bestScore) {
      bestScore = score;
      best = field;
    }
  }
  return bestScore >= 80 ? best : null;
}

export function mergePlaceholderMappings(
  placeholders: TemplatePlaceholder[],
  fields: FormFieldOption[],
  previous: PlaceholderMapping[] | undefined,
  defaults?: { course?: string; company?: string },
): PlaceholderMapping[] {
  const prevByKey = new Map((previous || []).map((m) => [m.key, m]));
  const used = new Set<string>();
  const out: PlaceholderMapping[] = [];

  for (const ph of placeholders) {
    const prev = prevByKey.get(ph.key);
    const keptField =
      prev?.field_key && fields.some((f) => f.key === prev.field_key) ? prev.field_key : "";
    if (keptField) used.add(keptField);
    let prefill = usableTemplatePrefill(prev ? prev.prefill : ph.prefill || "");
    if (prev === undefined && !prefill && defaults) {
      const g = placeholderGroup(ph.key);
      if (g === "course") prefill = usableTemplatePrefill(defaults.course || "");
      if (g === "company") prefill = usableTemplatePrefill(defaults.company || "");
    }
    out.push({
      key: ph.key,
      field_key: ph.auto && (ph.key === "cert_id" || ph.key === "certid") ? "" : keptField,
      prefill,
    });
  }

  for (const row of out) {
    if (row.field_key) continue;
    if (prevByKey.has(row.key)) continue;
    const ph = placeholders.find((p) => p.key === row.key);
    if (!ph) continue;
    if (ph.auto && (ph.key === "cert_id" || ph.key === "certid")) continue;
    const match = matchField(
      ph,
      fields.filter((f) => !used.has(f.key)),
    );
    if (match) {
      row.field_key = match.key;
      used.add(match.key);
    }
  }

  return out;
}

export function formFieldsFromQuestions(
  questions: Array<{
    id?: string;
    type?: string;
    title?: string;
    validation?: { kind?: string; value?: string };
  }>,
): FormFieldOption[] {
  return questions.flatMap((q, i) => {
    const type = String(q.type || "");
    if (type === "section_break" || type === "image" || type === "video") return [];
    const key = questionFieldKey(
      {
        id: String(q.id || `q-${i}`),
        type: (type || "short_answer") as BuilderQuestion["type"],
        title: String(q.title || ""),
        required: false,
        validation: q.validation as BuilderQuestion["validation"],
      },
      i,
    );
    return [
      {
        id: String(q.id || `q-${i}`),
        key,
        label: String(q.title || "").trim() || `Question ${i + 1}`,
        type,
      },
    ];
  });
}

export function serializePlaceholderMap(
  templateId: string,
  mappings: PlaceholderMapping[],
): PlaceholderMapState {
  return {
    template_id: templateId,
    mappings: mappings.map((m) => ({
      key: m.key,
      field_key: m.field_key,
      prefill: m.prefill,
    })),
  };
}

export function countMatchedPlaceholders(
  placeholders: TemplatePlaceholder[],
  mappings: PlaceholderMapping[],
  fields: FormFieldOption[],
): { matched: number; total: number } {
  const fillable = placeholders.filter(
    (ph) => !(ph.auto && (ph.key === "cert_id" || ph.key === "certid" || ph.key === "ref_number")),
  );
  const matched = fillable.filter((ph) => {
    const row = mappings.find((m) => m.key === ph.key);
    return !!row?.field_key && fields.some((f) => f.key === row.field_key);
  }).length;
  return { matched, total: fillable.length };
}
