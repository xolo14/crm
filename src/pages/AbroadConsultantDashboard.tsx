import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { sendNotificationWithEmail } from '@/lib/notifications';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Users, Globe, Plane, FileCheck, IndianRupee, TrendingUp, ExternalLink,
  Shield, Activity, Loader2, UserPlus, MapPin, GraduationCap, ClipboardList
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { DateRangeFilter, DateRange } from '@/components/DateRangeFilter';
import { parseServerDateTime } from '@/lib/dateTime';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';

const COLORS = ['hsl(210, 70%, 50%)', 'hsl(162, 63%, 41%)', 'hsl(38, 92%, 50%)', 'hsl(0, 70%, 55%)', 'hsl(270, 60%, 55%)', 'hsl(330, 70%, 55%)', 'hsl(45, 80%, 50%)', 'hsl(180, 60%, 45%)'];
const SOURCE_LABELS: Record<string, string> = { google_ads: 'Google Ads', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', website: 'Website', google_forms: 'Google Forms', whatsapp: 'WhatsApp', referral: 'Referral', walkin: 'Walk-in', college_seminar: 'College Seminar', other: 'Other' };
const STATUS_LABELS: Record<string, string> = { new: 'New Inquiry', contacted: 'Contacted', interested: 'Interested', demo_scheduled: 'Counseling Scheduled', demo_attended: 'Counseling Done', considering: 'Application In Progress', enrolled: 'Enroll', converted: 'Visa Approved', lost: 'Dropped' };

export default function AbroadConsultantDashboard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [dateRange, setDateRange] = useState<DateRange>({});
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [studentsCount, setStudentsCount] = useState(0);
  const [activeStudents, setActiveStudents] = useState(0);
  const [coursesCount, setCoursesCount] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [pendingRevenue, setPendingRevenue] = useState(0);
  const [referralData, setReferralData] = useState<any[]>([]);
  const [recentLeads, setRecentLeads] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [unassignedLeads, setUnassignedLeads] = useState<any[]>([]);
  const [codeToName, setCodeToName] = useState<Record<string, string>>({});
  const [codeToUserId, setCodeToUserId] = useState<Record<string, string>>({});
  const [userIdToName, setUserIdToName] = useState<Record<string, string>>({});

  useEffect(() => { fetchData(); fetchTeam(); }, []);

  const fetchTeam = async () => {
    try {
      const data = await api.team.list();
      setTeamMembers((data.data || []).filter((m: any) => m.role === 'sales_representative' && m.is_active));
    } catch {}
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await api.profiles.dashboard();
      const allLeads = data.leads || [];
      setLeads(allLeads);
      setRecentLeads(allLeads.slice(0, 10));
      setUnassignedLeads(allLeads.filter((l: any) => !l.assigned_to));
      setStudentsCount(data.students_count || 0);
      setActiveStudents(data.active_students || 0);
      setCoursesCount(data.courses_count || 0);
      setTotalRevenue(data.total_revenue || 0);
      setPendingRevenue(data.pending_revenue || 0);

      const profiles = data.profiles || [];
      const nameMap: Record<string, string> = {};
      const userIdMap: Record<string, string> = {};
      const uidNameMap: Record<string, string> = {};
      const refMap = new Map<string, { rep_name: string; referral_code: string; leads_count: number; converted: number }>();
      for (const p of profiles) {
        uidNameMap[p.user_id] = p.full_name || 'Unknown';
        if (p.referral_code) {
          refMap.set(p.referral_code, { rep_name: p.full_name || 'Unknown', referral_code: p.referral_code, leads_count: 0, converted: 0 });
          nameMap[p.referral_code] = p.full_name || 'Unknown';
          userIdMap[p.referral_code] = p.user_id;
        }
      }
      setCodeToName(nameMap);
      setCodeToUserId(userIdMap);
      setUserIdToName(uidNameMap);
      for (const lead of allLeads) {
        if (lead.referred_by && refMap.has(lead.referred_by)) {
          const e = refMap.get(lead.referred_by)!;
          e.leads_count++;
          if (lead.status === 'converted' || lead.status === 'enrolled') e.converted++;
        }
      }
      setReferralData(Array.from(refMap.values()).filter(r => r.leads_count > 0).sort((a, b) => b.leads_count - a.leads_count));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const filteredLeads = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return leads;
    return leads.filter(l => { const d = parseServerDateTime(l.created_at); if (!d) return true; const t = d.getTime(); if (dateRange.from && t < dateRange.from.getTime()) return false; if (dateRange.to && t > dateRange.to.getTime()) return false; return true; });
  }, [leads, dateRange]);

  const leadsByStatus = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of filteredLeads) { const s = l.status || 'new'; c[s] = (c[s] || 0) + 1; }
    return Object.entries(c).map(([name, value]) => ({ name: STATUS_LABELS[name] || name, value }));
  }, [filteredLeads]);

  const leadsBySource = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of filteredLeads) { const s = l.source || 'other'; c[s] = (c[s] || 0) + 1; }
    return Object.entries(c).map(([name, value]) => ({ name: SOURCE_LABELS[name] || name, value })).sort((a, b) => b.value - a.value);
  }, [filteredLeads]);

  const dailyTrend = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of filteredLeads) { const d = new Date(l.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }); map[d] = (map[d] || 0) + 1; }
    return Object.entries(map).slice(-14).map(([date, count]) => ({ date, leads: count }));
  }, [filteredLeads]);

  const totalLeads = filteredLeads.length;
  const converted = filteredLeads.filter(l => l.status === 'converted' || l.status === 'enrolled').length;
  const convRate = totalLeads > 0 ? Math.round((converted / totalLeads) * 100) : 0;
  const inProgress = filteredLeads.filter(l => l.status === 'considering').length;
  const counselingDone = filteredLeads.filter(l => l.status === 'demo_attended').length;

  const handleAssignLead = async (leadId: string, repId: string) => {
    try {
      await api.leads.update(leadId, { assigned_to: repId });
      const repName = teamMembers.find(m => m.id === repId)?.full_name || 'Counselor';
      const lead = leads.find(l => l.id === leadId);
      setUnassignedLeads(prev => prev.filter(l => l.id !== leadId));
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, assigned_to: repId } : l));
      toast({ title: `Inquiry assigned to ${repName}` });
      await sendNotificationWithEmail({ userId: repId, title: 'New Inquiry Assigned', message: `Student "${lead?.name || 'Unknown'}" has been assigned to you.`, type: 'lead_assigned', link: '/leads', leadName: lead?.name || 'Unknown', assignedByName: profile?.full_name || 'Admin' });
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
  };

  const fmt = (val: number) => val >= 100000 ? `₹${(val / 100000).toFixed(1)}L` : val >= 1000 ? `₹${(val / 1000).toFixed(1)}K` : `₹${val}`;

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-200 text-xs"><Globe className="h-3 w-3 mr-1" />Abroad Consultant</Badge>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight mt-1">Welcome{profile?.full_name ? `, ${profile.full_name}` : ''} ✈️</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Immigration & study abroad overview</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
          <a href="/apply" target="_blank" rel="noopener noreferrer"><Button variant="outline" size="sm" className="gap-1.5"><ExternalLink className="h-3.5 w-3.5" />{!isMobile && 'Inquiry Form'}</Button></a>
        </div>
      </div>

      {/* KPI Cards - Abroad Consultant specific */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 mb-5">
        {[
          { label: 'Total Inquiries', value: totalLeads, icon: Users, sub: `${unassignedLeads.length} unassigned`, bg: 'from-blue-500/10 to-indigo-500/10', ic: 'text-blue-600' },
          { label: 'Counseling Done', value: counselingDone, icon: ClipboardList, sub: 'sessions completed', bg: 'from-cyan-500/10 to-teal-500/10', ic: 'text-cyan-600' },
          { label: 'Applications', value: inProgress, icon: FileCheck, sub: 'in progress', bg: 'from-amber-500/10 to-orange-500/10', ic: 'text-amber-600' },
          { label: 'Visa Approved', value: converted, icon: Plane, sub: `${convRate}% success rate`, bg: 'from-emerald-500/10 to-green-500/10', ic: 'text-emerald-600' },
          { label: 'Students', value: studentsCount, icon: GraduationCap, sub: `${activeStudents} active`, bg: 'from-purple-500/10 to-pink-500/10', ic: 'text-purple-600' },
          { label: 'Revenue', value: fmt(totalRevenue), icon: IndianRupee, sub: `${fmt(pendingRevenue)} pending`, bg: 'from-green-500/10 to-emerald-500/10', ic: 'text-green-600' },
        ].map(c => (
          <Card key={c.label} className="border-border/50 shadow-none hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-3 pt-3"><CardTitle className="text-xs font-medium text-muted-foreground">{c.label}</CardTitle>
              <div className={`h-7 w-7 rounded-lg bg-gradient-to-br ${c.bg} flex items-center justify-center`}><c.icon className={`h-3.5 w-3.5 ${c.ic}`} /></div>
            </CardHeader>
            <CardContent className="px-3 pb-3"><div className="text-lg font-bold">{c.value}</div><p className="text-[10px] text-muted-foreground">{c.sub}</p></CardContent>
          </Card>
        ))}
      </div>

      {/* Application Pipeline - visual funnel */}
      <Card className="mb-5 border-border/50 shadow-none">
        <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><MapPin className="h-4 w-4" />Application Pipeline</CardTitle></CardHeader>
        <CardContent className="px-2 sm:px-4">
          {leadsByStatus.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
            <ResponsiveContainer width="100%" height={isMobile ? 200 : 260}>
              <BarChart data={leadsByStatus} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis dataKey="name" type="category" tick={{ fontSize: isMobile ? 8 : 10 }} width={isMobile ? 80 : 120} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="value" fill="hsl(210, 70%, 50%)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Daily Trend + Source breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <Card className="border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Activity className="h-4 w-4" />Daily Inquiry Trend</CardTitle></CardHeader>
          <CardContent className="px-2 sm:px-4">
            {dailyTrend.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No trend data</p> : (
              <ResponsiveContainer width="100%" height={isMobile ? 180 : 240}>
                <LineChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: isMobile ? 8 : 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12 }} />
                  <Line type="monotone" dataKey="leads" stroke="hsl(210, 70%, 50%)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm font-semibold">Inquiries by Source</CardTitle></CardHeader>
          <CardContent className="px-2 sm:px-4">
            {leadsBySource.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
              <ResponsiveContainer width="100%" height={isMobile ? 200 : 240}>
                <PieChart><Pie data={leadsBySource} cx="50%" cy="50%" innerRadius={isMobile ? 40 : 60} outerRadius={isMobile ? 70 : 90} paddingAngle={3} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {leadsBySource.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie><Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12 }} /></PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Counselors by Referral */}
      {referralData.length > 0 && (
        <Card className="mb-5 border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Users className="h-4 w-4" />Counselor Performance</CardTitle></CardHeader>
          <CardContent className="px-0 sm:px-4">
            <Table>
              <TableHeader><TableRow><TableHead>Counselor</TableHead><TableHead>Code</TableHead><TableHead className="text-center">Inquiries</TableHead><TableHead className="text-center">Visa Approved</TableHead><TableHead className="text-center">Rate</TableHead></TableRow></TableHeader>
              <TableBody>
                {referralData.map(r => (
                  <TableRow key={r.referral_code}><TableCell className="font-medium">{r.rep_name}</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{r.referral_code}</TableCell><TableCell className="text-center">{r.leads_count}</TableCell><TableCell className="text-center text-emerald-600 font-semibold">{r.converted}</TableCell><TableCell className="text-center">{r.leads_count > 0 ? `${Math.round((r.converted / r.leads_count) * 100)}%` : '0%'}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Unassigned Inquiries */}
      {unassignedLeads.length > 0 && (
        <Card className="mb-5 border-blue-200 bg-blue-500/5 shadow-none">
          <CardHeader className="px-3 sm:px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-blue-600" />
              Unassigned Inquiries ({unassignedLeads.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-4">
            <Table>
              <TableHeader><TableRow><TableHead>Student Name</TableHead><TableHead>Contact</TableHead><TableHead>Source</TableHead><TableHead>Date</TableHead><TableHead className="w-28">Assign</TableHead></TableRow></TableHeader>
              <TableBody>
                {unassignedLeads.slice(0, 15).map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.email || l.phone || '—'}</TableCell>
                    <TableCell className="capitalize text-sm">{SOURCE_LABELS[l.source] || l.source || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(l.created_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="gap-1 h-7 text-xs"><UserPlus className="h-3 w-3" />Assign</Button></DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {teamMembers.map(m => <DropdownMenuItem key={m.id} onClick={() => handleAssignLead(l.id, m.id)}>{m.full_name}</DropdownMenuItem>)}
                          {teamMembers.length === 0 && <DropdownMenuItem disabled>No counselors available</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Recent Inquiries */}
      <Card className="border-border/50 shadow-none">
        <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm font-semibold">Recent Student Inquiries</CardTitle></CardHeader>
        <CardContent className="px-0 sm:px-4">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Referred By</TableHead><TableHead>Assigned To</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
            <TableBody>
              {recentLeads.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{l.email || l.phone || '—'}</TableCell>
                  <TableCell className="text-sm">{l.referred_by && codeToName[l.referred_by] ? <span className="text-blue-600 font-medium">{codeToName[l.referred_by]}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-sm">{l.assigned_to && userIdToName[l.assigned_to] ? <span className="font-medium">{userIdToName[l.assigned_to]}</span> : <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize text-xs">{STATUS_LABELS[l.status] || (l.status || 'new').replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{new Date(l.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
