import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { Users, TrendingUp, UserPlus, Award, Loader2, Filter, Phone, ClipboardList, Eye, CheckCircle, XCircle } from 'lucide-react';
import { DateRangeFilter, DateRange } from '@/components/DateRangeFilter';
import { parseServerDateTime } from '@/lib/dateTime';

const STATUS_LABELS: Record<string, string> = {
  new: 'New', contacted: 'Contacted', interested: 'Interested',
  demo_scheduled: 'Demo Scheduled', demo_attended: 'Demo Attended',
  considering: 'Considering', enrolled: 'Enroll', converted: 'Enroll', lost: 'Lost',
};

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-700 border-blue-200',
  contacted: 'bg-amber-500/10 text-amber-700 border-amber-200',
  interested: 'bg-emerald-500/10 text-emerald-700 border-emerald-200',
  demo_scheduled: 'bg-indigo-500/10 text-indigo-700 border-indigo-200',
  demo_attended: 'bg-violet-500/10 text-violet-700 border-violet-200',
  considering: 'bg-orange-500/10 text-orange-700 border-orange-200',
  enrolled: 'bg-teal-500/10 text-teal-800 border-teal-200',
  converted: 'bg-teal-500/10 text-teal-800 border-teal-200',
  lost: 'bg-red-500/10 text-red-700 border-red-200',
};

const PIE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#6366f1', '#8b5cf6', '#f97316', '#22c55e', '#ef4444'];

