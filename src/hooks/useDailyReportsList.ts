import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { aggregateByRep, mapToSalesReports, type DailyReportRecord } from '@/utils/analyticsHelpers';

export function useDailyReportsList() {
  const { user, role } = useAuth();
  const [reports, setReports] = useState<DailyReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRep, setSelectedRep] = useState<string>('all');
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

  const filteredReports =
    selectedRep === 'all' ? reports : reports.filter((r) => r.user_id === selectedRep);

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
    teamMembers,
    isManager,
    isSalesRep,
    refetch: fetchReports,
  };
}
