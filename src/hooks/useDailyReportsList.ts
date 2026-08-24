import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { APP_TIMEZONE } from '@/lib/dateTime';
import { aggregateByRep, mapToSalesReports, type DailyReportRecord } from '@/utils/analyticsHelpers';

export type DailyReportsTimeline =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'this_month'
  | 'all';

function isoInAppTz(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: APP_TIMEZONE });
}

/** Shift a YYYY-MM-DD calendar day by `delta` days in Asia/Kolkata. */
function shiftIsoDay(isoDay: string, delta: number): string {
  const d = new Date(`${isoDay}T12:00:00+05:30`);
  d.setTime(d.getTime() + delta * 24 * 60 * 60 * 1000);
  return isoInAppTz(d);
}

function reportDateKey(r: DailyReportRecord): string {
  return String(r.report_date || '').slice(0, 10);
}

function reportInTimeline(r: DailyReportRecord, timeline: DailyReportsTimeline): boolean {
  if (timeline === 'all') return true;
  const key = reportDateKey(r);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const today = isoInAppTz();
  if (timeline === 'today') return key === today;
  if (timeline === 'yesterday') return key === shiftIsoDay(today, -1);
  if (timeline === 'last_7_days') {
    const from = shiftIsoDay(today, -7);
    return key >= from && key <= today;
  }
  if (timeline === 'this_month') {
    const from = `${today.slice(0, 7)}-01`;
    return key >= from && key <= today;
  }
  return true;
}

export function useDailyReportsList(opts?: { initialTimeline?: DailyReportsTimeline }) {
  const { user, role } = useAuth();
  const [reports, setReports] = useState<DailyReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRep, setSelectedRep] = useState<string>('all');
  const [timeline, setTimeline] = useState<DailyReportsTimeline>(opts?.initialTimeline ?? 'today');
  const [teamMembers, setTeamMembers] = useState<{ id: string; full_name: string; role?: string }[]>([]);

  const isManager =
    role === 'admin' || role === 'org' || role === 'super_admin' || role === 'manager';
  const isSalesRep = role === 'sales_representative';

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params: { user_id?: string } = {};
      if (isSalesRep && user?.id) params.user_id = user.id;
      const data = await api.dailyReports.list(params);
      setReports(data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [isSalesRep, user?.id]);

  const fetchTeam = useCallback(async () => {
    try {
      const data = await api.team.list();
      setTeamMembers(
        (data.data || []).filter((m: { role?: string }) => m.role === 'sales_representative'),
      );
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void fetchReports();
    if (isManager) void fetchTeam();
  }, [fetchReports, fetchTeam, isManager]);

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (selectedRep !== 'all' && r.user_id !== selectedRep) return false;
      return reportInTimeline(r, timeline);
    });
  }, [reports, selectedRep, timeline]);

  const salesReports = useMemo(() => mapToSalesReports(filteredReports), [filteredReports]);
  const byRep = useMemo(() => aggregateByRep(salesReports), [salesReports]);

  return {
    reports,
    filteredReports,
    salesReports,
    byRep,
    loading,
    selectedRep,
    setSelectedRep,
    timeline,
    setTimeline,
    teamMembers,
    isManager,
    isSalesRep,
    refetch: fetchReports,
  };
}
