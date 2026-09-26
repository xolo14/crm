/** Tokens in marketing email drafts: <<name>>, <<course>>, … */

function unescapePlaceholderDelimiters(text: string): string {
  let out = String(text || "");
  for (let i = 0; i < 3; i++) {
    const prev = out;
    out = out
      .replace(/&amp;lt;&amp;lt;/gi, "&lt;&lt;")
      .replace(/&amp;gt;&amp;gt;/gi, "&gt;&gt;")
      .replace(/&lt;&lt;/gi, "<<")
      .replace(/&#0*60;&#0*60;/gi, "<<")
      .replace(/&#x0*3c;&#x0*3c;/gi, "<<")
      .replace(/%3C%3C/gi, "<<")
      .replace(/&gt;&gt;/gi, ">>")
      .replace(/&#0*62;&#0*62;/gi, ">>")
      .replace(/&#x0*3e;&#x0*3e;/gi, ">>")
      .replace(/%3E%3E/gi, ">>")
      .replace(/&lt;</gi, "<<")
      .replace(/>&gt;/gi, ">>");
    if (out === prev) break;
  }
  return out.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/[＜＞]/g, (ch) => (ch === "＜" ? "<" : ">"));
}

function placeholderKeyFromInner(inner: string): string | null {
  const key = String(inner || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .trim();
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(key) ? key : null;
}

export function extractAnglePlaceholders(...texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /<<((?:(?!>>).)*)>>/gs;
  for (const text of texts) {
    re.lastIndex = 0;
    const scan = unescapePlaceholderDelimiters(text);
    let m: RegExpExecArray | null;
    while ((m = re.exec(scan))) {
      const key = placeholderKeyFromInner(m[1]);
      if (!key) continue;
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
  return unescapePlaceholderDelimiters(text).replace(/<<((?:(?!>>).)*)>>/gs, (full, inner: string) => {
    const key = placeholderKeyFromInner(inner);
    if (!key) return full;
    const found = map.get(key.toLowerCase());
    return found !== undefined ? found : full;
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

export function isNamePlaceholderKey(key: string): boolean {
  return LEAD_FIELD_ALIASES.name.includes(key.toLowerCase());
}

export function syncNamePlaceholderValues(
  name: string,
  keys: string[],
  values: Record<string, string>,
): Record<string, string> {
  const next = { ...values };
  const n = String(name || "").trim();
  for (const k of keys) {
    if (isNamePlaceholderKey(k)) next[k] = n;
  }
  return next;
}

export function placeholderValuesComplete(
  keys: string[],
  values: Record<string, string>,
): boolean {
  return keys.every((k) => String(values[k] ?? "").trim() !== "");
}
