import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UserCheck, ClipboardList, Loader2, Phone, PhoneCall, Target } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCallLogStats } from '@/hooks/useCallLogs';
import LogCallDialog from '@/components/sales/LogCallDialog';
import { isSameAppCalendarDay } from '@/lib/dateTime';
import AssignedAssignmentsCard from '@/components/assignments/AssignedAssignmentsCard';
import AssignedFormLinksCard from '@/components/forms/AssignedFormLinksCard';
import AssignedDocFormLinksCard from '@/components/forms/AssignedDocFormLinksCard';

const STATUS_LABELS: Record<string, string> = {
  new: 'New', contacted: 'Contacted', interested: 'Interested', demo_scheduled: 'Demo Sched.', demo_attended: 'Demo Attend.',
  considering: 'Considering', enrolled: 'Enroll', converted: 'Enroll', lost: 'Lost',
};
const statusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-700 border-blue-200', contacted: 'bg-amber-500/10 text-amber-700 border-amber-200',
  interested: 'bg-emerald-500/10 text-emerald-700 border-emerald-200', demo_scheduled: 'bg-indigo-500/10 text-indigo-700 border-indigo-200',
  enrolled: 'bg-teal-500/10 text-teal-800 border-teal-200', converted: 'bg-teal-500/10 text-teal-800 border-teal-200', lost: 'bg-red-500/10 text-red-700 border-red-200',
};

type FresherMyProgress = {
  enrolled: boolean;
  joining_date?: string;
  phase_key?: string;
  phase_label?: string;
  window_start?: string | null;
  window_end_exclusive?: string | null;
  target_rupees?: number;
  achieved_rupees?: number;
  remaining_rupees?: number;
  achievement_pct?: number;
  salary_type?: string | null;
  headline_status?: string | null;
};

const inr = (n: number) =>
  `₹${Math.round(n).toLocaleString('en-IN')}`;

