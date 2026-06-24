import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, TrendingUp, UserPlus, Loader2, Phone, FileText, CheckCircle, XCircle, Eye, ClipboardList, ChevronRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { DateRangeFilter, DateRange } from '@/components/DateRangeFilter';

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-700 border-blue-200',
  contacted: 'bg-amber-500/10 text-amber-700 border-amber-200',
  interested: 'bg-emerald-500/10 text-emerald-700 border-emerald-200',
  demo_scheduled: 'bg-indigo-500/10 text-indigo-700 border-indigo-200',
  demo_attended: 'bg-violet-500/10 text-violet-700 border-violet-200',
  considering: 'bg-orange-500/10 text-orange-700 border-orange-200',
  enrolled: 'bg-teal-500/10 text-teal-800 border-teal-200',
  converted: 'bg-green-500/10 text-green-700 border-green-200',
  lost: 'bg-red-500/10 text-red-700 border-red-200',
};

const ADMIN_ROLES = ['super_admin', 'admin', 'manager'];
const SALES_ROLES = ['sales_representative', 'manager'];

export default function MyReferrals() {
  const { profile, role, user } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [dailyReports, setDailyReports] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [selectedRep, setSelectedRep] = useState<string>('all');
  const [viewReport, setViewReport] = useState<any>(null);
  const [dateRange, setDateRange] = useState<DateRange>({});

  const isAdmin = role && ADMIN_ROLES.includes(role);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [leadsData, profilesData, reportsData] = await Promise.all([
        api.leads.list(),
        api.profiles.list(),
        api.dailyReports.list(),
      ]);
      const leads = Array.isArray(leadsData) ? leadsData : leadsData.data || leadsData.leads || [];
      const profiles = Array.isArray(profilesData)
        ? profilesData
        : profilesData.data || profilesData.profiles || [];
      const reports = Array.isArray(reportsData) ? reportsData : reportsData.data || reportsData.reports || [];
      setAllLeads(leads);
      setDailyReports(reports);
      setTeamMembers(profiles.filter((p: any) => p.user_id));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const userIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of teamMembers) map[p.user_id] = p.full_name || p.email || 'Unknown';
    return map;
  }, [teamMembers]);

  const codeToUserId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of teamMembers) if (p.referral_code) map[p.referral_code] = p.user_id;
    return map;
  }, [teamMembers]);

  // Sales reps for Team Overview and tracker filters
  const salesReps = useMemo(() => {
    const reps = teamMembers.filter((member: any) => SALES_ROLES.includes(member.role));
    return reps.length > 0 ? reps : teamMembers;
  }, [teamMembers]);

  // Date-filtered data
  const dateFilteredLeads = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return allLeads;
    return allLeads.filter(l => {
      const d = new Date(l.created_at);
      if (dateRange.from && d < dateRange.from) return false;
      if (dateRange.to && d > new Date(dateRange.to.getTime() + 86400000)) return false;
      return true;
    });
  }, [allLeads, dateRange]);

  const dateFilteredReports = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return dailyReports;
    return dailyReports.filter(r => {
      const d = new Date(r.report_date);
      if (dateRange.from && d < dateRange.from) return false;
      if (dateRange.to && d > new Date(dateRange.to.getTime() + 86400000)) return false;
      return true;
    });
  }, [dailyReports, dateRange]);

  const repStats = useMemo(() => {
    const stats: Record<string, {
      name: string; email: string; userId: string;
      totalAssigned: number; formGenerated: number; converted: number; lost: number; inPipeline: number;
      totalCalls: number; totalFollowups: number; totalDemos: number; totalConversions: number; reportCount: number;
    }> = {};

    for (const p of salesReps) {
      stats[p.user_id] = {
        name: p.full_name || p.email || 'Unknown',
        email: p.email || '',
        userId: p.user_id,
        totalAssigned: 0, formGenerated: 0, converted: 0, lost: 0, inPipeline: 0,
        totalCalls: 0, totalFollowups: 0, totalDemos: 0, totalConversions: 0, reportCount: 0,
      };
    }

    for (const lead of dateFilteredLeads) {
      // Assigned leads
      if (lead.assigned_to && stats[lead.assigned_to]) {
        stats[lead.assigned_to].totalAssigned++;
        if (lead.status === 'converted' || lead.status === 'enrolled') stats[lead.assigned_to].converted++;
        else if (lead.status === 'lost') stats[lead.assigned_to].lost++;
        else if (['interested', 'demo_scheduled', 'demo_attended', 'considering'].includes(lead.status)) stats[lead.assigned_to].inPipeline++;
      }
      // Form generated leads
      if (lead.referred_by) {
        const uid = codeToUserId[lead.referred_by];
        if (uid && stats[uid]) stats[uid].formGenerated++;
      }
    }

    for (const report of dateFilteredReports) {
      if (report.user_id && stats[report.user_id]) {
        stats[report.user_id].totalCalls += Number(report.total_calls) || 0;
        stats[report.user_id].totalFollowups += Number(report.total_followups) || 0;
        stats[report.user_id].totalDemos += Number(report.total_demos) || 0;
        stats[report.user_id].totalConversions += Number(report.total_conversions) || 0;
        stats[report.user_id].reportCount++;
      }
    }

    return Object.values(stats).sort((a, b) => b.totalAssigned - a.totalAssigned);
  }, [salesReps, dateFilteredLeads, dateFilteredReports, codeToUserId]);

  const filteredStats = useMemo(() => {
    if (selectedRep === 'all') return repStats;
    return repStats.filter(s => s.userId === selectedRep);
  }, [repStats, selectedRep]);

  const getLeadCollectorUserId = (lead: any) => {
    if (!lead?.referred_by) return null;
    return codeToUserId[lead.referred_by] || null;
  };

  const getLeadCollectorName = (lead: any) => {
    const collectorUserId = getLeadCollectorUserId(lead) || lead.assigned_to;
    return collectorUserId ? userIdToName[collectorUserId] || null : null;
  };

  // Get leads for selected rep
  const selectedRepLeads = useMemo(() => {
    if (selectedRep === 'all') return dateFilteredLeads.slice(0, 20);
    return dateFilteredLeads.filter((lead) => {
      const collectorUserId = getLeadCollectorUserId(lead);
      return lead.assigned_to === selectedRep || collectorUserId === selectedRep;
    });
  }, [selectedRep, dateFilteredLeads, codeToUserId]);

  // Get daily reports for selected rep
  const selectedRepReports = useMemo(() => {
    if (selectedRep === 'all') return dateFilteredReports.slice(0, 10);
    return dateFilteredReports.filter(r => r.user_id === selectedRep).slice(0, 20);
  }, [selectedRep, dateFilteredReports]);

  const totalCollectedLeads = useMemo(() => {
    if (selectedRep === 'all') return dateFilteredLeads.length;

    return dateFilteredLeads.filter((lead) => {
      const referredUserId = lead.referred_by ? codeToUserId[lead.referred_by] : null;
      return lead.assigned_to === selectedRep || referredUserId === selectedRep;
    }).length;
  }, [selectedRep, dateFilteredLeads, codeToUserId]);

  // Totals
  const totals = useMemo(() => {
    const stats = filteredStats;
    const formGenerated = stats.reduce((s, r) => s + r.formGenerated, 0);
    return {
      totalCollected: totalCollectedLeads,
      formGenerated,
      converted: stats.reduce((s, r) => s + r.converted, 0),
      totalCalls: stats.reduce((s, r) => s + r.totalCalls, 0),
    };
  }, [filteredStats, totalCollectedLeads]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Sales Rep Tracker</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor performance, daily updates & collected leads</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedRep} onValueChange={setSelectedRep}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <Users className="h-4 w-4 mr-2" />
              <SelectValue placeholder="All Representatives" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Representatives</SelectItem>
              {salesReps.map(p => <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.email}</SelectItem>)}
            </SelectContent>
          </Select>
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Leads Collected', value: totals.totalCollected, icon: UserPlus, color: 'text-blue-600', bg: 'bg-blue-500/10' },
          { label: 'Form Generated', value: totals.formGenerated, icon: FileText, color: 'text-purple-600', bg: 'bg-purple-500/10' },
          { label: 'Enroll', value: totals.converted, icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-500/10' },
          { label: 'Total Calls Made', value: totals.totalCalls, icon: Phone, color: 'text-amber-600', bg: 'bg-amber-500/10' },
        ].map(card => (
          <Card key={card.label} className="border-border/50 shadow-none">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2.5">
                <div className={`h-8 w-8 rounded-lg ${card.bg} flex items-center justify-center`}><card.icon className={`h-4 w-4 ${card.color}`} /></div>
                <div><p className="text-xl font-bold leading-none">{card.value}</p><p className="text-[11px] text-muted-foreground mt-0.5">{card.label}</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="overview" className="flex-1 sm:flex-none">Team Overview</TabsTrigger>
          <TabsTrigger value="leads" className="flex-1 sm:flex-none">Collected Leads</TabsTrigger>
          <TabsTrigger value="daily" className="flex-1 sm:flex-none">Daily Updates</TabsTrigger>
        </TabsList>

        {/* Team Overview Tab */}
        <TabsContent value="overview">
          <Card className="border-border/50 shadow-none">
            <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><Users className="h-4 w-4" />Rep Performance Summary</CardTitle></CardHeader>
            <CardContent>
              {isMobile ? (
                <div className="space-y-3">
                  {filteredStats.length === 0 ? <p className="text-center py-8 text-muted-foreground text-sm">No data</p> : filteredStats.map((rep, i) => (
                    <div key={rep.userId} className="border border-border/50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-semibold text-sm">{rep.name}</p>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setSelectedRep(rep.userId)}>
                          <Eye className="h-3 w-3 mr-1" />Details
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <span className="text-muted-foreground">Assigned: <span className="font-medium text-foreground">{rep.totalAssigned}</span></span>
                        <span className="text-muted-foreground">Form: <span className="font-medium text-foreground">{rep.formGenerated}</span></span>
                        <span className="text-muted-foreground">Enroll: <span className="font-medium text-green-600">{rep.converted}</span></span>
                        <span className="text-muted-foreground">Lost: <span className="font-medium text-red-500">{rep.lost}</span></span>
                        <span className="text-muted-foreground">Calls: <span className="font-medium text-foreground">{rep.totalCalls}</span></span>
                        <span className="text-muted-foreground">Follow-ups: <span className="font-medium text-foreground">{rep.totalFollowups}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-center">Assigned</TableHead>
                      <TableHead className="text-center">Form Leads</TableHead>
                      <TableHead className="text-center">In Pipeline</TableHead>
                      <TableHead className="text-center">Enroll</TableHead>
                      <TableHead className="text-center">Lost</TableHead>
                      <TableHead className="text-center">Calls</TableHead>
                      <TableHead className="text-center">Follow-ups</TableHead>
                      <TableHead className="text-center">Reports</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStats.length === 0 ? (
                      <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No data</TableCell></TableRow>
                    ) : filteredStats.map((rep, i) => (
                      <TableRow key={rep.userId}>
                        <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-semibold text-sm">{rep.name}</p>
                            <p className="text-xs text-muted-foreground">{rep.email}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-medium">{rep.totalAssigned}</TableCell>
                        <TableCell className="text-center"><Badge variant="secondary" className="text-xs">{rep.formGenerated}</Badge></TableCell>
                        <TableCell className="text-center text-amber-600">{rep.inPipeline}</TableCell>
                        <TableCell className="text-center text-green-600 font-semibold">{rep.converted}</TableCell>
                        <TableCell className="text-center text-red-500">{rep.lost}</TableCell>
                        <TableCell className="text-center">{rep.totalCalls}</TableCell>
                        <TableCell className="text-center">{rep.totalFollowups}</TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="text-xs">{rep.reportCount}</Badge></TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => navigate(`/referral-analytics?rep=${rep.userId}`)}>
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Collected Leads Tab */}
        <TabsContent value="leads">
          <Card className="border-border/50 shadow-none">
            <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><UserPlus className="h-4 w-4" />Collected Leads {selectedRep !== 'all' && `— ${userIdToName[selectedRep] || ''}`}</CardTitle></CardHeader>
            <CardContent>
              {isMobile ? (
                <div className="space-y-3">
                  {selectedRepLeads.length === 0 ? <p className="text-center py-8 text-muted-foreground text-sm">No leads found</p> : selectedRepLeads.map((lead: any, i: number) => (
                    <div key={lead.id} className="border border-border/50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-sm">{lead.name}</p>
                        <Badge variant="outline" className={`${statusColors[lead.status] || ''} capitalize text-xs`}>{lead.status === 'enrolled' ? 'Enroll' : (lead.status || 'new').replace(/_/g, ' ')}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{lead.college || lead.company || '—'}</p>
                      <p className="text-xs text-muted-foreground">{lead.email || '—'} · {lead.phone || ''}</p>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-xs text-muted-foreground">{new Date(lead.created_at).toLocaleDateString()}</p>
                        <p className="text-xs text-muted-foreground">Collected by: {getLeadCollectorName(lead) || 'Unassigned'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>College / Company</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Collected By</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedRepLeads.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No leads found</TableCell></TableRow>
                    ) : selectedRepLeads.map((lead: any, i: number) => (
                      <TableRow key={lead.id}>
                        <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                        <TableCell className="font-medium">{lead.name}</TableCell>
                        <TableCell className="text-sm">{lead.college || lead.company || '—'}</TableCell>
                        <TableCell>
                          <div className="text-sm">{lead.email || '—'}</div>
                          <div className="text-xs text-muted-foreground">{lead.phone || ''}</div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className={`${statusColors[lead.status] || ''} capitalize text-xs`}>{lead.status === 'enrolled' ? 'Enroll' : (lead.status || 'new').replace(/_/g, ' ')}</Badge></TableCell>
                        <TableCell className="text-sm">{getLeadCollectorName(lead) || <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(lead.created_at).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Daily Updates Tab */}
        <TabsContent value="daily">
          <Card className="border-border/50 shadow-none">
            <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><ClipboardList className="h-4 w-4" />Daily Reports {selectedRep !== 'all' && `— ${userIdToName[selectedRep] || ''}`}</CardTitle></CardHeader>
            <CardContent>
              {isMobile ? (
                <div className="space-y-3">
                  {selectedRepReports.length === 0 ? <p className="text-center py-8 text-muted-foreground text-sm">No daily reports found</p> : selectedRepReports.map((report: any) => (
                    <div key={report.id} className="border border-border/50 rounded-lg p-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setViewReport(report)}>
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-medium text-sm">{new Date(report.report_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        <p className="text-xs text-muted-foreground">{userIdToName[report.user_id] || 'Unknown'}</p>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-xs text-center">
                        <div><p className="font-bold">{report.total_calls || 0}</p><p className="text-muted-foreground">Calls</p></div>
                        <div><p className="font-bold">{report.total_followups || 0}</p><p className="text-muted-foreground">Follow-ups</p></div>
                        <div><p className="font-bold">{report.total_demos || 0}</p><p className="text-muted-foreground">Demos</p></div>
                        <div><p className="font-bold">{report.total_conversions || 0}</p><p className="text-muted-foreground">Conv.</p></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Rep Name</TableHead>
                      <TableHead className="text-center">Calls</TableHead>
                      <TableHead className="text-center">Follow-ups</TableHead>
                      <TableHead className="text-center">Demos</TableHead>
                      <TableHead className="text-center">Conversions</TableHead>
                      <TableHead>Summary</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedRepReports.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No daily reports found</TableCell></TableRow>
                    ) : selectedRepReports.map((report: any, i: number) => (
                      <TableRow key={report.id}>
                        <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                        <TableCell className="font-medium text-sm">{new Date(report.report_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</TableCell>
                        <TableCell className="text-sm">{userIdToName[report.user_id] || 'Unknown'}</TableCell>
                        <TableCell className="text-center">{report.total_calls || 0}</TableCell>
                        <TableCell className="text-center">{report.total_followups || 0}</TableCell>
                        <TableCell className="text-center">{report.total_demos || 0}</TableCell>
                        <TableCell className="text-center font-semibold text-green-600">{report.total_conversions || 0}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{report.summary || '—'}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setViewReport(report)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
                  { label: 'Conversions', value: viewReport.total_conversions || 0 },
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
