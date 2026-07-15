/** Group CRM leads into source cards on the main Leads page. */

export const IMPORT_SET_PREFIX = 'import_set:';

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

export function getLeadSourceBucket(lead: {
  source?: string | null;
  referred_by?: string | null;
  notes?: string | null;
  tags?: unknown;
}): LeadSourceBucket {
  if (isImportedLead(lead)) return 'import';
  if (isFormLead(lead)) return 'form_leads';

  const source = String(lead?.source || '').trim().toLowerCase();
  if (!source) return 'other';
  if (KNOWN_DIRECT[source]) return KNOWN_DIRECT[source];
  return 'other';
}

export type SourceStatusCounts = Record<string, number>;

export type SourceSummary = {
  key: LeadSourceBucket;
  label: string;
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
  const map = new Map<LeadSourceBucket, SourceSummary>();

  const ensure = (key: LeadSourceBucket): SourceSummary => {
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        label: SOURCE_BUCKET_LABELS[key] || key,
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
    const row = ensure(key);
    row.total += 1;
    const sk = statusKey(lead?.status) || 'new';
    row.byStatus[sk] = (row.byStatus[sk] || 0) + 1;
    if (!lead?.assigned_to) row.unassigned += 1;
  }

  const ordered: SourceSummary[] = [];
  for (const key of LEAD_SOURCE_BUCKETS) {
    const row = map.get(key);
    if (row && row.total > 0) ordered.push(row);
  }
  return ordered;
}

export function filterLeadsBySourceBucket(leads: any[], bucket: LeadSourceBucket | string): any[] {
  return leads.filter((l) => getLeadSourceBucket(l) === bucket);
}
