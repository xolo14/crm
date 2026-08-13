/** Shared types for Certificates & Offer Letters document forms. */

export type DocFormType = "offer_letter" | "certificate";

export type DocFormField = {
  id: string;
  key: string;
  label: string;
  type: "text" | "email" | "textarea" | "date" | "select";
  required?: boolean;
  placeholder?: string;
  options?: string[];
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
  name: string;
  slug: string;
  description?: string | null;
  form_type: DocFormType;
  fields_json: DocFormField[];
  /** Presentation / branding (same keys as lead form meta_json). */
  meta_json?: Record<string, unknown> | null;
  is_active: boolean;
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

export function extractPlaceholderKeys(...chunks: string[]): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  for (const chunk of chunks) {
    if (!chunk) continue;
    let m: RegExpExecArray | null;
    const text = String(chunk);
    while ((m = re.exec(text))) found.add(m[1]);
  }
  return [...found];
}

export function applyPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? "") : `{{${key}}}`,
  );
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
