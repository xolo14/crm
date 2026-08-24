/** Group CRM leads into source cards on the main Leads page. */

import { parseServerDateTime } from '@/lib/dateTime';

export const IMPORT_SET_PREFIX = 'import_set:';
export const IMPORT_FILE_PREFIX = 'import_file:';
export const PEAKLYY_SOURCE_PREFIX = 'peaklyy:';
export const PEAKLYY_TITLE_PREFIX = 'peaklyy_title:';
export const PEAKLYY_ATTEMPTS_PREFIX = 'peaklyy_attempts:';
export const FORM_SOURCE_PREFIX = 'form_';
/** One Leads card per Meta ad (Lead Ads). */
const META_AD_SOURCE_PREFIX = 'meta_ad:';
const META_AD_NAME_PREFIX = 'meta_ad_name:';
const META_LEAD_ID_PREFIX = 'meta_lead_id:';
/** Tag stamped on CRM "Add Lead" / Create Lead rows so they share one source card. */
export const ADDED_LEAD_TAG = 'entry:manual';
export const ADDED_LEADS_BUCKET = 'added_leads';

export const LEAD_SOURCE_BUCKETS = [
  'added_leads',
  'google_ads',
  'meta_ads',
  'youtube',
  'website',
  'form_leads',
  'peaklyy',
  'import',
  'whatsapp',
  'referral',
  'walkin',
  'college_seminar',
  'other',
] as const;

export type LeadSourceBucket = (typeof LEAD_SOURCE_BUCKETS)[number];

