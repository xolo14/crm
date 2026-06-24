/** Normalized row for analytics charts (mapped from daily report API records). */
export interface SalesReport {
  date: string;
  rep: string;
  calls: number;
  followUps: number;
  demos: number;
  newContacted: number;
  enrolled: number;
  lost: number;
}

export interface RepSummary {
  rep: string;
  calls: number;
  followUps: number;
  demos: number;
  newContacted: number;
  enrolled: number;
  lost: number;
  conversionRate: number;
}

/** Raw daily report record from `api.dailyReports.list`. */
export interface DailyReportRecord {
  id: string;
  user_id?: string;
  user_name?: string;
  report_date: string;
  total_calls?: number;
  total_followups?: number;
  total_demos?: number;
  new_leads_contacted?: number;
  total_conversions?: number;
  total_lost?: number;
  summary?: string;
  challenges?: string;
}

export const ANALYTICS_CARD_CLASS = "border-border/50 shadow-none";

export function mapToSalesReports(reports: DailyReportRecord[]): SalesReport[] {
  return reports.map((r) => ({
    date: r.report_date,
    rep: r.user_name?.trim() || "Unknown",
    calls: r.total_calls ?? 0,
    followUps: r.total_followups ?? 0,
    demos: r.total_demos ?? 0,
    newContacted: r.new_leads_contacted ?? 0,
    enrolled: r.total_conversions ?? 0,
    lost: r.total_lost ?? 0,
  }));
}

export function aggregateByRep(data: SalesReport[]): RepSummary[] {
  const map = new Map<string, RepSummary>();
  data.forEach((r) => {
    const p = map.get(r.rep) ?? {
      rep: r.rep,
      calls: 0,
      followUps: 0,
      demos: 0,
      newContacted: 0,
      enrolled: 0,
      lost: 0,
      conversionRate: 0,
    };
    const u: RepSummary = {
      rep: r.rep,
      calls: p.calls + r.calls,
      followUps: p.followUps + r.followUps,
      demos: p.demos + r.demos,
      newContacted: p.newContacted + r.newContacted,
      enrolled: p.enrolled + r.enrolled,
      lost: p.lost + r.lost,
      conversionRate: 0,
    };
    u.conversionRate = u.calls > 0 ? Math.round((u.enrolled / u.calls) * 100) : 0;
    map.set(r.rep, u);
  });
  return Array.from(map.values()).sort((a, b) => b.enrolled - a.enrolled);
}
