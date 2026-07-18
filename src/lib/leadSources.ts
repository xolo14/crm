/** Group CRM leads into source cards on the main Leads page. */

export const IMPORT_SET_PREFIX = 'import_set:';
export const IMPORT_FILE_PREFIX = 'import_file:';

export const LEAD_SOURCE_BUCKETS = [
  'google_ads',
  'meta_ads',
  'youtube',
  'website',
  'form_leads',
  'import',
  'whatsapp',
  'referral',
  'walkin',
  'college_seminar',
  'other',
] as const;

export type LeadSourceBucket = (typeof LEAD_SOURCE_BUCKETS)[number];

export const SOURCE_BUCKET_LABELS: Record<LeadSourceBucket, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  youtube: 'YouTube',
  website: 'Website',
  form_leads: 'Form leads',
  import: 'Import',
  whatsapp: 'WhatsApp',
  referral: 'Referral',
  walkin: 'Walk-in',
  college_seminar: 'College Seminar',
  other: 'Other',
};

const KNOWN_DIRECT: Record<string, LeadSourceBucket> = {
  google_ads: 'google_ads',
  youtube: 'youtube',
  website: 'website',
  whatsapp: 'whatsapp',
  referral: 'referral',
  walkin: 'walkin',
  college_seminar: 'college_seminar',
  facebook: 'meta_ads',
  instagram: 'meta_ads',
  other: 'other',
};

export function parseLeadTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.filter(Boolean).map(String);
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      /* plain CSV-ish */
    }
    return tags.split(',').map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

export function isImportedLead(lead: {
  source?: string | null;
  notes?: string | null;
  tags?: unknown;
}): boolean {
  const source = String(lead?.source || '').trim().toLowerCase();
  if (source.startsWith('import') || source.includes('import_')) return true;
  const tags = parseLeadTags(lead?.tags);
  if (tags.some((t) => t.startsWith(IMPORT_SET_PREFIX) || t.toLowerCase().includes('import_set:'))) {
    return true;
  }
  const notes = String(lead?.notes || '');
  return notes.includes(IMPORT_SET_PREFIX) || /import_set:/i.test(notes);
}

/** The unique per-file tag (e.g. "import_set:20260718120500-ab12") if this lead was imported. */
export function getImportSetTag(lead: { notes?: string | null; tags?: unknown }): string | null {
  const tags = parseLeadTags(lead?.tags);
  const tag = tags.find((t) => t.startsWith(IMPORT_SET_PREFIX));
  if (tag) return tag;
  const notes = String(lead?.notes || '');
  const match = notes.match(/import_set:[0-9]{8,14}-[a-z0-9]+/i);
  return match ? match[0] : null;
}

/** Original file name captured at import time, if available. */
export function getImportFileName(lead: { tags?: unknown }): string | null {
  const tags = parseLeadTags(lead?.tags);
  const tag = tags.find((t) => t.startsWith(IMPORT_FILE_PREFIX));
  const name = tag ? tag.slice(IMPORT_FILE_PREFIX.length).trim() : '';
  return name !== '' ? name : null;
}

/** Human-friendly card label for an import-set bucket: file name if known, else the import date/time. */
export function formatImportSetLabel(tag: string, fileName?: string | null): string {
  if (fileName) return fileName;
  const raw = tag.slice(IMPORT_SET_PREFIX.length).split('-')[0];
  if (/^\d{8}/.test(raw)) {
    const day = raw.slice(6, 8);
    const month = raw.slice(4, 6);
    const year = raw.slice(0, 4);
    const hour = raw.slice(8, 10);
    const minute = raw.slice(10, 12);
    let label = `Import ${day}/${month}/${year}`;
    if (hour && minute) label += ` ${hour}:${minute}`;
    return label;
  }
  return 'Import';
}

/** Align with Form Leads page + normal_form / form_* campaign sources. */
export function isFormLead(lead: {
  referred_by?: string | null;
  source?: string | null;
}): boolean {
  if (lead?.referred_by) return true;
  const source = String(lead?.source || '').trim().toLowerCase();
  if (source === 'google_forms' || source === 'normal_form') return true;
  if (source.startsWith('form_')) return true;
  return false;
}

/**
 * Bucket key for a lead. Imported leads return their unique per-file import-set tag
 * (so each import file becomes its own source card); imports without a tag fall back to 'import'.
 */
export function getLeadSourceBucket(lead: {
  source?: string | null;
  referred_by?: string | null;
  notes?: string | null;
  tags?: unknown;
}): string {
  if (isImportedLead(lead)) return getImportSetTag(lead) || 'import';
  if (isFormLead(lead)) return 'form_leads';

  const source = String(lead?.source || '').trim().toLowerCase();
  if (!source) return 'other';
  if (KNOWN_DIRECT[source]) return KNOWN_DIRECT[source];
  return 'other';
}

export type SourceStatusCounts = Record<string, number>;

export type SourceSummary = {
  key: string;
  label: string;
  isImport?: boolean;
  total: number;
  byStatus: SourceStatusCounts;
  unassigned: number;
};

export function statusKey(status?: string | null): string {
  if (!status) return '';
  if (status === 'converted') return 'enrolled';
  return status;
}

export function buildSourceSummaries(leads: any[]): SourceSummary[] {
  const map = new Map<string, SourceSummary>();

  const ensure = (key: string, label: string, isImport: boolean): SourceSummary => {
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        label,
        isImport,
        total: 0,
        byStatus: {},
        unassigned: 0,
      };
      map.set(key, row);
    }
    return row;
  };

  for (const lead of leads) {
    const key = getLeadSourceBucket(lead);
    const isImportSet = key.startsWith(IMPORT_SET_PREFIX);
    const isImport = isImportSet || key === 'import';
    const label = isImportSet
      ? formatImportSetLabel(key, getImportFileName(lead))
      : SOURCE_BUCKET_LABELS[key as LeadSourceBucket] || key;
    const row = ensure(key, label, isImport);
    row.total += 1;
    const sk = statusKey(lead?.status) || 'new';
    row.byStatus[sk] = (row.byStatus[sk] || 0) + 1;
    if (!lead?.assigned_to) row.unassigned += 1;
  }

  // Import files: newest first (import-set tags are timestamp-prefixed), then any legacy untagged import bucket.
  const importSets = [...map.values()]
    .filter((r) => r.key.startsWith(IMPORT_SET_PREFIX))
    .sort((a, b) => b.key.localeCompare(a.key));

  const ordered: SourceSummary[] = [];
  for (const key of LEAD_SOURCE_BUCKETS) {
    if (key === 'import') {
      ordered.push(...importSets);
      const legacy = map.get('import');
      if (legacy && legacy.total > 0) ordered.push(legacy);
      continue;
    }
    const row = map.get(key);
    if (row && row.total > 0) ordered.push(row);
  }
  return ordered;
}

export function filterLeadsBySourceBucket(leads: any[], bucket: LeadSourceBucket | string): any[] {
  return leads.filter((l) => getLeadSourceBucket(l) === bucket);
}

export function isImportSourceBucket(bucket: string | null | undefined): boolean {
  return !!bucket && (bucket.startsWith(IMPORT_SET_PREFIX) || bucket === 'import');
}
