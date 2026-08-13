/** Normalize status → count maps from the dashboard API (case / empty keys). */
export function normalizeLeadsByStatus(
  raw: unknown,
): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k || 'new').trim().toLowerCase() || 'new';
    out[key] = (out[key] || 0) + Number(v || 0);
  }
  return out;
}

function countStatuses(
  leads: Array<{ status?: string | null }>,
  statuses: string[],
): number {
  const set = new Set(statuses.map((s) => s.toLowerCase()));
  return leads.filter((l) => set.has(String(l.status || '').toLowerCase())).length;
}

function sumStatusMap(map: Record<string, number>, statuses: string[]): number {
  return statuses.reduce((s, k) => s + Number(map[k] || 0), 0);
}

/**
 * Lead KPIs for org dashboards.
 * Prefers server `leads_total` / `leads_by_status` when present; otherwise counts the lead sample.
 */
export function computeLeadKpis(opts: {
  hasDateFilter: boolean;
  leads: Array<{ status?: string | null }>;
  leadsTotal: number;
  byStatus: Record<string, number>;
  enrollStatuses?: string[];
  pipelineStatuses?: string[];
}) {
  const enrollStatuses = opts.enrollStatuses || ['enrolled', 'converted'];
  const pipelineStatuses = opts.pipelineStatuses || [
    'interested',
    'demo_scheduled',
    'demo_attended',
  ];
  const hasServerStatus = Object.keys(opts.byStatus).length > 0;
  const useServer = !opts.hasDateFilter && hasServerStatus;

  const total = opts.hasDateFilter
    ? opts.leads.length
    : opts.leadsTotal > 0
      ? opts.leadsTotal
      : opts.leads.length;

  const converted = useServer
    ? sumStatusMap(opts.byStatus, enrollStatuses)
    : countStatuses(opts.leads, enrollStatuses);

  const inPipeline = useServer
    ? sumStatusMap(opts.byStatus, pipelineStatuses)
    : countStatuses(opts.leads, pipelineStatuses);

  const statusCount = (key: string) =>
    useServer
      ? Number(opts.byStatus[key] || 0)
      : countStatuses(opts.leads, [key]);

  return { total, converted, inPipeline, useServer, hasServerStatus, statusCount };
}
