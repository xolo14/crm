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
import { Users, GraduationCap, IndianRupee, TrendingUp, UserCog, Target, CheckCircle2, ClipboardList, Loader2, Link2, UserPlus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { DateRangeFilter, DateRange } from '@/components/DateRangeFilter';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';

const COLORS = ['hsl(162, 63%, 41%)', 'hsl(200, 70%, 50%)', 'hsl(38, 92%, 50%)', 'hsl(0, 70%, 55%)', 'hsl(270, 60%, 55%)', 'hsl(330, 70%, 55%)'];
const STATUS_LABELS: Record<string, string> = { new: 'New', contacted: 'Contacted', interested: 'Interested', demo_scheduled: 'Demo Sched.', demo_attended: 'Demo Attend.', considering: 'Considering', enrolled: 'Enroll', converted: 'Enroll', lost: 'Lost' };

export default function ManagerDashboard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [dateRange, setDateRange] = useState<DateRange>({});
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [studentsCount, setStudentsCount] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [pendingRevenue, setPendingRevenue] = useState(0);
  const [referralData, setReferralData] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [unassignedLeads, setUnassignedLeads] = useState<any[]>([]);
  const [codeToName, setCodeToName] = useState<Record<string, string>>({});
  const [codeToUserId, setCodeToUserId] = useState<Record<string, string>>({});

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
      const [dashData, tasksData] = await Promise.all([api.profiles.dashboard(), api.tasks.list()]);
      const allLeads = dashData.leads || [];
      setLeads(allLeads);
      setUnassignedLeads(allLeads.filter((l: any) => !l.assigned_to));
      setStudentsCount(dashData.students_count || 0);
      setTotalRevenue(dashData.total_revenue || 0);
      setPendingRevenue(dashData.pending_revenue || 0);
      setTasks(Array.isArray(tasksData) ? tasksData.slice(0, 8) : (tasksData.tasks || []).slice(0, 8));

      const profiles = dashData.profiles || [];
      const refLeads = dashData.leads || [];
      const nameMap: Record<string, string> = {};
      const userIdMap: Record<string, string> = {};
      const refMap = new Map<string, { rep_name: string; leads_count: number; converted: number }>();
      for (const p of profiles) { if (p.referral_code) { refMap.set(p.referral_code, { rep_name: p.full_name || 'Unknown', leads_count: 0, converted: 0 }); nameMap[p.referral_code] = p.full_name || 'Unknown'; userIdMap[p.referral_code] = p.user_id; } }
      setCodeToName(nameMap);
      setCodeToUserId(userIdMap);
      for (const l of refLeads) { if (l.referred_by && refMap.has(l.referred_by)) { const e = refMap.get(l.referred_by)!; e.leads_count++; if (l.status === 'converted' || l.status === 'enrolled') e.converted++; } }
      setReferralData(Array.from(refMap.values()).filter(r => r.leads_count > 0).sort((a, b) => b.leads_count - a.leads_count));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const filteredLeads = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return leads;
    return leads.filter(l => { const d = new Date(l.created_at); if (dateRange.from && d < dateRange.from) return false; if (dateRange.to && d > new Date(dateRange.to.getTime() + 86400000)) return false; return true; });
  }, [leads, dateRange]);

  const leadsByStatus = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of filteredLeads) {
      let key = l.status || 'new';
      if (key === 'converted') key = 'enrolled';
      c[key] = (c[key] || 0) + 1;
    }
    return Object.entries(c).map(([name, value]) => ({ name: STATUS_LABELS[name] || name, value }));
  }, [filteredLeads]);

  const totalLeads = filteredLeads.length;
  const converted = filteredLeads.filter(l => l.status === 'converted' || l.status === 'enrolled').length;
  const inPipeline = filteredLeads.filter(l => ['interested', 'demo_scheduled', 'demo_attended'].includes(l.status)).length;
  const convRate = totalLeads > 0 ? Math.round((converted / totalLeads) * 100) : 0;
  const fmt = (v: number) => v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(1)}K` : `₹${v}`;
  const pendingTasks = tasks.filter(t => t.status !== 'completed').length;

  const handleAssignLead = async (leadId: string, repId: string) => {
    try {
      await api.leads.update(leadId, { assigned_to: repId });
      const repName = teamMembers.find(m => m.id === repId)?.full_name || 'Rep';
      const lead = leads.find(l => l.id === leadId);
      setUnassignedLeads(prev => prev.filter(l => l.id !== leadId));
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, assigned_to: repId } : l));
      toast({ title: `Lead assigned to ${repName}` });
      await sendNotificationWithEmail({
        userId: repId,
        title: 'New Lead Assigned',
        message: `Lead "${lead?.name || 'Unknown'}" has been assigned to you.`,
        type: 'lead_assigned',
        link: '/leads',
        leadName: lead?.name || 'Unknown',
        assignedByName: profile?.full_name || 'Manager',
      });
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-200 text-xs"><UserCog className="h-3 w-3 mr-1" />Manager</Badge>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight mt-1">Welcome{profile?.full_name ? `, ${profile.full_name}` : ''} 👋</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Team performance & sales overview</p>
        </div>
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 mb-5">
        {[
          { label: 'Total Leads', value: totalLeads, icon: Users, sub: `${converted} enroll`, ic: 'text-emerald-600', bg: 'bg-emerald-500/10' },
          { label: 'In Pipeline', value: inPipeline, icon: Target, sub: 'Active prospects', ic: 'text-amber-600', bg: 'bg-amber-500/10' },
          { label: 'Enroll', value: converted, icon: CheckCircle2, sub: `${convRate}% rate`, ic: 'text-green-600', bg: 'bg-green-500/10' },
          { label: 'Students', value: studentsCount, icon: GraduationCap, sub: 'Enrolled', ic: 'text-blue-600', bg: 'bg-blue-500/10' },
          { label: 'Revenue', value: fmt(totalRevenue), icon: IndianRupee, sub: `${fmt(pendingRevenue)} pending`, ic: 'text-green-600', bg: 'bg-green-500/10' },
          { label: 'Tasks', value: pendingTasks, icon: ClipboardList, sub: `of ${tasks.length} total`, ic: 'text-purple-600', bg: 'bg-purple-500/10' },
        ].map(c => (
          <Card key={c.label} className="border-border/50 shadow-none hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-3 pt-3">
              <CardTitle className="text-xs font-medium text-muted-foreground">{c.label}</CardTitle>
              <div className={`h-7 w-7 rounded-lg ${c.bg} flex items-center justify-center`}><c.icon className={`h-3.5 w-3.5 ${c.ic}`} /></div>
            </CardHeader>
            <CardContent className="px-3 pb-3"><div className="text-lg font-bold">{c.value}</div><p className="text-[10px] text-muted-foreground">{c.sub}</p></CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <Card className="border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm font-semibold">Lead Pipeline</CardTitle></CardHeader>
          <CardContent className="px-2 sm:px-4">
            {leadsByStatus.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
              <ResponsiveContainer width="100%" height={isMobile ? 200 : 260}>
                <BarChart data={leadsByStatus}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="name" tick={{ fontSize: isMobile ? 8 : 10 }} stroke="hsl(var(--muted-foreground))" /><YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" /><Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12 }} /><Bar dataKey="value" fill="hsl(200, 70%, 50%)" radius={[6, 6, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Team Performance */}
        <Card className="border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Link2 className="h-4 w-4" />Team Form Performance</CardTitle></CardHeader>
          <CardContent className="px-0 sm:px-4">
            {referralData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No form leads data</p> : isMobile ? (
              <div className="space-y-2 px-3">
                {referralData.map((r, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div><p className="text-sm font-medium">#{i + 1} {r.rep_name}</p></div>
                    <div className="text-right"><p className="text-sm font-semibold">{r.leads_count} leads</p><p className="text-[10px] text-emerald-600">{r.converted} enroll</p></div>
                  </div>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead className="w-10">#</TableHead><TableHead>Rep</TableHead><TableHead className="text-center">Leads</TableHead><TableHead className="text-center">Enroll</TableHead><TableHead className="text-center">Rate</TableHead></TableRow></TableHeader>
                <TableBody>
                  {referralData.map((r, i) => (
                    <TableRow key={i}><TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell><TableCell className="font-medium">{r.rep_name}</TableCell><TableCell className="text-center">{r.leads_count}</TableCell><TableCell className="text-center text-emerald-600 font-semibold">{r.converted}</TableCell><TableCell className="text-center">{r.leads_count > 0 ? `${Math.round((r.converted / r.leads_count) * 100)}%` : '0%'}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Unassigned Leads */}
      {unassignedLeads.length > 0 && (
        <Card className="mb-5 border-amber-200 bg-amber-500/5 shadow-none">
          <CardHeader className="px-3 sm:px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-amber-600" />
              Unassigned Leads ({unassignedLeads.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-4">
            {isMobile ? (
              <div className="space-y-2 px-3">
                {unassignedLeads.slice(0, 10).map(l => (
                  <div key={l.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div>
                      <p className="text-sm font-medium">{l.name}</p>
                      <p className="text-xs text-muted-foreground">{l.email || l.phone || '—'}</p>
                      {l.referred_by && codeToName[l.referred_by] && <button onClick={() => navigate(`/leads/form-leads?employee=${codeToUserId[l.referred_by]}`)} className="text-[10px] text-emerald-600 hover:underline text-left">Via: {codeToName[l.referred_by]}</button>}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs"><UserPlus className="h-3 w-3" />Assign</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {teamMembers.map(m => <DropdownMenuItem key={m.id} onClick={() => handleAssignLead(l.id, m.id)}>{m.full_name}</DropdownMenuItem>)}
                        {teamMembers.length === 0 && <DropdownMenuItem disabled>No reps available</DropdownMenuItem>}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Collected By</TableHead><TableHead>Source</TableHead><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead className="w-28">Assign</TableHead></TableRow></TableHeader>
                <TableBody>
                  {unassignedLeads.slice(0, 10).map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">{l.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.email || l.phone || '—'}</TableCell>
                      <TableCell className="text-sm">{l.referred_by && codeToName[l.referred_by] ? <button onClick={() => navigate(`/leads/form-leads?employee=${codeToUserId[l.referred_by]}`)} className="text-emerald-600 font-medium hover:underline cursor-pointer">{codeToName[l.referred_by]}</button> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="capitalize text-sm">{l.source?.replace(/_/g, ' ') || '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize text-xs">{(l.status || 'new').replace(/_/g, ' ')}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{new Date(l.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="gap-1 h-7 text-xs"><UserPlus className="h-3 w-3" />Assign</Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {teamMembers.map(m => <DropdownMenuItem key={m.id} onClick={() => handleAssignLead(l.id, m.id)}>{m.full_name}</DropdownMenuItem>)}
                            {teamMembers.length === 0 && <DropdownMenuItem disabled>No reps available</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-border/50 shadow-none">
        <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><ClipboardList className="h-4 w-4" />Recent Tasks</CardTitle></CardHeader>
        <CardContent className="px-0 sm:px-4">
          {isMobile ? (
            <div className="space-y-2 px-3">
              {tasks.length === 0 ? <p className="text-center py-6 text-muted-foreground text-sm">No tasks</p> : tasks.map(t => (
                <div key={t.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{t.title}</p><p className="text-xs text-muted-foreground">{t.due_date ? new Date(t.due_date).toLocaleDateString() : '—'}</p></div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-xs capitalize ${t.priority === 'urgent' ? 'border-destructive/50 text-destructive' : t.priority === 'high' ? 'border-amber-500/50 text-amber-600' : ''}`}>{t.priority || 'medium'}</Badge>
                    <Badge variant={t.status === 'completed' ? 'default' : 'secondary'} className="text-xs capitalize">{(t.status || 'pending').replace(/_/g, ' ')}</Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Task</TableHead><TableHead>Priority</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {tasks.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No tasks</TableCell></TableRow> : tasks.map(t => (
                  <TableRow key={t.id}><TableCell className="font-medium">{t.title}</TableCell><TableCell><Badge variant="outline" className={`text-xs capitalize ${t.priority === 'urgent' ? 'border-destructive/50 text-destructive' : t.priority === 'high' ? 'border-amber-500/50 text-amber-600' : ''}`}>{t.priority || 'medium'}</Badge></TableCell><TableCell className="text-sm text-muted-foreground">{t.due_date ? new Date(t.due_date).toLocaleDateString() : '—'}</TableCell><TableCell><Badge variant={t.status === 'completed' ? 'default' : 'secondary'} className="text-xs capitalize">{(t.status || 'pending').replace(/_/g, ' ')}</Badge></TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
