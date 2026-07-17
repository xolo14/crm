/**
 * Flexible CSV lead import — header-based mapping; unmapped columns become form-style Answers JSON.
 */

export type ImportedLeadRow = {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  college: string | null;
  year_of_study: string | null;
  course_interest: string | null;
  source: string;
  notes: string | null;
  tags: string[];
};

const CORE_ALIASES: Record<string, keyof Omit<ImportedLeadRow, "notes" | "tags" | "source"> | "source" | "notes"> = {
  name: "name",
  full_name: "name",
  fullname: "name",
  lead_name: "name",
  student_name: "name",
  contact_name: "name",
  email: "email",
  e_mail: "email",
  mail: "email",
  email_id: "email",
  phone: "phone",
  mobile: "phone",
  mobile_number: "phone",
  phone_number: "phone",
  contact: "phone",
  contact_number: "phone",
  whatsapp: "phone",
  tel: "phone",
  company: "company",
  organization: "company",
  organisation: "company",
  college: "college",
  university: "college",
  institute: "college",
  year_of_study: "year_of_study",
  year: "year_of_study",
  course_interest: "course_interest",
  course: "course_interest",
  specialization: "course_interest",
  source: "source",
  lead_source: "source",
  notes: "notes",
  note: "notes",
  remarks: "notes",
  comment: "notes",
  comments: "notes",
};

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** RFC-style CSV split (handles quoted commas and "" escapes). */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell.trim());
      cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

function emptyToNull(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Map CSV rows to lead payloads. Requires name OR phone (or email as last-resort identifier).
 * Extra columns → `Answers: {...}` in notes (same shape as form submissions).
 */
export function mapCsvRowsToLeads(
  rows: string[][],
  opts: { importSetTag: string },
): { leads: ImportedLeadRow[]; skipped: number; errors: string[] } {
  const errors: string[] = [];
  if (rows.length < 2) {
    return { leads: [], skipped: 0, errors: ["CSV needs a header row and at least one data row"] };
  }

  const headers = rows[0].map(normalizeHeader);
  const headerIndex = new Map<string, number>();
  headers.forEach((h, i) => {
    if (h) headerIndex.set(h, i);
  });

  const leads: ImportedLeadRow[] = [];
  let skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (!cols.some((c) => String(c || "").trim())) {
      skipped++;
      continue;
    }

    const core: Record<string, string> = {};
    const extras: Record<string, string> = {};

    headers.forEach((h, i) => {
      if (!h) return;
      const raw = String(cols[i] ?? "").trim();
      if (raw === "") return;
      const mapped = CORE_ALIASES[h];
      if (mapped) {
        if (!core[mapped]) core[mapped] = raw;
      } else {
        extras[h] = raw;
      }
    });

    // Positional fallback when headers are missing / generic (legacy exports)
    if (!core.name && !core.email && !core.phone && headers.every((h) => !CORE_ALIASES[h])) {
      core.name = String(cols[1] ?? cols[0] ?? "").trim();
      core.email = String(cols[2] ?? "").trim();
      core.phone = String(cols[3] ?? "").trim();
      core.college = String(cols[4] ?? "").trim();
      core.course_interest = String(cols[5] ?? "").trim();
      core.source = String(cols[6] ?? "").trim();
    }

    let name = (core.name || "").trim();
    const phone = (core.phone || "").trim();
    const email = (core.email || "").trim();

    if (!name && !phone && !email) {
      skipped++;
      errors.push(`Row ${r + 1}: need a name, phone, or email`);
      continue;
    }
    if (!name) {
      name = phone || email || "Imported lead";
    }

    const noteParts: string[] = [];
    if (core.notes) noteParts.push(core.notes);
    if (Object.keys(extras).length > 0) {
      noteParts.push("Answers: " + JSON.stringify(extras));
    }

    let source = (core.source || "other").trim().toLowerCase().replace(/\s+/g, "_") || "other";
    const allowed = new Set([
      "google_ads",
      "instagram",
      "facebook",
      "youtube",
      "website",
      "google_forms",
      "whatsapp",
      "referral",
      "walkin",
      "college_seminar",
      "other",
    ]);
    if (!allowed.has(source)) source = "other";

    leads.push({
      name: name.slice(0, 100),
      email: emptyToNull(email),
      phone: emptyToNull(phone)?.slice(0, 20) ?? null,
      company: emptyToNull(core.company || ""),
      college: emptyToNull(core.college || ""),
      year_of_study: emptyToNull(core.year_of_study || ""),
      course_interest: emptyToNull(core.course_interest || ""),
      source,
      notes: noteParts.length ? noteParts.join("\n") : null,
      tags: [opts.importSetTag, "imported_csv"],
    });
  }

  return { leads, skipped, errors };
}

/** Sample CSV for the Import leads dialog (headers match CORE_ALIASES). */
export const LEAD_IMPORT_TEMPLATE_HEADERS = [
  "name",
  "email",
  "phone",
  "college",
  "year_of_study",
  "course_interest",
  "company",
  "source",
  "notes",
] as const;

export function buildLeadImportTemplateCsv(): string {
  const sample = [
    "Rahul Sharma",
    "rahul@example.com",
    "9876543210",
    "ABC College",
    "3rd year",
    "Full Stack",
    "",
    "other",
    "Interested in weekend batch",
  ];
  const escape = (v: string) => {
    if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  return [
    LEAD_IMPORT_TEMPLATE_HEADERS.join(","),
    sample.map(escape).join(","),
  ].join("\n");
}

export function downloadLeadImportTemplate(): void {
  const csv = buildLeadImportTemplateCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leads-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}
