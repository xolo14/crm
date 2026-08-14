/**
 * Offer-letter send/bulk helpers: template-only placeholders + lead autofill.
 */

import { extractPlaceholderKeys } from '@/modules/docForms/types';
import { OFFER_PLACEHOLDER_DEFS } from '@/components/templates/PlaceholderPalette';
import { parseFormLeadNotes } from '@/lib/parseFormLeadNotes';

export type OfferMailCfg = {
  mail_subject: string;
  mail_body: string;
  recipient_email_placeholder: string;
  pdf_filename_pattern: string;
};

/** Keys auto-filled (do not require manual entry / bulk columns). */
export const OFFER_AUTO_PLACEHOLDER_KEYS = new Set(['date', 'ref_number', 'letterhead_url']);

/** Maps {{placeholder}} → sendForm field name when it lives on sendForm. */
export const OFFER_SEND_FORM_KEY_MAP: Record<string, string> = {
  candidate_name: 'recipient_name',
  recipient_name: 'recipient_name',
  recipient_email: 'recipient_email',
  role_title: 'role_title',
  company_name: 'company_name',
  department: 'department',
  start_date: 'start_date',
  salary: 'salary',
  reporting_to: 'reporting_to',
  deadline: 'deadline',
  sender_name: 'sender_name',
  sender_title: 'sender_title',
  sender_email: 'sender_email',
  company_address: 'company_address',
  company_website: 'company_website',
  company_phone: 'company_phone',
  ref_number: 'ref_number',
  work_location: 'work_location',
  employment_type: 'employment_type',
  probation_period: 'probation_period',
};

/** Bulk candidate row field keys (not extras). */
export const OFFER_BULK_CANDIDATE_KEYS = new Set([
  'candidate_name',
  'recipient_email',
  'role_title',
  'department',
  'start_date',
  'salary',
  'reporting_to',
  'work_location',
  'employment_type',
  'probation_period',
  'deadline',
]);

export const OFFER_COMPANY_SENDER_KEYS = new Set([
  'company_name',
  'company_address',
  'company_website',
  'company_phone',
  'sender_name',
  'sender_title',
  'sender_email',
]);

const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(
  OFFER_PLACEHOLDER_DEFS.map((d) => [d.key, d.label]),
);

