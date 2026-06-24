import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  LayoutDashboard, Mail, Send, CheckCircle2, XCircle, Clock, Users,
  TrendingUp, MessageSquare, FileText, Loader2, BarChart3, ArrowUpRight, ArrowDownRight,
  Upload, UserPlus, Download
} from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const COLORS = ['hsl(var(--primary))', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const LEAD_SOURCES = [
  'google_ads', 'instagram', 'facebook', 'youtube', 'website',
  'google_forms', 'whatsapp', 'referral', 'walkin', 'college_seminar', 'other',
];

export default function MarketingPortalDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [referralCode, setReferralCode] = useState('');
  const [formLeads, setFormLeads] = useState<any[]>([]);
  const [emailCampaigns, setEmailCampaigns] = useState<any[]>([]);
  const [waCampaigns, setWaCampaigns] = useState<any[]>([]);

  // Import dialog
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [profileRes, emailRes, waRes] = await Promise.all([
        supabase.from('profiles').select('referral_code').eq('user_id', user?.id || '').single(),
        supabase.from('email_campaigns').select('*').eq('created_by', user?.id || '').order('created_at', { ascending: false }),
        supabase.from('whatsapp_campaigns').select('*').eq('created_by', user?.id || '').order('created_at', { ascending: false }),
      ]);

      const code = profileRes.data?.referral_code || '';
      setReferralCode(code);
      setEmailCampaigns(emailRes.data || []);
      setWaCampaigns(waRes.data || []);

      if (code) {
        const { data } = await supabase.from('leads').select('*').eq('referred_by', code).order('created_at', { ascending: false });
        setFormLeads(data || []);
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  // CSV Import
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) { toast({ variant: 'destructive', title: 'CSV must have a header row and data' }); return; }
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      const nameIdx = headers.findIndex(h => h.includes('name'));
      const emailIdx = headers.findIndex(h => h.includes('email'));
      const phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('mobile'));
      const collegeIdx = headers.findIndex(h => h.includes('college') || h.includes('institution'));
      const sourceIdx = headers.findIndex(h => h.includes('source'));

      const parsed = lines.slice(1).map(line => {
        const cols = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(c => c.replace(/^"|"$/g, '').trim()) || line.split(',').map(c => c.trim());
        return {
          name: cols[nameIdx] || cols[0] || '',
          email: emailIdx >= 0 ? cols[emailIdx] : '',
          phone: phoneIdx >= 0 ? cols[phoneIdx] : '',
          college: collegeIdx >= 0 ? cols[collegeIdx] : '',
          source: sourceIdx >= 0 ? cols[sourceIdx] : 'other',
        };
      }).filter(r => r.name);

      setImportPreview(parsed);
      setShowImport(true);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportConfirm = async () => {
    if (importPreview.length === 0 || !referralCode) return;
    setImporting(true);
    try {
      const records = importPreview.map(r => ({
        name: r.name,
        email: r.email || null,
        phone: r.phone || null,
        college: r.college || null,
        source: LEAD_SOURCES.includes(r.source) ? r.source : 'other',
        referred_by: referralCode,
        status: 'new' as const,
      }));
      const { error } = await supabase.from('leads').insert(records);
      if (error) throw error;
      toast({ title: `${records.length} leads imported successfully!` });
      setShowImport(false);
      setImportPreview([]);
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Import failed', description: err.message });
    } finally {
      setImporting(false);
    }
  };


  // Calculations
  const emailSent = emailCampaigns.reduce((s, c) => s + (c.sent_count || 0), 0);
  const emailFailed = emailCampaigns.reduce((s, c) => s + (c.failed_count || 0), 0);
  const emailPending = emailCampaigns.reduce((s, c) => s + (c.pending_count || 0), 0);
  const waSent = waCampaigns.reduce((s, c) => s + (c.sent_count || 0), 0);
  const waFailed = waCampaigns.reduce((s, c) => s + (c.failed_count || 0), 0);
  const waPending = waCampaigns.reduce((s, c) => s + (c.pending_count || 0), 0);

  const totalSent = emailSent + waSent;
  const totalLeads = formLeads.length;
  const convertedLeads = formLeads.filter(l => l.status === 'converted' || l.status === 'enrolled').length;
  const conversionRate = totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : '0';

  // Lead status distribution
  const statusCounts: Record<string, number> = {};
  formLeads.forEach(l => {
    const s = l.status || 'new';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });
  const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

  // Last 7 days leads trend
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(new Date(), 6 - i);
    const dayStr = format(date, 'yyyy-MM-dd');
    const count = formLeads.filter(l => format(new Date(l.created_at), 'yyyy-MM-dd') === dayStr).length;
    return { day: format(date, 'EEE'), leads: count };
  });

  // Recent leads
  const recentLeads = formLeads.slice(0, 5);

  // Recent campaigns (combined)
  const allCampaigns = [
    ...emailCampaigns.map(c => ({ ...c, channel: 'email' })),
    ...waCampaigns.map(c => ({ ...c, channel: 'whatsapp' })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-5">
      {/* Hidden file input */}
      <input type="file" ref={fileInputRef} accept=".csv" className="hidden" onChange={handleFileSelect} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 md:h-6 md:w-6 text-primary" />
            Marketing Dashboard
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">Overview of your marketing performance</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => {
            const csv = 'name,email,phone,college,source\nJohn Doe,john@example.com,9876543210,ABC College,google_ads\n';
            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'leads_template.csv'; a.click();
          }}>
            <Download className="h-3.5 w-3.5" />Template
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />Import Leads
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-primary cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/marketing/portal')}>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total Sent</span>
              <Send className="h-4 w-4 text-primary" />
            </div>
            <p className="text-xl md:text-2xl font-bold">{totalSent}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              <span className="text-primary">{emailSent} email</span> · <span className="text-emerald-600">{waSent} WA</span>
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/marketing/form-leads')}>
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Form Leads</span>
              <Users className="h-4 w-4 text-blue-500" />
            </div>
            <p className="text-xl md:text-2xl font-bold">{totalLeads}</p>
            <p className="text-[10px] text-muted-foreground mt-1">{convertedLeads} enroll</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Conversion</span>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="text-xl md:text-2xl font-bold">{conversionRate}%</p>
            <p className="text-[10px] text-muted-foreground mt-1">{convertedLeads}/{totalLeads} leads</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Campaigns</span>
              <BarChart3 className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-xl md:text-2xl font-bold">{emailCampaigns.length + waCampaigns.length}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {emailCampaigns.length} email · {waCampaigns.length} WA
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Channel Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2"><Mail className="h-4 w-4 text-primary" />Email Stats</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
                <p className="text-lg font-bold text-emerald-600">{emailSent}</p>
                <p className="text-[10px] text-muted-foreground">Sent</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30">
                <p className="text-lg font-bold text-amber-600">{emailPending}</p>
                <p className="text-[10px] text-muted-foreground">Pending</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-red-50 dark:bg-red-950/30">
                <p className="text-lg font-bold text-red-600">{emailFailed}</p>
                <p className="text-[10px] text-muted-foreground">Failed</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4 text-emerald-600" />WhatsApp Stats</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
                <p className="text-lg font-bold text-emerald-600">{waSent}</p>
                <p className="text-[10px] text-muted-foreground">Sent</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30">
                <p className="text-lg font-bold text-amber-600">{waPending}</p>
                <p className="text-[10px] text-muted-foreground">Pending</p>
              </div>
              <div className="text-center p-2 rounded-lg bg-red-50 dark:bg-red-950/30">
                <p className="text-lg font-bold text-red-600">{waFailed}</p>
                <p className="text-[10px] text-muted-foreground">Failed</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Leads Trend */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm">Leads - Last 7 Days</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={last7Days}>
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="leads" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Lead Status Pie */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm">Lead Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {statusData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No leads yet</div>
            ) : (
              <div className="h-48 flex items-center gap-4">
                <div className="flex-1">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                        {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5">
                  {statusData.map((s, i) => (
                    <div key={s.name} className="flex items-center gap-2 text-xs">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="capitalize text-muted-foreground">{s.name.replace(/_/g, ' ')}</span>
                      <span className="font-semibold ml-auto">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Recent Leads */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Recent Leads</CardTitle>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/marketing/form-leads')}>View All</Button>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {recentLeads.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No leads yet</p>
            ) : (
              <div className="space-y-2">
                {recentLeads.map(lead => (
                  <div key={lead.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/40">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{lead.name}</p>
                      <p className="text-[10px] text-muted-foreground">{lead.email || lead.phone || '—'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] capitalize">{lead.status || 'new'}</Badge>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(lead.created_at), 'dd MMM')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Campaigns */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Recent Campaigns</CardTitle>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/marketing/portal')}>View All</Button>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {allCampaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No campaigns yet</p>
            ) : (
              <div className="space-y-2">
                {allCampaigns.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {c.channel === 'email' ? <Mail className="h-3 w-3 text-primary" /> : <MessageSquare className="h-3 w-3 text-emerald-600" />}
                        <p className="text-sm font-medium truncate">{c.subject}</p>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {c.sent_count || 0} sent · {c.failed_count || 0} failed · {c.pending_count || 0} pending
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{format(new Date(c.created_at), 'dd MMM')}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Import CSV Dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Import Leads from CSV</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {importPreview.length} leads found. They will be linked to your referral code <Badge variant="outline" className="text-[10px]">{referralCode}</Badge>
            </p>
            <div className="max-h-60 overflow-y-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="p-2 text-left font-medium">#</th>
                    <th className="p-2 text-left font-medium">Name</th>
                    <th className="p-2 text-left font-medium">Email</th>
                    <th className="p-2 text-left font-medium">Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2 text-muted-foreground">{i + 1}</td>
                      <td className="p-2 font-medium">{r.name}</td>
                      <td className="p-2 text-muted-foreground">{r.email || '—'}</td>
                      <td className="p-2 text-muted-foreground">{r.phone || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {importPreview.length > 50 && (
                <p className="text-xs text-center text-muted-foreground py-2">... and {importPreview.length - 50} more</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowImport(false); setImportPreview([]); }}>Cancel</Button>
            <Button onClick={handleImportConfirm} disabled={importing} className="gap-1.5">
              {importing && <Loader2 className="h-4 w-4 animate-spin" />}
              Import {importPreview.length} Leads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