export const SOURCE_BUCKET_LABELS: Record<LeadSourceBucket, string> = {
  added_leads: 'Added leads',
  google_ads: 'Google Ads',
  meta_ads: 'Meta Ads',
  youtube: 'YouTube',
  website: 'Website',
  form_leads: 'Form leads',
  peaklyy: 'Peaklyy Assessments',
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
  meta_ads: 'meta_ads',
  other: 'other',
  peaklyy: 'peaklyy',
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

/** CRM-created leads (Add Lead dialog) — one dedicated "Added leads" card. */
export function isManuallyAddedLead(lead: {
  source?: string | null;
  notes?: string | null;
  tags?: unknown;
}): boolean {
  if (isImportedLead(lead) || isPeaklyyLead(lead)) return false;
  const tags = parseLeadTags(lead?.tags);
  if (
    tags.some((t) => {
      const v = String(t).trim().toLowerCase();
      return v === ADDED_LEAD_TAG || v === 'added_lead' || v === 'entry:manual';
    })
  ) {
    return true;
  }
  const source = String(lead?.source || '').trim().toLowerCase();
  if (source === 'manual' || source === 'added' || source === ADDED_LEADS_BUCKET) return true;
  // Legacy Add Lead defaulted to source "other".
  if (source === 'other' || source === '') return true;
  return false;
}

export function isAddedSourceBucket(bucket: string | null | undefined): boolean {
  return bucket === ADDED_LEADS_BUCKET;
}

/** Align with Form Leads page + normal_form / form_* campaign sources. */
export function isFormLead(lead: {
  referred_by?: string | null;
  source?: string | null;
  notes?: string | null;
  tags?: unknown;
}): boolean {
  // Manual CRM adds are not form submissions (even if referred_by was auto-stamped).
  if (isManuallyAddedLead(lead)) return false;
  if (lead?.referred_by) return true;
  const source = String(lead?.source || '').trim().toLowerCase();
  if (source === 'google_forms' || source === 'normal_form') return true;
  if (source.startsWith(FORM_SOURCE_PREFIX)) return true;
  return false;
}

/**
 * One card per form when source is form_{slug}.
 * Legacy google_forms / normal_form / referral-only rows get stable fallback buckets.
 */
export function getFormSourceKey(lead: {
  referred_by?: string | null;
  source?: string | null;
}): string {
  const source = String(lead?.source || '').trim();
  const lower = source.toLowerCase();
  if (lower.startsWith(FORM_SOURCE_PREFIX) && lower.length > FORM_SOURCE_PREFIX.length) {
    // Normalize to form_{slug} using the slug portion as stored (usually lowercase).
    return FORM_SOURCE_PREFIX + source.slice(FORM_SOURCE_PREFIX.length);
  }
  if (lower === 'google_forms') return 'form_google_forms';
  if (lower === 'normal_form') return 'form_normal';
  return 'form_other';
}

export function isFormSourceBucket(bucket: string | null | undefined): boolean {
  if (!bucket) return false;
  if (bucket === 'form_leads' || bucket === 'form_other' || bucket === 'form_google_forms' || bucket === 'form_normal') {
    return true;
  }
  return bucket.startsWith(FORM_SOURCE_PREFIX);
}

export type FormAssigneeOption = { id: string; full_name: string; role?: string };

/**
 * People assigned to a lead form in Form Management — used as Assign options
 * for leads that belong to that form (source form_{slug}).
 */
export function resolveFormAssigneesForSourceKey(
  sourceKey: string | null | undefined,
  forms: Array<{ id: string; slug: string }>,
  assignmentsByFormId: Record<string, Array<{ member_id?: string; full_name?: string | null }>>,
): FormAssigneeOption[] {
  if (!sourceKey || !String(sourceKey).startsWith(FORM_SOURCE_PREFIX)) return [];
  const slug = String(sourceKey).slice(FORM_SOURCE_PREFIX.length);
  if (!slug) return [];
  const form = forms.find((f) => String(f.slug || '').toLowerCase() === slug.toLowerCase());
  if (!form?.id) return [];
  const rows = assignmentsByFormId[form.id] || [];
  const byId = new Map<string, FormAssigneeOption>();
  for (const row of rows) {
    const id = String(row?.member_id || '').trim();
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      id,
      full_name: String(row?.full_name || '').trim() || 'Team member',
      role: 'form_assignee',
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export function formatFormSourceLabel(key: string, formLabels?: Record<string, string>): string {
  if (formLabels?.[key]) return formLabels[key];
  if (key.startsWith(FORM_SOURCE_PREFIX)) {
    const slug = key.slice(FORM_SOURCE_PREFIX.length);
    if (formLabels?.[slug]) return formLabels[slug];
    if (formLabels?.[`form_${slug}`]) return formLabels[`form_${slug}`];
    if (slug === 'google_forms') return 'Google Forms';
    if (slug === 'normal') return 'Normal form';
    if (slug === 'other') return 'Other form leads';
    return slug
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || 'Form lead';
  }
  if (key === 'form_leads') return 'Form leads';
  return 'Form lead';
}

export function isPeaklyyLead(lead: { source?: string | null; tags?: unknown }): boolean {
  const source = String(lead?.source || '').trim().toLowerCase();
  if (source === 'peaklyy' || source.startsWith(PEAKLYY_SOURCE_PREFIX)) return true;
  const tags = parseLeadTags(lead?.tags);
  return tags.some((t) => t === 'peaklyy' || t.startsWith('peaklyy_id:'));
}

export function getPeaklyySourceKey(lead: { source?: string | null; tags?: unknown }): string {
  const source = String(lead?.source || '').trim();
  if (source.toLowerCase().startsWith(PEAKLYY_SOURCE_PREFIX)) return source;
  const tags = parseLeadTags(lead?.tags);
  const idTag = tags.find((t) => t.startsWith('peaklyy_id:'));
  if (idTag) return PEAKLYY_SOURCE_PREFIX + idTag.slice('peaklyy_id:'.length);
  return 'peaklyy';
}

export function getPeaklyyAssessmentTitle(lead: { tags?: unknown; source?: string | null }): string {
  const tags = parseLeadTags(lead?.tags);
  const title = tags.find((t) => t.startsWith(PEAKLYY_TITLE_PREFIX));
  if (title) {
    const name = title.slice(PEAKLYY_TITLE_PREFIX.length).trim();
    if (name) return name;
  }
  return 'Peaklyy Assessment';
}

export function getPeaklyyAttemptCount(lead: { tags?: unknown }): number {
  const tags = parseLeadTags(lead?.tags);
  const raw = tags.find((t) => t.startsWith(PEAKLYY_ATTEMPTS_PREFIX));
  if (!raw) return 1;
  const n = Number.parseInt(raw.slice(PEAKLYY_ATTEMPTS_PREFIX.length), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Meta Lead Ads — one card per ad (tagged meta_ad: / meta_ad_name:). */
function isMetaAdLead(lead: { source?: string | null; tags?: unknown }): boolean {
  const tags = parseLeadTags(lead?.tags);
  if (
    tags.some(
      (t) =>
        t.startsWith(META_AD_SOURCE_PREFIX) ||
        t.startsWith(META_AD_NAME_PREFIX) ||
        t.startsWith(META_LEAD_ID_PREFIX) ||
        t.startsWith('meta_ad_id:'),
    )
  ) {
    return true;
  }
  const source = String(lead?.source || '').trim().toLowerCase();
  return source.startsWith(META_AD_SOURCE_PREFIX);
}

function getMetaAdSourceKey(lead: { source?: string | null; tags?: unknown }): string {
  const source = String(lead?.source || '').trim();
  if (source.toLowerCase().startsWith(META_AD_SOURCE_PREFIX)) return source;
  const tags = parseLeadTags(lead?.tags);
  const idTag = tags.find((t) => t.startsWith(META_AD_SOURCE_PREFIX));
  if (idTag) return idTag;
  const legacy = tags.find((t) => t.startsWith('meta_ad_id:'));
  if (legacy) return META_AD_SOURCE_PREFIX + legacy.slice('meta_ad_id:'.length);
  return 'meta_ads';
}

function getMetaAdName(lead: { tags?: unknown; source?: string | null }): string {
  const tags = parseLeadTags(lead?.tags);
  const nameTag = tags.find((t) => t.startsWith(META_AD_NAME_PREFIX));
  if (nameTag) {
    const name = nameTag.slice(META_AD_NAME_PREFIX.length).trim();
    if (name) return name;
  }
  const key = getMetaAdSourceKey(lead);
  if (key.startsWith(META_AD_SOURCE_PREFIX) && key.length > META_AD_SOURCE_PREFIX.length) {
    return key.slice(META_AD_SOURCE_PREFIX.length);
  }
  return 'Meta Ad';
}

function isMetaAdSourceBucket(bucket: string | null | undefined): boolean {
  return !!bucket && (bucket.startsWith(META_AD_SOURCE_PREFIX) || bucket === 'meta_ads');
}

/**
 * Bucket key for a lead. Imported leads return their unique per-file import-set tag
 * (so each import file becomes its own source card); imports without a tag fall back to 'import'.
 * Peaklyy leads return peaklyy:{assessmentId} so each assessment is its own card.
 * Meta Lead Ads return meta_ad:{adId} so each ad is its own card (label = ad name).
 * Form leads return form_{slug} so each form is its own card.
 */
export function getLeadSourceBucket(lead: {
  source?: string | null;
  referred_by?: string | null;
  notes?: string | null;
  tags?: unknown;
}): string {
  if (isImportedLead(lead)) return getImportSetTag(lead) || 'import';
  if (isPeaklyyLead(lead)) return getPeaklyySourceKey(lead);
  if (isMetaAdLead(lead)) return getMetaAdSourceKey(lead);
  if (isManuallyAddedLead(lead)) return ADDED_LEADS_BUCKET;
  if (isFormLead(lead)) return getFormSourceKey(lead);

  const source = String(lead?.source || '').trim().toLowerCase();
  if (!source) return ADDED_LEADS_BUCKET;
  if (KNOWN_DIRECT[source]) return KNOWN_DIRECT[source];
  return 'other';
}

export type SourceStatusCounts = Record<string, number>;

export type SourceSummary = {
  key: string;
  label: string;
  isImport?: boolean;
  isPeaklyy?: boolean;
  isForm?: boolean;
  isAdded?: boolean;
  isMetaAd?: boolean;
  total: number;
  byStatus: SourceStatusCounts;
  unassigned: number;
  /** Newest lead created_at in this card (ms). Used for uniform card ordering. */
  latestCreatedAtMs?: number;
};

export function statusKey(status?: string | null): string {
  if (!status) return '';
  if (status === 'converted') return 'enrolled';
  return status;
}

function leadCreatedAtMs(lead: { created_at?: string | null }): number {
  const d = parseServerDateTime(lead?.created_at);
  return d ? d.getTime() : 0;
}

export function buildSourceSummaries(
  leads: any[],
  opts?: { formLabels?: Record<string, string> },
): SourceSummary[] {
  const formLabels = opts?.formLabels || {};
  const map = new Map<string, SourceSummary>();

  const ensure = (
    key: string,
    label: string,
    isImport: boolean,
    isPeaklyy = false,
    isForm = false,
    isAdded = false,
    isMetaAd = false,
  ): SourceSummary => {
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        label,
        isImport,
        isPeaklyy,
        isForm,
        isAdded,
        isMetaAd,
        total: 0,
        byStatus: {},
        unassigned: 0,
        latestCreatedAtMs: 0,
      };
      map.set(key, row);
    }
    return row;
  };

  for (const lead of leads) {
    const key = getLeadSourceBucket(lead);
    const isImportSet = key.startsWith(IMPORT_SET_PREFIX);
    const isImport = isImportSet || key === 'import';
    const isPeaklyy = key.startsWith(PEAKLYY_SOURCE_PREFIX) || key === 'peaklyy';
    const isForm = isFormSourceBucket(key);
    const isAdded = isAddedSourceBucket(key);
    const isMetaAd = isMetaAdSourceBucket(key);
    const label = isImportSet
      ? formatImportSetLabel(key, getImportFileName(lead))
      : isPeaklyy
        ? getPeaklyyAssessmentTitle(lead)
        : isMetaAd
          ? getMetaAdName(lead)
          : isForm
            ? formatFormSourceLabel(key, formLabels)
            : SOURCE_BUCKET_LABELS[key as LeadSourceBucket] || key;
    const row = ensure(key, label, isImport, isPeaklyy, isForm, isAdded, isMetaAd);
    if (isPeaklyy && row.label === 'Peaklyy Assessment') {
      row.label = getPeaklyyAssessmentTitle(lead);
    }
    if (isMetaAd) {
      const nicer = getMetaAdName(lead);
      if (nicer && (row.label === key || row.label === 'Meta Ad' || row.label === 'Meta Ads')) {
        row.label = nicer;
      }
    }
    if (isForm) {
      const nicer = formatFormSourceLabel(key, formLabels);
      if (nicer && (row.label === key || row.label.startsWith('form_'))) {
        row.label = nicer;
      }
    }
    row.total += 1;
    const sk = statusKey(lead?.status) || 'new';
    row.byStatus[sk] = (row.byStatus[sk] || 0) + 1;
    if (!lead?.assigned_to) row.unassigned += 1;
    const createdMs = leadCreatedAtMs(lead);
    if (createdMs > (row.latestCreatedAtMs || 0)) {
      row.latestCreatedAtMs = createdMs;
    }
  }

  // All cards (forms, Peaklyy, imports, ads, etc.) share one order: newest lead first.
  return [...map.values()]
    .filter((r) => r.total > 0)
    .sort((a, b) => {
      const byDate = (b.latestCreatedAtMs || 0) - (a.latestCreatedAtMs || 0);
      if (byDate !== 0) return byDate;
      return a.label.localeCompare(b.label);
    });
}

export function filterLeadsBySourceBucket(leads: any[], bucket: LeadSourceBucket | string): any[] {
  return leads.filter((l) => getLeadSourceBucket(l) === bucket);
}

export function isImportSourceBucket(bucket: string | null | undefined): boolean {
  return !!bucket && (bucket.startsWith(IMPORT_SET_PREFIX) || bucket === 'import');
}

export function isPeaklyySourceBucket(bucket: string | null | undefined): boolean {
  return !!bucket && (bucket.startsWith(PEAKLYY_SOURCE_PREFIX) || bucket === 'peaklyy');
}