export function offerPlaceholderLabel(key: string): string {
  if (LABEL_BY_KEY[key]) return LABEL_BY_KEY[key];
  if (key === 'candidate_name' || key === 'recipient_name') return 'Candidate name';
  if (key === 'recipient_email') return 'Candidate email';
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** All placeholders used in template letter + mail settings (unique, stable order). */
export function getOfferTemplatePlaceholderKeys(
  htmlContent: string,
  mail: OfferMailCfg,
): string[] {
  const keys = extractPlaceholderKeys(
    htmlContent || '',
    mail.mail_subject || '',
    mail.mail_body || '',
    mail.pdf_filename_pattern || '',
  );
  // recipient_email_placeholder is often stored without {{ }} braces
  const emailKey = String(mail.recipient_email_placeholder || 'recipient_email')
    .replace(/^\{\{\s*|\s*\}\}$/g, '')
    .trim();
  if (emailKey && !keys.includes(emailKey)) keys.push(emailKey);
  return keys;
}

/** Keys the user must fill (excludes auto date). */
export function getOfferRequiredPlaceholderKeys(keys: string[]): string[] {
  return keys.filter((k) => !OFFER_AUTO_PLACEHOLDER_KEYS.has(k));
}

export function getOfferPlaceholderValue(
  key: string,
  sendForm: Record<string, string>,
  extras: Record<string, string>,
): string {
  const formKey = OFFER_SEND_FORM_KEY_MAP[key];
  if (formKey) return String(sendForm[formKey] ?? '').trim();
  return String(extras[key] ?? '').trim();
}

export function findMissingOfferPlaceholders(
  keys: string[],
  sendForm: Record<string, string>,
  extras: Record<string, string>,
): string[] {
  return getOfferRequiredPlaceholderKeys(keys).filter(
    (k) => !getOfferPlaceholderValue(k, sendForm, extras),
  );
}

function normKey(k: string): string {
  return String(k || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Map a CRM lead (and form answers in notes) onto template placeholder keys.
 * Only returns keys that exist in `templateKeys` and have a non-empty value.
 */
export function mapLeadToOfferPlaceholderValues(
  lead: any,
  templateKeys: string[],
): Record<string, string> {
  const wanted = new Set(templateKeys);
  const parsed = parseFormLeadNotes(lead?.notes);
  const pool: Record<string, string> = {};

  const put = (key: string, value: unknown) => {
    const v = String(value ?? '').trim();
    if (!v || v === '0000000000') return;
    const nk = normKey(key);
    if (!nk) return;
    if (pool[nk] === undefined) pool[nk] = v;
  };

  put('name', lead?.name);
  put('candidate_name', lead?.name);
  put('recipient_name', lead?.name);
  put('email', lead?.email);
  put('recipient_email', lead?.email);
  put('phone', lead?.phone);
  put('college', lead?.college);
  put('company', lead?.company);
  put('year_of_study', lead?.year_of_study);
  put('course_interest', lead?.course_interest);
  put('source', lead?.source);

  for (const [k, v] of Object.entries(parsed.answers || {})) {
    put(k, v);
  }

  // Aliases frequently used in templates
  if (pool.email) put('recipient_email', pool.email);
  if (pool.name) {
    put('candidate_name', pool.name);
    put('recipient_name', pool.name);
  }
  if (pool.course_interest) put('role_title', pool.course_interest);
  if (pool.company) put('company_name', pool.company);
  if (pool.college) put('college', pool.college);

  const out: Record<string, string> = {};
  for (const key of templateKeys) {
    if (!wanted.has(key)) continue;
    const nk = normKey(key);
    const v = pool[nk] || pool[key] || '';
    if (v) out[key] = v;
  }

  // Always map name/email into both aliases when template uses either
  if (lead?.name) {
    if (wanted.has('candidate_name')) out.candidate_name = String(lead.name).trim();
    if (wanted.has('recipient_name')) out.recipient_name = String(lead.name).trim();
  }
  if (lead?.email) {
    if (wanted.has('recipient_email')) out.recipient_email = String(lead.email).trim();
  }

  return out;
}

export function applyMappedValuesToSendState(
  mapped: Record<string, string>,
  sendForm: Record<string, string>,
  extras: Record<string, string>,
): { sendForm: Record<string, string>; extras: Record<string, string> } {
  const nextForm = { ...sendForm };
  const nextExtras = { ...extras };
  for (const [key, value] of Object.entries(mapped)) {
    const formKey = OFFER_SEND_FORM_KEY_MAP[key];
    if (formKey) {
      nextForm[formKey] = value;
    } else {
      nextExtras[key] = value;
    }
  }
  return { sendForm: nextForm, extras: nextExtras };
}

export function applyMappedValuesToBulkRow(
  mapped: Record<string, string>,
  row: Record<string, string>,
  extras: Record<string, string>,
): { row: Record<string, string>; extras: Record<string, string> } {
  const nextRow = { ...row };
  const nextExtras = { ...extras };
  for (const [key, value] of Object.entries(mapped)) {
    if (key === 'recipient_name' || key === 'candidate_name') {
      nextRow.candidate_name = value;
      continue;
    }
    if (OFFER_BULK_CANDIDATE_KEYS.has(key)) {
      nextRow[key] = value;
    } else if (!OFFER_COMPANY_SENDER_KEYS.has(key) && key !== 'date' && key !== 'ref_number') {
      nextExtras[key] = value;
    }
  }
  return { row: nextRow, extras: nextExtras };
}
