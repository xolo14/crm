/** Tokens in marketing email drafts: <<name>>, <<course>>, … */

export function extractAnglePlaceholders(...texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /<<\s*([a-zA-Z0-9_]+)\s*>>/g;
  for (const text of texts) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(String(text || "")))) {
      const key = m[1];
      const lk = key.toLowerCase();
      if (seen.has(lk)) continue;
      seen.add(lk);
      out.push(key);
    }
  }
  return out;
}

export function fillAnglePlaceholders(text: string, values: Record<string, string>): string {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(values || {})) {
    map.set(k.toLowerCase(), String(v ?? ""));
  }
  return String(text || "").replace(/<<\s*([a-zA-Z0-9_]+)\s*>>/g, (_, key: string) => {
    const found = map.get(String(key).toLowerCase());
    return found !== undefined ? found : `<<${key}>>`;
  });
}

const LEAD_FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "full_name", "candidate_name", "recipient_name", "student_name"],
  email: ["email", "recipient_email", "mail"],
  phone: ["phone", "mobile", "contact"],
  college: ["college", "institution", "university"],
  course: ["course", "course_name", "course_interest", "domain", "domain_name"],
  company: ["company", "organization", "org"],
  source: ["source"],
};

export type PlaceholderPerson = {
  name?: string;
  email?: string;
  phone?: string;
  college?: string;
  course?: string;
  company?: string;
  source?: string;
};

export function autofillPlaceholderValues(
  person: PlaceholderPerson | null | undefined,
  keys: string[],
): Record<string, string> {
  const bag: Record<string, string> = {
    name: String(person?.name || "").trim(),
    email: String(person?.email || "").trim(),
    phone: String(person?.phone || "").trim(),
    college: String(person?.college || "").trim(),
    course: String(person?.course || "").trim(),
    company: String(person?.company || "").trim(),
    source: String(person?.source || "").trim(),
  };
  const out: Record<string, string> = {};
  for (const key of keys) {
    const lk = key.toLowerCase();
    let value = "";
    for (const [field, aliases] of Object.entries(LEAD_FIELD_ALIASES)) {
      if (aliases.includes(lk)) {
        value = bag[field] || "";
        break;
      }
    }
    out[key] = value;
  }
  return out;
}

export function placeholderValuesComplete(
  keys: string[],
  values: Record<string, string>,
): boolean {
  return keys.every((k) => String(values[k] ?? "").trim() !== "");
}
