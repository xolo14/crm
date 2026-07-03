export type ParsedFormLeadNotes = {
  formSlug: string | null;
  answers: Record<string, string>;
  attachments: Record<string, string>;
  freeformNotes: string | null;
};

const CONTACT_KEYS = new Set([
  "name",
  "full_name",
  "email",
  "phone",
  "whatsapp",
  "whatsapp_number",
  "mobile",
  "contact_number",
  "tel",
]);

const STANDARD_LEAD_KEYS = new Set([
  ...CONTACT_KEYS,
  "college",
  "company",
  "year_of_study",
  "year",
  "course_interest",
  "specialization",
  "resume",
  "cv",
]);

export function formatFormFieldLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeAnswerValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${formatFormFieldLabel(k)}: ${String(v ?? "")}`)
      .join("; ");
  }
  return String(value);
}

export function formatFormAnswerDisplay(value: string, key: string): string {
  if (!value) return "—";
  const lower = key.toLowerCase();
  if (lower === "resume" || lower === "cv" || lower.includes("resume")) {
    return value.startsWith("/") || value.startsWith("http") ? "File attached" : value;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).join(", ");
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([k, v]) => `${formatFormFieldLabel(k)}: ${String(v ?? "")}`)
        .join("; ");
    }
  } catch {
    /* plain text */
  }
  return value;
}

export function parseFormLeadNotes(notes: string | null | undefined): ParsedFormLeadNotes {
  const empty: ParsedFormLeadNotes = {
    formSlug: null,
    answers: {},
    attachments: {},
    freeformNotes: null,
  };
  if (!notes?.trim()) return empty;

  let formSlug: string | null = null;
  const answers: Record<string, string> = {};
  const attachments: Record<string, string> = {};
  const freeform: string[] = [];

  for (const line of notes.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const formMatch = trimmed.match(/^Form:\s*(.+)$/i);
    if (formMatch) {
      formSlug = formMatch[1].trim();
      continue;
    }

    const answersMatch = trimmed.match(/^Answers:\s*(.+)$/i);
    if (answersMatch) {
      try {
        const obj = JSON.parse(answersMatch[1]) as Record<string, unknown>;
        if (obj && typeof obj === "object") {
          for (const [k, v] of Object.entries(obj)) {
            const normalized = normalizeAnswerValue(v);
            if (normalized !== "") answers[k] = normalized;
          }
        }
      } catch {
        /* ignore malformed JSON */
      }
      continue;
    }

    const attachmentsMatch = trimmed.match(/^Attachments:\s*(.+)$/i);
    if (attachmentsMatch) {
      try {
        const obj = JSON.parse(attachmentsMatch[1]) as Record<string, unknown>;
        if (obj && typeof obj === "object") {
          for (const [k, v] of Object.entries(obj)) {
            if (typeof v === "string" && v.trim() !== "") attachments[k] = v.trim();
          }
        }
      } catch {
        /* ignore */
      }
      continue;
    }

    if (!/^Form:/i.test(trimmed) && !/^Answers:/i.test(trimmed) && !/^Attachments:/i.test(trimmed)) {
      freeform.push(trimmed);
    }
  }

  return {
    formSlug,
    answers,
    attachments,
    freeformNotes: freeform.length > 0 ? freeform.join("\n") : null,
  };
}

export function listExtraFormFields(
  parsed: ParsedFormLeadNotes,
  opts?: { resumePath?: string | null; skipKeys?: Iterable<string> },
): { key: string; label: string; value: string }[] {
  const skip = new Set(STANDARD_LEAD_KEYS);
  if (opts?.skipKeys) {
    for (const k of opts.skipKeys) skip.add(k.toLowerCase());
  }

  const out: { key: string; label: string; value: string }[] = [];
  for (const [key, value] of Object.entries(parsed.answers)) {
    const lower = key.toLowerCase();
    if (skip.has(lower)) continue;
    if (!value?.trim()) continue;
    out.push({
      key,
      label: formatFormFieldLabel(key),
      value: formatAnswerDisplay(value, key),
    });
  }
  return out;
}

function formatAnswerDisplay(value: string, key: string): string {
  return formatFormAnswerDisplay(value, key);
}

/** True when notes look like structured form submission data (hide raw blob). */
export function isStructuredFormNotes(notes: string | null | undefined): boolean {
  if (!notes?.trim()) return false;
  return /^Form:/im.test(notes) || /^Answers:/im.test(notes) || /^Attachments:/im.test(notes);
}

export function resolveLeadPhone(
  phone?: string | null,
  answers?: Record<string, string>,
): string | null {
  const direct = (phone || "").trim();
  if (direct && direct !== "0000000000") return direct;
  if (!answers) return direct || null;
  for (const key of ["phone", "whatsapp_number", "whatsapp", "mobile", "contact_number"]) {
    const v = (answers[key] || "").trim();
    if (v) return v;
  }
  return direct || null;
}

export function resolveLeadEmail(email?: string | null, answers?: Record<string, string>): string | null {
  const direct = (email || "").trim();
  if (direct) return direct;
  return (answers?.email || "").trim() || null;
}
