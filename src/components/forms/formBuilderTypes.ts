export type QuestionType =
  | "short_answer"
  | "paragraph"
  | "multiple_choice"
  | "checkboxes"
  | "dropdown"
  | "file_upload"
  | "linear_scale"
  | "mc_grid"
  | "checkbox_grid"
  | "date"
  | "time"
  | "section_break";

export interface BuilderQuestion {
  id: string;
  type: QuestionType;
  title: string;
  description?: string;
  required: boolean;
  options?: string[];
  rows?: string[];
  columns?: string[];
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
  points?: number;
  validation?: { kind?: "text" | "number" | "length" | "regex"; value?: string };
  includeOther?: boolean;
}

export interface LegacyFormField {
  id?: string;
  key: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
}

export interface FormSection {
  id: string;
  title?: string;
  description?: string;
  questions: BuilderQuestion[];
}

function legacyFieldToQuestion(field: LegacyFormField, index: number): BuilderQuestion {
  const key = (field.key || "").toLowerCase();
  let validation: BuilderQuestion["validation"];
  if (field.type === "email" || key === "email") {
    validation = { kind: "regex", value: "email" };
  }
  const typeMap: Record<string, QuestionType> = {
    text: "short_answer",
    email: "short_answer",
    phone: "short_answer",
    number: "short_answer",
    textarea: "paragraph",
    select: "dropdown",
    date: "date",
  };
  return {
    id: field.id || `legacy_${index}`,
    type: typeMap[field.type] || "short_answer",
    title: field.label || `Question ${index + 1}`,
    description: field.placeholder || "",
    required: !!field.required,
    options: field.options || [],
    validation,
  };
}

export function parseBuilderQuestions(meta: Record<string, unknown> | null | undefined): BuilderQuestion[] | null {
  const raw = meta?.builder_questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw as BuilderQuestion[];
}

export function buildFormSections(
  questions: BuilderQuestion[],
  legacyFields?: LegacyFormField[],
): FormSection[] {
  const source =
    questions.length > 0
      ? questions
      : (legacyFields || []).map(legacyFieldToQuestion);

  const sections: FormSection[] = [];
  let current: FormSection = { id: "section-default", questions: [] };

  for (const q of source) {
    if (q.type === "section_break") {
      if (current.questions.length > 0 || current.title) {
        sections.push(current);
      }
      current = {
        id: q.id,
        title: q.title !== "Question" ? q.title : undefined,
        description: q.description,
        questions: [],
      };
      continue;
    }
    current.questions.push(q);
  }

  if (current.questions.length > 0 || current.title || current.description) {
    sections.push(current);
  }

  return sections.length > 0 ? sections : [{ id: "section-default", questions: source.filter((q) => q.type !== "section_break") }];
}

export function isEmailQuestion(q: Pick<BuilderQuestion, "title" | "validation">): boolean {
  if (q.validation?.kind === "regex" && q.validation?.value === "email") return true;
  const title = (q.title || "").trim();
  return /\be[\s-]*mail(\s+address)?\b/i.test(title);
}

export function questionFieldKey(q: BuilderQuestion, index: number): string {
  if (isEmailQuestion(q)) return "email";
  if (/full\s*name/i.test(q.title || "")) return "name";
  if (/phone|mobile|whatsapp/i.test(q.title || "")) return "phone";
  const fromTitle = q.title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return fromTitle || `field_${index + 1}`;
}

/** Resolve name/email/phone from builder question keys in form values. */
export function resolveLeadContactFromFormValues(
  questions: BuilderQuestion[],
  values: Record<string, string>,
): { name: string; email: string; phone: string } {
  let name = "";
  let email = "";
  let phone = "";
  questions.forEach((q, idx) => {
    const key = questionFieldKey(q, idx);
    const val = (values[key] || "").trim();
    if (!name && /full\s*name|^name$/i.test(q.title || "")) name = val;
    if (!email && isEmailQuestion(q)) email = val;
    if (!phone && /phone|mobile|whatsapp/i.test(q.title || "")) phone = val;
  });
  name = name || (values.name || values.full_name || "").trim();
  email = email || (values.email || "").trim();
  phone = phone || (values.phone || values.whatsapp || values.whatsapp_number || "").trim();
  return { name, email, phone };
}
