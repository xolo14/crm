import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { callLogsApi } from '@/services/callLogs';
import { APP_TIMEZONE } from '@/lib/dateTime';
import { aggregateByRep, mapToSalesReports, type DailyReportRecord } from '@/utils/analyticsHelpers';

export type DailyReportsTimeline =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'this_month'
  | 'all'
  | 'custom';

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

function reportInTimeline(
  r: DailyReportRecord,
  timeline: DailyReportsTimeline,
  customFrom?: string,
  customTo?: string,
): boolean {
  if (timeline === 'all') return true;
  const key = reportDateKey(r);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const today = isoInAppTz();
  if (timeline === 'today') return key === today;
  if (timeline === 'yesterday') return key === shiftIsoDay(today, -1);
  if (timeline === 'last_7_days') {
    const from = shiftIsoDay(today, -6);
    return key >= from && key <= today;
  }
  if (timeline === 'this_month') {
    const from = `${today.slice(0, 7)}-01`;
    return key >= from && key <= today;
  }
  if (timeline === 'custom') {
    const from = (customFrom || '').slice(0, 10);
    const to = (customTo || '').slice(0, 10);
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from) && key < from) return false;
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to) && key > to) return false;
    // No bounds yet → show nothing until at least one date is set
    if (!from && !to) return false;
    return true;
  }
  return true;
}

export function useDailyReportsList(opts?: { initialTimeline?: DailyReportsTimeline }) {
  const { user, role } = useAuth();
  const [reports, setReports] = useState<DailyReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRep, setSelectedRep] = useState<string>('all');
  const [timeline, setTimeline] = useState<DailyReportsTimeline>(opts?.initialTimeline ?? 'today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [teamMembers, setTeamMembers] = useState<{ id: string; full_name: string; role?: string }[]>([]);

  const isManager =
    role === 'org' || role === 'super_admin' || role === 'manager';
  const isSalesRep = role === 'sales_representative';
  /** Sales reps and managers can submit their own daily update. */
  const canSubmit = isSalesRep || role === 'manager';

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      // Ensure existing call-log days have matching daily reports before listing.
      if (canSubmit) {
        try {
          await callLogsApi.syncDailyReportsFromCallLogs(60);
        } catch {
          /* non-blocking */
        }
      }
      const params: { user_id?: string } = {};
      if (isSalesRep && user?.id) params.user_id = user.id;
      const data = await api.dailyReports.list(params);
      setReports(data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [canSubmit, isSalesRep, user?.id]);

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
      return reportInTimeline(r, timeline, customFrom, customTo);
    });
  }, [reports, selectedRep, timeline, customFrom, customTo]);

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
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    teamMembers,
    isManager,
    isSalesRep,
    canSubmit,
    refetch: fetchReports,
  };
}
