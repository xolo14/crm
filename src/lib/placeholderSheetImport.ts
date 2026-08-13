/**
 * Spreadsheet → placeholder map for bulk offer letters / certificates.
 * Headers should match placeholder keys (e.g. candidate_name, recipient_name).
 */

import { parseLeadImportFile } from '@/lib/leadImportCsv';

export function normalizeSheetHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/\{\{|\}\}/g, '')
    .replace(/<<|>>/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Common aliases → canonical placeholder keys */
const HEADER_ALIASES: Record<string, string> = {
  name: 'candidate_name',
  full_name: 'candidate_name',
  fullname: 'candidate_name',
  student_name: 'candidate_name',
  recipient: 'candidate_name',
  recipient_name: 'recipient_name',
  email: 'recipient_email',
  e_mail: 'recipient_email',
  mail: 'recipient_email',
  email_id: 'recipient_email',
  email_address: 'recipient_email',
  role: 'role_title',
  job_title: 'role_title',
  position: 'role_title',
  joining_date: 'start_date',
  join_date: 'start_date',
  ctc: 'salary',
  package: 'salary',
  location: 'work_location',
  emp_type: 'employment_type',
  course: 'domain_name',
  course_name: 'domain_name',
  domain: 'domain_name',
  company: 'company_name',
};

export function resolvePlaceholderKey(header: string, allowedKeys?: string[]): string | null {
  const h = normalizeSheetHeader(header);
  if (!h) return null;
  const mapped = HEADER_ALIASES[h] || h;
  if (!allowedKeys || allowedKeys.length === 0) return mapped;
  const set = new Set(allowedKeys.map(normalizeSheetHeader));
  if (set.has(mapped)) return mapped;
  if (set.has(h)) return h;
  // Soft match: recipient_name ↔ candidate_name
  if (mapped === 'candidate_name' && set.has('recipient_name')) return 'recipient_name';
  if (mapped === 'recipient_name' && set.has('candidate_name')) return 'candidate_name';
  if (mapped === 'domain_name' && set.has('course_name')) return 'course_name';
  return null;
}

export type SheetImportResult = {
  headers: string[];
  mappedKeys: string[];
  rows: Record<string, string>[];
  skipped: number;
  errors: string[];
};

/**
 * Map spreadsheet rows to objects keyed by placeholder names (without {{ }}).
 */
export function mapSheetRowsToPlaceholders(
  grid: string[][],
  opts?: { allowedKeys?: string[]; requireKeys?: string[] },
): SheetImportResult {
  const errors: string[] = [];
  if (grid.length < 2) {
    return {
      headers: [],
      mappedKeys: [],
      rows: [],
      skipped: 0,
      errors: ['File needs a header row and at least one data row'],
    };
  }

  const rawHeaders = grid[0].map((h) => String(h ?? '').trim());
  const keyByCol: (string | null)[] = rawHeaders.map((h) =>
    resolvePlaceholderKey(h, opts?.allowedKeys),
  );
  const mappedKeys = [...new Set(keyByCol.filter(Boolean) as string[])];

  if (mappedKeys.length === 0) {
    return {
      headers: rawHeaders,
      mappedKeys: [],
      rows: [],
      skipped: 0,
      errors: ['No columns matched placeholders. Use headers like candidate_name, recipient_email.'],
    };
  }

  const rows: Record<string, string>[] = [];
  let skipped = 0;

  for (let r = 1; r < grid.length; r++) {
    const cols = grid[r];
    if (!cols?.some((c) => String(c || '').trim())) {
      skipped++;
      continue;
    }
    const obj: Record<string, string> = {};
    keyByCol.forEach((key, i) => {
      if (!key) return;
      const val = String(cols[i] ?? '').trim();
      if (val) obj[key] = val;
    });
    // Normalize name aliases into both keys when present
    if (obj.candidate_name && !obj.recipient_name) obj.recipient_name = obj.candidate_name;
    if (obj.recipient_name && !obj.candidate_name) obj.candidate_name = obj.recipient_name;
    if (obj.domain_name && !obj.course_name) obj.course_name = obj.domain_name;
    if (obj.course_name && !obj.domain_name) obj.domain_name = obj.course_name;

    const requireKeys = opts?.requireKeys || [];
    const missing = requireKeys.filter((k) => !String(obj[k] || '').trim());
    if (missing.length > 0) {
      skipped++;
      errors.push(`Row ${r + 1}: missing ${missing.join(', ')}`);
      continue;
    }
    rows.push(obj);
  }

  return { headers: rawHeaders, mappedKeys, rows, skipped, errors };
}

export async function parsePlaceholderSheetFile(file: File): Promise<string[][]> {
  return parseLeadImportFile(file);
}

export async function downloadPlaceholderExcelTemplate(
  headers: string[],
  sampleRow: string[],
  fileName: string,
  sheetName = 'Data',
): Promise<void> {
  const XLSX = await import('@stackline/xlsx');
  const worksheet = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

export const OFFER_BULK_SHEET_HEADERS = [
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
] as const;

export const OFFER_BULK_SHEET_SAMPLE = [
  'Rahul Sharma',
  'rahul@example.com',
  'Software Engineer',
  'Engineering',
  '15 Jan 2026',
  '₹8,00,000 p.a.',
  'Engineering Manager',
  'Hyderabad',
  'Full-Time',
  '6 months',
  '20 Apr 2026',
];

export const CERT_BULK_SHEET_HEADERS = [
  'recipient_name',
  'recipient_email',
  'domain_name',
  'issue_date',
  'company_name',
] as const;

export const CERT_BULK_SHEET_SAMPLE = [
  'Priya Patel',
  'priya@example.com',
  'Full Stack Development',
  '2026-04-01',
  'Syncpedia Technologies',
];
