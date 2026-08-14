/**
 * Full lead-detail CSV export (contact, assignment, form responses, notes).
 * Mirrors what the Lead details panel shows, including Form Responses.
 */

import {
  formatFormAnswerDisplay,
  formatFormFieldLabel,
  parseFormLeadNotes,
  resolveLeadEmail,
  resolveLeadPhone,
} from '@/lib/parseFormLeadNotes';

export type LeadExportNameResolvers = {
  /** Primary assignee display name(s). */
  getAssignedTo: (lead: any) => string;
  /** Form collector / referral owner (optional). */
  getCollectedBy?: (lead: any) => string;
  /** Created-by member name (optional). */
  getCreatedBy?: (lead: any) => string;
};

function csvEscape(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function formatCreated(raw: unknown): string {
  if (!raw) return '';
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatStatus(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s === 'enrolled' || s === 'converted') return 'enrolled';
  return s.replace(/_/g, ' ');
}

type ParsedRow = {
  lead: any;
  formSlug: string | null;
  answers: Record<string, string>;
  attachments: Record<string, string>;
  freeformNotes: string | null;
};

/**
 * Build a CSV string with core lead columns + every form-answer / attachment field
 * found across the given leads (union of keys → dynamic columns).
 */
export function buildLeadsDetailExportCsv(rows: any[], resolvers: LeadExportNameResolvers): string {
  const parsedRows: ParsedRow[] = rows.map((lead) => {
    const parsed = parseFormLeadNotes(lead?.notes);
    return {
      lead,
      formSlug: parsed.formSlug,
      answers: parsed.answers,
      attachments: parsed.attachments,
      freeformNotes: parsed.freeformNotes,
    };
  });

  const answerKeyOrder: string[] = [];
  const answerKeySet = new Set<string>();
  const attachmentKeyOrder: string[] = [];
  const attachmentKeySet = new Set<string>();

  for (const row of parsedRows) {
    for (const key of Object.keys(row.answers)) {
      if (!answerKeySet.has(key)) {
        answerKeySet.add(key);
        answerKeyOrder.push(key);
      }
    }
    for (const key of Object.keys(row.attachments)) {
      if (!attachmentKeySet.has(key)) {
        attachmentKeySet.add(key);
        attachmentKeyOrder.push(key);
      }
    }
  }

  const baseHeaders = [
    'S.No',
    'Name',
    'Status',
    'Course / Program Interest',
    'Email',
    'Phone',
    'College',
    'Company',
    'Year of Study',
    'Source',
    'Form Name',
    'Assigned To',
    'Collected By',
    'Created By',
    'Created',
    'Lead ID',
    'Resume',
    'Notes',
  ];

  const formAnswerHeaders = answerKeyOrder.map((k) => `Form · ${formatFormFieldLabel(k)}`);
  const attachmentHeaders = attachmentKeyOrder.map((k) => `Attachment · ${formatFormFieldLabel(k)}`);
  const headers = [...baseHeaders, ...formAnswerHeaders, ...attachmentHeaders];

  const lines = [headers.map(csvEscape).join(',')];

  parsedRows.forEach((row, index) => {
    const { lead, formSlug, answers, attachments, freeformNotes } = row;
    const email = resolveLeadEmail(lead?.email, answers) || '';
    const phone = resolveLeadPhone(lead?.phone, answers) || '';
    const college =
      String(lead?.college || '').trim() ||
      String(answers.college || answers.college_university_name || answers.university || '').trim();
    const courseInterest =
      String(lead?.course_interest || '').trim() ||
      String(answers.course_interest || answers.specialization || '').trim();

    const base = [
      index + 1,
      lead?.name || '',
      formatStatus(lead?.status),
      courseInterest,
      email,
      phone,
      college,
      lead?.company || answers.company || '',
      lead?.year_of_study || answers.year_of_study || answers.year || answers.graduation_year || '',
      lead?.source || '',
      formSlug ? formSlug.replace(/_/g, ' ').replace(/-/g, ' ') : '',
      resolvers.getAssignedTo(lead) || '',
      resolvers.getCollectedBy?.(lead) || '',
      resolvers.getCreatedBy?.(lead) || String(lead?.created_by_name || '').trim(),
      formatCreated(lead?.created_at),
      lead?.id || '',
      lead?.resume_path || answers.resume || answers.cv || '',
      freeformNotes || (isPlainNotes(lead?.notes) ? String(lead.notes) : ''),
    ];

    const answerCols = answerKeyOrder.map((k) => formatFormAnswerDisplay(answers[k] || '', k));
    const attachmentCols = attachmentKeyOrder.map((k) => attachments[k] || '');

    lines.push([...base, ...answerCols, ...attachmentCols].map(csvEscape).join(','));
  });

  return lines.join('\n');
}

function isPlainNotes(notes: unknown): boolean {
  const s = String(notes || '').trim();
  if (!s) return false;
  if (/^Form:/im.test(s) || /^Answers:/im.test(s) || /^Attachments:/im.test(s)) return false;
  return true;
}

/** Trigger browser download of the full lead-detail CSV. */
export function downloadLeadsDetailCsv(
  rows: any[],
  filenameHint: string,
  resolvers: LeadExportNameResolvers,
): { ok: boolean; count: number } {
  if (!rows.length) return { ok: false, count: 0 };
  const csv = buildLeadsDetailExportCsv(rows, resolvers);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = filenameHint.replace(/[^\w\-]+/g, '_').slice(0, 60) || 'leads';
  a.download = `${safe}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return { ok: true, count: rows.length };
}