export default function SalesRepDashboard() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [logCallOpen, setLogCallOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [fresherProgress, setFresherProgress] = useState<FresherMyProgress | null>(null);

  const referralCode = profile?.referral_code || '';
  const { data: todayStats } = useCallLogStats('today');

  useEffect(() => { fetchData(); }, [user]);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [dashData, tasksData, fresherRes] = await Promise.all([
        api.profiles.dashboard(),
        api.tasks.list(),
        api.fresherSalary.myProgress().catch(() => ({ enrolled: false } as FresherMyProgress)),
      ]);
      setLeads(dashData.leads || []);
      const allTasks = Array.isArray(tasksData)
        ? tasksData
        : (tasksData?.data || tasksData?.tasks || []);
      setTasks(
        allTasks
          .filter((t: any) => t.assigned_to === user.id || t.created_by === user.id)
          .slice(0, 8),
      );
      setFresherProgress(fresherRes?.enrolled ? fresherRes : null);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const uid = String(user?.id || '');
  const assignedLeads = leads.filter((l) => String(l.assigned_to || '') === uid);
  const formLeads = leads.filter(
    (l) => !!referralCode && String(l.referred_by || '').trim() === referralCode,
  );
  const allMyLeadsMap = new Map<string, any>();
  for (const l of [...assignedLeads, ...formLeads]) {
    if (l?.id) allMyLeadsMap.set(String(l.id), l);
  }
  // Also include any other scoped leads from the API (legacy / creator) so Total isn't undercounted
  for (const l of leads) {
    if (l?.id && !allMyLeadsMap.has(String(l.id))) allMyLeadsMap.set(String(l.id), l);
  }
  const allMyLeads = Array.from(allMyLeadsMap.values());

  const totalLeads = allMyLeads.length;
  const converted = allMyLeads.filter(l => l.status === 'converted' || l.status === 'enrolled').length;
  const todayFollowUps = allMyLeads.filter((l) => isSameAppCalendarDay(l.next_follow_up));

  const leadsByStatus = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of allMyLeads) {
      let key = l.status || 'new';
      if (key === 'converted') key = 'enrolled';
      c[key] = (c[key] || 0) + 1;
    }
    return Object.entries(c).map(([name, value]) => ({ name: STATUS_LABELS[name] || name, value }));
  }, [allMyLeads]);

  const pendingTasks = tasks.filter(t => t.status !== 'completed');

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-teal-500/10 text-teal-600 border-teal-200 text-xs"><UserCheck className="h-3 w-3 mr-1" />Sales Rep</Badge>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight mt-1">Welcome{profile?.full_name ? `, ${profile.full_name}` : ''} 👋</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Your leads, tasks & performance</p>
        </div>
      </div>

      {/* Lead Splits */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
        <Card className="border-border/50 shadow-none bg-gradient-to-br from-primary/5 to-primary/10">
          <CardContent className="p-3 sm:p-4">
            <p className="text-[10px] sm:text-xs font-medium text-muted-foreground">Assigned</p>
            <div className="text-lg sm:text-2xl font-bold mt-1">{assignedLeads.length}</div>
            <p className="text-[10px] text-muted-foreground">{assignedLeads.filter(l => l.status === 'converted' || l.status === 'enrolled').length} enroll</p>
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-none bg-gradient-to-br from-accent/30 to-accent/10">
          <CardContent className="p-3 sm:p-4">
            <p className="text-[10px] sm:text-xs font-medium text-muted-foreground">Form Leads</p>
            <div className="text-lg sm:text-2xl font-bold mt-1">{formLeads.length}</div>
            <p className="text-[10px] text-muted-foreground">{formLeads.filter(l => l.status === 'converted' || l.status === 'enrolled').length} enroll</p>
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-none bg-gradient-to-br from-emerald-500/5 to-emerald-500/10">
          <CardContent className="p-3 sm:p-4">
            <p className="text-[10px] sm:text-xs font-medium text-muted-foreground">Total</p>
            <div className="text-lg sm:text-2xl font-bold mt-1">{totalLeads}</div>
            <p className="text-[10px] text-muted-foreground">{converted} enroll</p>
          </CardContent>
        </Card>
      </div>

      {/* Fresher salary phase target (from Fresher Salary Tracker enrollment) */}
      {fresherProgress?.enrolled && (
        <Card className="mb-4 border-border/50 shadow-none border-emerald-500/25 bg-emerald-500/[0.04]">
          <CardHeader className="px-3 sm:px-4 pb-2 pt-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Target className="h-4 w-4 text-emerald-600" />
              Your sales target
              {fresherProgress.phase_label ? (
                <Badge variant="outline" className="text-[10px] font-normal border-emerald-200 text-emerald-800 bg-emerald-500/10">
                  {fresherProgress.phase_label}
                </Badge>
              ) : null}
            </CardTitle>
            <p className="text-xs text-muted-foreground font-normal mt-1">
              From Sales Salary Tracker
              {fresherProgress.joining_date ? ` · joined ${fresherProgress.joining_date}` : ''}
              {fresherProgress.window_start && fresherProgress.window_end_exclusive
                ? ` · ${fresherProgress.window_start} → ${fresherProgress.window_end_exclusive}`
                : ''}
            </p>
          </CardHeader>
          <CardContent className="px-3 sm:px-4 pb-4">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Target</p>
                <p className="text-base sm:text-lg font-bold mt-0.5">{inr(fresherProgress.target_rupees || 0)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Achieved</p>
                <p className="text-base sm:text-lg font-bold mt-0.5 text-emerald-700">{inr(fresherProgress.achieved_rupees || 0)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Remaining</p>
                <p className="text-base sm:text-lg font-bold mt-0.5">{inr(fresherProgress.remaining_rupees || 0)}</p>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-emerald-500 transition-[width] duration-500"
                style={{ width: `${Math.min(100, Math.max(0, fresherProgress.achievement_pct || 0))}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {fresherProgress.achievement_pct ?? 0}% of phase target
              {fresherProgress.headline_status ? ` · ${fresherProgress.headline_status}` : ''}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Assigned Assignments */}
      <AssignedAssignmentsCard />
      <AssignedFormLinksCard showEmpty />
      <AssignedDocFormLinksCard />
      <Card className="mb-5 border border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-3 px-4 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <PhoneCall className="h-4 w-4 text-teal-500 shrink-0" />
            <CardTitle className="text-sm font-medium">Today&apos;s Calls</CardTitle>
            <span className="text-xs text-muted-foreground">{todayStats?.period_label ?? ''}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/sales/call-log')} className="text-teal-600 hover:text-teal-700 text-xs shrink-0">
            View All →
          </Button>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{todayStats?.total_calls ?? 0}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">{todayStats?.incoming ?? 0}</div>
              <div className="text-xs text-muted-foreground">Incoming</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-400">{todayStats?.outgoing ?? 0}</div>
              <div className="text-xs text-muted-foreground">Outgoing</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-500">{todayStats?.missed ?? 0}</div>
              <div className="text-xs text-muted-foreground">Missed</div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {todayStats?.connected_calls ?? 0} connected · {todayStats?.call_duration ?? '-'} total duration
            </span>
            <Button size="sm" className="bg-teal-500 hover:bg-teal-600 text-white text-xs h-7" onClick={() => setLogCallOpen(true)}>
              + Log Call
            </Button>
          </div>
        </CardContent>
      </Card>

      <LogCallDialog open={logCallOpen} onOpenChange={setLogCallOpen} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        {/* Pipeline Chart */}
        <Card className="border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm font-semibold">My Lead Pipeline</CardTitle></CardHeader>
          <CardContent className="px-2 sm:px-4">
            {leadsByStatus.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No leads yet</p> : (
              <ResponsiveContainer width="100%" height={isMobile ? 200 : 240}>
                <BarChart data={leadsByStatus}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="name" tick={{ fontSize: isMobile ? 8 : 10 }} stroke="hsl(var(--muted-foreground))" /><YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" /><Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12 }} /><Bar dataKey="value" fill="hsl(162, 63%, 41%)" radius={[6, 6, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Pending Tasks */}
        <Card className="border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm font-semibold flex items-center gap-2"><ClipboardList className="h-4 w-4" />My Tasks ({pendingTasks.length} pending)</CardTitle></CardHeader>
          <CardContent className="px-0 sm:px-4">
            {isMobile ? (
              <div className="space-y-2 px-3">
                {pendingTasks.length === 0 ? <p className="text-center py-6 text-muted-foreground text-sm">No pending tasks 🎉</p> : pendingTasks.map(t => (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{t.title}</p><p className="text-xs text-muted-foreground">{t.due_date ? new Date(t.due_date).toLocaleDateString() : '—'}</p></div>
                    <Badge variant="outline" className={`text-xs capitalize ${t.priority === 'urgent' ? 'border-destructive/50 text-destructive' : t.priority === 'high' ? 'border-amber-500/50 text-amber-600' : ''}`}>{t.priority || 'medium'}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Task</TableHead><TableHead>Priority</TableHead><TableHead>Due</TableHead></TableRow></TableHeader>
                <TableBody>
                  {pendingTasks.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No pending tasks 🎉</TableCell></TableRow> : pendingTasks.map(t => (
                    <TableRow key={t.id}><TableCell className="font-medium">{t.title}</TableCell><TableCell><Badge variant="outline" className={`text-xs capitalize ${t.priority === 'urgent' ? 'border-destructive/50 text-destructive' : t.priority === 'high' ? 'border-amber-500/50 text-amber-600' : ''}`}>{t.priority || 'medium'}</Badge></TableCell><TableCell className="text-sm text-muted-foreground">{t.due_date ? new Date(t.due_date).toLocaleDateString() : '—'}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Today's Follow-ups */}
      {todayFollowUps.length > 0 && (
        <Card className="border-amber-200 bg-amber-500/5 shadow-none">
          <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-700"><Phone className="h-4 w-4" />Today's Follow-ups ({todayFollowUps.length})</CardTitle></CardHeader>
          <CardContent className="px-0 sm:px-4">
            {isMobile ? (
              <div className="space-y-2 px-3">
                {todayFollowUps.map(l => (
                  <div key={l.id} className="flex items-center justify-between py-2 border-b border-amber-200/30 last:border-0">
                    <div><p className="text-sm font-medium">{l.name}</p><p className="text-xs text-muted-foreground">{l.phone || l.email || '—'}</p></div>
                    <Badge variant="outline" className={`${statusColors[l.status] || ''} capitalize text-xs`}>{(l.status || 'new').replace(/_/g, ' ')}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {todayFollowUps.map(l => (
                    <TableRow key={l.id}><TableCell className="font-medium">{l.name}</TableCell><TableCell className="text-sm">{l.phone || '—'}</TableCell><TableCell className="text-sm text-muted-foreground">{l.email || '—'}</TableCell><TableCell><Badge variant="outline" className={`${statusColors[l.status] || ''} capitalize text-xs`}>{(l.status || 'new').replace(/_/g, ' ')}</Badge></TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