export default function ReferralAnalytics() {
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [dailyReports, setDailyReports] = useState<any[]>([]);
  const [selectedRep, setSelectedRep] = useState(searchParams.get('rep') || 'all');
  const [dateRange, setDateRange] = useState<DateRange>({});
  const [viewReport, setViewReport] = useState<any>(null);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [profilesData, leadsData, reportsData] = await Promise.all([
        api.profiles.list(), api.leads.list(), api.dailyReports.list()
      ]);
      const parsedProfiles = Array.isArray(profilesData)
        ? profilesData
        : profilesData.data || profilesData.profiles || [];
      setProfiles(parsedProfiles.filter((p: any) => p.user_id));
      setAllLeads(Array.isArray(leadsData) ? leadsData : leadsData.data || leadsData.leads || []);
      setDailyReports(Array.isArray(reportsData) ? reportsData : reportsData.data || reportsData.reports || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const userIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of profiles) map[p.user_id] = p.full_name || p.email || 'Unknown';
    return map;
  }, [profiles]);

  const codeToUserId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of profiles) {
      const code = typeof p.referral_code === 'string' ? p.referral_code.trim() : '';
      if (!code) continue;
      map[code] = p.user_id;
      map[code.toUpperCase()] = p.user_id;
    }
    return map;
  }, [profiles]);

  const getLeadCollectorUserId = (lead: any) => {
    const code = typeof lead?.referred_by === 'string' ? lead.referred_by.trim() : '';
    const referredUserId = code ? (codeToUserId[code] || codeToUserId[code.toUpperCase()] || null) : null;
    return referredUserId || lead?.assigned_to || null;
  };

  const selectedRepName = selectedRep !== 'all' ? (userIdToName[selectedRep] || 'Unknown') : 'All Representatives';

  // Filter leads by rep and date
  const filteredLeads = useMemo(() => {
    let result = allLeads;
    if (selectedRep !== 'all') {
      result = result.filter((l) => {
        const code = typeof l?.referred_by === 'string' ? l.referred_by.trim() : '';
        const referredUserId = code ? (codeToUserId[code] || codeToUserId[code.toUpperCase()] || null) : null;
        return l.assigned_to === selectedRep || referredUserId === selectedRep;
      });
    }
    if (dateRange.from || dateRange.to) {
      result = result.filter(l => {
        const d = parseServerDateTime(l.created_at);
        if (!d) return true;
        if (dateRange.from && d.getTime() < dateRange.from.getTime()) return false;
        if (dateRange.to && d.getTime() > dateRange.to.getTime()) return false;
        return true;
      });
    }
    return result;
  }, [allLeads, selectedRep, dateRange, codeToUserId]);

  // Filter daily reports by rep and date
  const filteredReports = useMemo(() => {
    let result = dailyReports;
    if (selectedRep !== 'all') {
      result = result.filter(r => r.user_id === selectedRep);
    }
    if (dateRange.from || dateRange.to) {
      result = result.filter(r => {
        const d = parseServerDateTime(r.report_date);
        if (!d) return true;
        if (dateRange.from && d.getTime() < dateRange.from.getTime()) return false;
        if (dateRange.to && d.getTime() > dateRange.to.getTime()) return false;
        return true;
      });
    }
    return result;
  }, [dailyReports, selectedRep, dateRange]);

  // Lead status funnel
  const funnelData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of filteredLeads) {
      let s = l.status || 'new';
      if (s === 'converted') s = 'enrolled';
      counts[s] = (counts[s] || 0) + 1;
    }
    const order = ['new', 'contacted', 'interested', 'demo_scheduled', 'demo_attended', 'considering', 'enrolled', 'lost'];
    return order.filter(s => counts[s]).map(s => ({ name: STATUS_LABELS[s] || s, value: counts[s] || 0 }));
  }, [filteredLeads]);

  // Daily activity trend from reports
  const activityTrend = useMemo(() => {
    const map: Record<string, { date: string; calls: number; followups: number; demos: number; conversions: number }> = {};
    for (const r of filteredReports) {
      const day = new Date(r.report_date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
      if (!map[day]) map[day] = { date: day, calls: 0, followups: 0, demos: 0, conversions: 0 };
      map[day].calls += Number(r.total_calls) || 0;
      map[day].followups += Number(r.total_followups) || 0;
      map[day].demos += Number(r.total_demos) || 0;
      map[day].conversions += Number(r.total_conversions) || 0;
    }
    return Object.values(map);
  }, [filteredReports]);

  // KPIs
  const totalLeads = filteredLeads.length;
  const converted = filteredLeads.filter(l => l.status === 'converted' || l.status === 'enrolled').length;
  const inPipeline = filteredLeads.filter(l => ['interested', 'demo_scheduled', 'demo_attended'].includes(l.status)).length;
  const totalCalls = filteredReports.reduce((s, r) => s + (Number(r.total_calls) || 0), 0);
  const totalFollowups = filteredReports.reduce((s, r) => s + (Number(r.total_followups) || 0), 0);
  const convRate = totalLeads > 0 ? Math.round((converted / totalLeads) * 100) : 0;

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Rep Performance</h1>
          <p className="text-sm text-muted-foreground mt-1">Detailed analytics for {selectedRepName}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedRep} onValueChange={setSelectedRep}>
            <SelectTrigger className="w-full sm:w-[220px]"><Filter className="h-4 w-4 mr-2" /><SelectValue placeholder="All Reps" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Representatives</SelectItem>
              {profiles.map(p => <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.email}</SelectItem>)}
            </SelectContent>
          </Select>
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {[
          { label: 'Total Leads', value: totalLeads, icon: UserPlus, color: 'text-blue-600', bg: 'bg-blue-500/10' },
          { label: 'In Pipeline', value: inPipeline, icon: Users, color: 'text-amber-600', bg: 'bg-amber-500/10' },
          { label: 'Enroll', value: converted, icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-500/10' },
          { label: 'Conv. Rate', value: `${convRate}%`, icon: TrendingUp, color: 'text-teal-600', bg: 'bg-teal-500/10' },
          { label: 'Total Calls', value: totalCalls, icon: Phone, color: 'text-indigo-600', bg: 'bg-indigo-500/10' },
          { label: 'Follow-ups', value: totalFollowups, icon: ClipboardList, color: 'text-purple-600', bg: 'bg-purple-500/10' },
        ].map(card => (
          <Card key={card.label} className="border-border/50 shadow-none">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2">
                <div className={`h-8 w-8 rounded-lg ${card.bg} flex items-center justify-center`}><card.icon className={`h-4 w-4 ${card.color}`} /></div>
                <div><p className="text-lg font-bold leading-none">{card.value}</p><p className="text-[10px] text-muted-foreground mt-0.5">{card.label}</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card className="border-border/50 shadow-none">
          <CardHeader><CardTitle className="text-base font-semibold">Lead Status Funnel</CardTitle></CardHeader>
          <CardContent>
            {funnelData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
              <ResponsiveContainer width="100%" height={isMobile ? 200 : 280}>
                <BarChart data={funnelData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: isMobile ? 8 : 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12 }} />
                  <Bar dataKey="value" fill="hsl(162, 63%, 41%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-none">
          <CardHeader><CardTitle className="text-base font-semibold">Daily Activity Trend</CardTitle></CardHeader>
          <CardContent>
            {activityTrend.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
              <ResponsiveContainer width="100%" height={isMobile ? 200 : 280}>
                <LineChart data={activityTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: isMobile ? 8 : 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12 }} />
                  <Line type="monotone" dataKey="calls" stroke="hsl(200, 70%, 50%)" strokeWidth={2} name="Calls" />
                  <Line type="monotone" dataKey="followups" stroke="hsl(280, 70%, 50%)" strokeWidth={2} name="Follow-ups" />
                  <Line type="monotone" dataKey="conversions" stroke="hsl(140, 70%, 45%)" strokeWidth={2} name="Enroll" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Leads & Daily Reports side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/50 shadow-none">
          <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><UserPlus className="h-4 w-4" />Recent Collected Leads</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {filteredLeads.length === 0 ? <p className="text-center py-8 text-muted-foreground text-sm">No leads</p> : filteredLeads.slice(0, 15).map((lead: any, i: number) => (
                <div key={lead.id} className="flex items-center justify-between border border-border/50 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{lead.name}</p>
                    <p className="text-xs text-muted-foreground">{lead.college || lead.company || '—'} · {userIdToName[getLeadCollectorUserId(lead)] || 'Unassigned'}</p>
                  </div>
                  <Badge variant="outline" className={`${statusColors[lead.status] || ''} capitalize text-xs ml-2 shrink-0`}>{(lead.status || 'new').replace(/_/g, ' ')}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-none">
          <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><ClipboardList className="h-4 w-4" />Recent Daily Reports</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {filteredReports.length === 0 ? <p className="text-center py-8 text-muted-foreground text-sm">No reports</p> : filteredReports.slice(0, 10).map((report: any) => (
                <div key={report.id} className="flex items-center justify-between border border-border/50 rounded-lg px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setViewReport(report)}>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{new Date(report.report_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                    <p className="text-xs text-muted-foreground">{userIdToName[report.user_id] || 'Unknown'}</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{report.total_calls || 0} calls</span>
                    <span className="text-green-600 font-medium">{report.total_conversions || 0} conv.</span>
                    <Eye className="h-3.5 w-3.5" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* View Report Dialog */}
      <Dialog open={!!viewReport} onOpenChange={() => setViewReport(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Daily Report — {viewReport && new Date(viewReport.report_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</DialogTitle>
          </DialogHeader>
          {viewReport && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">By: <span className="font-medium text-foreground">{userIdToName[viewReport.user_id] || 'Unknown'}</span></p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Calls', value: viewReport.total_calls || 0 },
                  { label: 'Follow-ups', value: viewReport.total_followups || 0 },
                  { label: 'Demos', value: viewReport.total_demos || 0 },
                  { label: 'Enroll', value: viewReport.total_conversions || 0 },
                  { label: 'New Leads Contacted', value: viewReport.new_leads_contacted || 0 },
                ].map(item => (
                  <div key={item.label} className="bg-muted/50 rounded-lg p-3">
                    <p className="text-lg font-bold">{item.value}</p>
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                  </div>
                ))}
              </div>
              {viewReport.summary && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Summary</p>
                  <p className="text-sm bg-muted/30 rounded-lg p-3">{viewReport.summary}</p>
                </div>
              )}
              {viewReport.challenges && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Challenges</p>
                  <p className="text-sm bg-muted/30 rounded-lg p-3">{viewReport.challenges}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
