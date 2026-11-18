import { useState, useEffect, useMemo, useCallback } from 'react';
import { isInactiveUser, isTestAccount } from '@/lib/reportableUsers';
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
  const [timeline, setTimeline] = useState<DailyReportsTimeline>(opts?.initialTimeline ?? 'last_7_days');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [teamMembers, setTeamMembers] = useState<{ id: string; full_name: string; role?: string }[]>([]);
  const [excludedUserIds, setExcludedUserIds] = useState<Set<string>>(new Set());

  const isManager =
    role === 'org' ||
    role === 'super_admin' ||
    role === 'manager' ||
    role === 'operational_manager';
  const isSalesRep = role === 'sales_representative';
  /** Sales reps, managers, and OMs can submit their own daily update. */
  const canSubmit = isSalesRep || role === 'manager' || role === 'operational_manager';

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params: { user_id?: string } = {};
      if (isSalesRep && user?.id) params.user_id = user.id;
      // List first so the page is not stuck on a spinner while sync walks
      // up to 150 reps × 730 call_dates (can take minutes on Hostinger).
      const data = await api.dailyReports.list(params);
      setReports(Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
    // Daily reports are rebuilt from call logs by the nightly cron_sync_daily_reports.php
    // job (and on every logged call); viewing this page no longer writes anything.
  }, [isSalesRep, user?.id]);

  const fetchTeam = useCallback(async () => {
    try {
      const data = await api.team.list();
      const all = (data.data || []) as { id: string; full_name: string; role?: string; is_active?: unknown; email?: string }[];
      // Test accounts drop out entirely. Deactivated reps keep their past reports in the
      // totals and leaderboard, and stay selectable (marked inactive) in the rep picker.
      setExcludedUserIds(new Set(all.filter((m) => isTestAccount(m)).map((m) => String(m.id))));
      setTeamMembers(
        all
          .filter((m) => m.role === 'sales_representative' && !isTestAccount(m))
          .map((m) => (isInactiveUser(m) ? { ...m, full_name: `${m.full_name} (inactive)` } : m)),
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
      if (excludedUserIds.has(String(r.user_id))) return false;
      if (selectedRep !== 'all' && r.user_id !== selectedRep) return false;
      return reportInTimeline(r, timeline, customFrom, customTo);
    });
  }, [reports, selectedRep, timeline, customFrom, customTo, excludedUserIds]);

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
