import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UserCheck, ClipboardList, Loader2, Phone, PhoneCall, Link as LinkIcon, Copy, ExternalLink } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCallLogStats } from '@/hooks/useCallLogs';
import LogCallDialog from '@/components/sales/LogCallDialog';

const STATUS_LABELS: Record<string, string> = {
  new: 'New', contacted: 'Contacted', interested: 'Interested', demo_scheduled: 'Demo Sched.', demo_attended: 'Demo Attend.',
  considering: 'Considering', enrolled: 'Enroll', converted: 'Enroll', lost: 'Lost',
};
const statusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-700 border-blue-200', contacted: 'bg-amber-500/10 text-amber-700 border-amber-200',
  interested: 'bg-emerald-500/10 text-emerald-700 border-emerald-200', demo_scheduled: 'bg-indigo-500/10 text-indigo-700 border-indigo-200',
  enrolled: 'bg-teal-500/10 text-teal-800 border-teal-200', converted: 'bg-teal-500/10 text-teal-800 border-teal-200', lost: 'bg-red-500/10 text-red-700 border-red-200',
};

type AssignedLeadForm = { id: string; name: string; slug: string; is_active?: number | boolean | string };

export default function SalesRepDashboard() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [logCallOpen, setLogCallOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [assignedForms, setAssignedForms] = useState<AssignedLeadForm[]>([]);

  const referralCode = profile?.referral_code || '';
  const { data: todayStats } = useCallLogStats('today');

  useEffect(() => { fetchData(); }, [user]);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [dashData, tasksData, formsRes] = await Promise.all([
        api.profiles.dashboard(),
        api.tasks.list(),
        api.forms.list().catch(() => ({ data: [] as AssignedLeadForm[] })),
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
      const raw = Array.isArray(formsRes?.data) ? formsRes.data : [];
      setAssignedForms(
        raw.filter((f: AssignedLeadForm) => f.is_active !== 0 && f.is_active !== false && f.is_active !== '0'),
      );
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const assignedLeads = leads.filter(l => !l.referred_by);
  const formLeads = leads.filter(l => l.referred_by && l.referred_by === referralCode);
  const allMyLeads = [...assignedLeads, ...formLeads];

  const totalLeads = allMyLeads.length;
  const converted = allMyLeads.filter(l => l.status === 'converted' || l.status === 'enrolled').length;
  const todayFollowUps = allMyLeads.filter(l => l.next_follow_up && new Date(l.next_follow_up).toDateString() === new Date().toDateString());

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

  const personalFormUrl = (slug: string) => {
    const base = `${window.location.origin}/apply`;
    const q = new URLSearchParams({ form: slug });
    if (referralCode) q.set('ref', referralCode);
    return `${base}?${q.toString()}`;
  };

  const copyFormLink = async (slug: string) => {
    try {
      await navigator.clipboard.writeText(personalFormUrl(slug));
      toast({ title: 'Link copied', description: 'Share this URL to collect form leads credited to you.' });
    } catch {
      toast({ variant: 'destructive', title: 'Could not copy', description: 'Copy the link manually from the preview.' });
    }
  };

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

      {/* Personalized apply links (Form Management assignments) — applies to all sales reps / execs / team leads on this dashboard */}
      <Card className="mb-4 border-border/50 shadow-none border-teal-500/20 bg-teal-500/[0.03]">
        <CardHeader className="px-3 sm:px-4 pb-2 pt-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <LinkIcon className="h-4 w-4 text-teal-600" />
            Your form links
          </CardTitle>
          <p className="text-xs text-muted-foreground font-normal leading-snug mt-1">
            Forms your admin assigned in Form Management. Each URL includes your referral code so submissions appear under Form Leads for you.
          </p>
          {!referralCode && assignedForms.length > 0 && (
            <p className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-200/60 rounded-md px-2 py-1.5 mt-2">
              Your profile has no referral code yet — links may not attribute leads. Ask your admin to fix your account.
            </p>
          )}
        </CardHeader>
        <CardContent className="px-3 sm:px-4 pb-4">
          {assignedForms.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No forms assigned yet. When an admin assigns you in <span className="font-medium text-foreground">Form Management</span>, your personal links will show here for everyone on this dashboard role (sales reps, sales executives, team leads).
            </p>
          ) : isMobile ? (
            <div className="space-y-2">
              {assignedForms.map((f) => (
                <div key={f.id} className="rounded-lg border border-border/60 bg-background p-3 space-y-2">
                  <p className="text-sm font-medium">{f.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono break-all">{personalFormUrl(f.slug)}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-8 text-xs flex-1 gap-1" onClick={() => copyFormLink(f.slug)}>
                      <Copy className="h-3 w-3" /> Copy
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs flex-1 gap-1" asChild>
                      <a href={personalFormUrl(f.slug)} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3 w-3" /> Open
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Form</TableHead>
                  <TableHead className="min-w-[200px]">Your link</TableHead>
                  <TableHead className="w-[140px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignedForms.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium text-sm">{f.name}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground break-all max-w-md">{personalFormUrl(f.slug)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => copyFormLink(f.slug)}>
                          <Copy className="h-3 w-3" /> Copy
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" asChild>
                          <a href={personalFormUrl(f.slug)} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3 w-3" /> Open
                          </a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>


      {/* Today's Calls — below lead summary (replaces former KPI row) */}
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
