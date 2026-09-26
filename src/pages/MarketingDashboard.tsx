import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { phpList, inDateRange } from '@/lib/phpList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  Mail, Send, Loader2,
  BarChart3, Filter, Clock, CheckCircle2, XCircle, Search,
  MessageSquare
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay, startOfWeek, endOfWeek } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { isL3AdminRole, normalizeAppRole } from '@/lib/roleUtils';

interface MarketingMember {
  id: string;
  user_id?: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  created_at: string;
}

export default function MarketingDashboard() {
  const { role } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [members, setMembers] = useState<MarketingMember[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [sends, setSends] = useState<any[]>([]);
  const [waCampaigns, setWaCampaigns] = useState<any[]>([]);
  const [waSends, setWaSends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('campaigns');

  // Filters
  const [memberFilter, setMemberFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('7days');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [waSearchQuery, setWaSearchQuery] = useState('');
  const [scheduledSearch, setScheduledSearch] = useState('');

  const normalizedRole = normalizeAppRole(role);
  const canFilterByMember = normalizedRole === 'super_admin' || isL3AdminRole(normalizedRole);
  const isMarketingAdmin = normalizedRole === 'super_admin' || isL3AdminRole(normalizedRole);
  const isMarketingRole = (value?: string | null) =>
    String(value || '').trim().toLowerCase().startsWith('marketing');

  useEffect(() => {
    fetchData();
  }, [memberFilter, dateFilter, customFrom, customTo]);

  const getDateRange = () => {
    const now = new Date();
    switch (dateFilter) {
      case 'today': return { from: startOfDay(now), to: endOfDay(now) };
      case '7days': return { from: subDays(now, 7), to: now };
      case '30days': return { from: subDays(now, 30), to: now };
      case 'this_week': return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
      case 'custom':
        return {
          from: customFrom ? new Date(customFrom) : subDays(now, 30),
          to: customTo ? new Date(customTo) : now,
        };
      default: return { from: subDays(now, 7), to: now };
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const { from, to } = getDateRange();

      // Fetch members from PHP API users table (role = marketing*)
      let teamMembers: MarketingMember[] = [];
      try {
        const teamData = await api.team.list();
        const teamRows = Array.isArray(teamData)
          ? teamData
          : (teamData?.data || teamData?.users || []);
        teamMembers = teamRows
          .filter((m: any) => isMarketingRole(m.role))
          .map((m: any) => ({
            id: m.id,
            user_id: m.id,
            name: m.full_name || m.email,
            email: m.email,
            phone: m.phone || null,
            status: m.is_active ? 'active' : 'inactive',
            created_at: m.created_at,
          }));
      } catch {
        teamMembers = [];
      }

      // Fallback source for legacy records
      let legacyMembers: MarketingMember[] = [];
      try {
        const legacyMemberRes = await api.marketing.members();
        const legacyRows = Array.isArray(legacyMemberRes)
          ? legacyMemberRes
          : (legacyMemberRes?.data || legacyMemberRes?.members || []);
        legacyMembers = legacyRows.map((m: any) => ({
          id: m.id,
          user_id: m.user_id || m.id,
          name: m.name || m.full_name || m.email,
          email: m.email,
          phone: m.phone || null,
          status: m.status || 'active',
          created_at: m.created_at,
        }));
      } catch {
        legacyMembers = [];
      }

      const mergedByKey = new Map<string, MarketingMember>();
      [...legacyMembers, ...teamMembers].forEach((m) => {
        const emailKey = String(m.email || '').trim().toLowerCase();
        const idKey = String(m.user_id || m.id || '').trim().toLowerCase();
        const key = emailKey || idKey;
        if (key) mergedByKey.set(key, m);
      });
      const membersData = Array.from(mergedByKey.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setMembers(membersData);

      // Fetch email campaigns with date filter
      let campaignsData = phpList(await api.marketing.emailCampaigns());
      campaignsData = campaignsData.filter((c) => inDateRange(c, from, to));
      if (memberFilter !== 'all') {
        const member = (membersData || []).find((m) => m.id === memberFilter);
        if (member) {
          const createdByIds = [member.id, member.user_id].filter(Boolean);
          campaignsData = campaignsData.filter((c) => createdByIds.includes(c.created_by));
        }
      }
      setCampaigns(campaignsData);

      let waData = phpList(await api.marketing.whatsappCampaigns());
      waData = waData.filter((c) => inDateRange(c, from, to));
      if (memberFilter !== 'all') {
        const member = (membersData || []).find((m) => m.id === memberFilter);
        if (member) {
          const createdByIds = [member.id, member.user_id].filter(Boolean);
          waData = waData.filter((c) => createdByIds.includes(c.created_by));
        }
      }
      setWaCampaigns(waData);

      if (campaignsData.length > 0) {
        const sendsRes = await api.marketing.emailSends(campaignsData.map((c) => c.id));
        setSends(phpList(sendsRes));
      } else {
        setSends([]);
      }

      if (waData.length > 0) {
        const waSendsRes = await api.marketing.whatsappSends(waData.map((c) => c.id));
        setWaSends(phpList(waSendsRes));
      } else {
        setWaSends([]);
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Stats calculations
  const totalCampaigns = campaigns.length;
  const totalSent = campaigns.reduce((sum, c) => sum + (c.sent_count || 0), 0);
  const totalFailed = campaigns.reduce((sum, c) => sum + (c.failed_count || 0), 0);
  const totalPending = campaigns.reduce((sum, c) => sum + (c.pending_count || 0), 0);

  // WhatsApp stats
  const waTotalCampaigns = waCampaigns.length;
  const waTotalSent = waCampaigns.reduce((sum, c) => sum + (c.sent_count || 0), 0);
  const waTotalFailed = waCampaigns.reduce((sum, c) => sum + (c.failed_count || 0), 0);
  const waTotalPending = waCampaigns.reduce((sum, c) => sum + (c.pending_count || 0), 0);

  const filteredSends = searchQuery
    ? sends.filter(s => s.recipient_email?.toLowerCase().includes(searchQuery.toLowerCase()))
    : sends;

  const filteredWaSends = waSearchQuery
    ? waSends.filter((s) => String(s.recipient_phone || '').toLowerCase().includes(waSearchQuery.toLowerCase()))
    : waSends;

  const campaignTitle = (list: any[], id: string, fallback: string) => {
    const c = list.find((row) => row.id === id);
    return String(c?.subject || c?.name || fallback);
  };

  const scheduledRows = (() => {
    const emailByCampaign = new Map(campaigns.map((c) => [c.id, c]));
    const waByCampaign = new Map(waCampaigns.map((c) => [c.id, c]));
    const rows: Array<{
      id: string;
      channel: 'email' | 'whatsapp';
      title: string;
      recipient: string;
      scheduledAt: string | null;
      status: string;
    }> = [];

    const isQueued = (status: unknown) => {
      const s = String(status || '').toLowerCase();
      return s === 'pending' || s === 'scheduled' || s === 'queued';
    };

    for (const s of sends) {
      if (!isQueued(s.status)) continue;
      rows.push({
        id: `email-send-${s.id}`,
        channel: 'email',
        title: campaignTitle(campaigns, s.campaign_id, 'Email campaign'),
        recipient: String(s.recipient_email || '—'),
        scheduledAt: s.scheduled_at || emailByCampaign.get(s.campaign_id)?.scheduled_at || null,
        status: String(s.status || 'pending'),
      });
    }

    for (const s of waSends) {
      if (!isQueued(s.status)) continue;
      rows.push({
        id: `wa-send-${s.id}`,
        channel: 'whatsapp',
        title: campaignTitle(waCampaigns, s.campaign_id, 'WhatsApp campaign'),
        recipient: String(s.recipient_phone || '—'),
        scheduledAt: s.scheduled_at || waByCampaign.get(s.campaign_id)?.scheduled_at || null,
        status: String(s.status || 'pending'),
      });
    }

    for (const c of campaigns) {
      if (!isQueued(c.status) && !c.scheduled_at) continue;
      if (sends.some((s) => s.campaign_id === c.id && isQueued(s.status))) continue;
      if (!isQueued(c.status) && !(Number(c.pending_count || 0) > 0)) continue;
      rows.push({
        id: `email-campaign-${c.id}`,
        channel: 'email',
        title: String(c.subject || 'Email campaign'),
        recipient: `${c.pending_count || c.recipient_count || 0} recipient(s)`,
        scheduledAt: c.scheduled_at || null,
        status: String(c.status || 'pending'),
      });
    }

    for (const c of waCampaigns) {
      if (!isQueued(c.status) && !c.scheduled_at) continue;
      if (waSends.some((s) => s.campaign_id === c.id && isQueued(s.status))) continue;
      if (!isQueued(c.status) && !(Number(c.pending_count || 0) > 0)) continue;
      rows.push({
        id: `wa-campaign-${c.id}`,
        channel: 'whatsapp',
        title: String(c.subject || 'WhatsApp campaign'),
        recipient: `${c.pending_count || c.recipient_count || 0} recipient(s)`,
        scheduledAt: c.scheduled_at || null,
        status: String(c.status || 'pending'),
      });
    }

    rows.sort((a, b) => {
      const at = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bt = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER;
      return at - bt;
    });
    return rows;
  })();

  const filteredScheduled = scheduledSearch
    ? scheduledRows.filter((row) => {
        const q = scheduledSearch.toLowerCase();
        return (
          row.title.toLowerCase().includes(q) ||
          row.recipient.toLowerCase().includes(q) ||
          row.channel.includes(q)
        );
      })
    : scheduledRows;

  const formatWhen = (value?: string | null) => {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : format(d, 'dd MMM yyyy HH:mm');
  };

  const statusBadge = (status: string) => (
    <Badge variant="outline" className={
      status === 'sent' || status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
      status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
      status === 'sending' ? 'bg-blue-50 text-blue-700 border-blue-200' :
      'bg-amber-50 text-amber-700 border-amber-200'
    }>{status}</Badge>
  );

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
            <Mail className="h-5 w-5 md:h-6 md:w-6 text-primary" />
            Marketing Dashboard
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            Email & WhatsApp campaigns and send analytics
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isMarketingAdmin ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => navigate('/marketing-email?create=1')}
              >
                <Mail className="h-3.5 w-3.5" />
                Email Template
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                onClick={() => navigate('/marketing-whatsapp?create=1')}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                WhatsApp Template
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Filters:</span>
            </div>
            {canFilterByMember && (
              <Select value={memberFilter} onValueChange={setMemberFilter}>
                <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue placeholder="All Members" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Members</SelectItem>
                  {members.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7days">Last 7 Days</SelectItem>
                <SelectItem value="30days">Last 30 Days</SelectItem>
                <SelectItem value="this_week">This Week</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
            {dateFilter === 'custom' && (
              <div className="flex items-center gap-1.5">
                <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="h-8 w-[130px] text-xs" />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="h-8 w-[130px] text-xs" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="border-l-4 border-l-primary">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-1"><BarChart3 className="h-4 w-4 text-primary" /><span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Email Campaigns</span></div>
            <p className="text-xl md:text-2xl font-bold">{totalCampaigns}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-600">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-1"><MessageSquare className="h-4 w-4 text-emerald-600" /><span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">WA Campaigns</span></div>
            <p className="text-xl md:text-2xl font-bold">{waTotalCampaigns}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-1"><CheckCircle2 className="h-4 w-4 text-emerald-500" /><span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total Sent</span></div>
            <p className="text-xl md:text-2xl font-bold text-emerald-600">{totalSent + waTotalSent}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-1"><XCircle className="h-4 w-4 text-red-500" /><span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total Failed</span></div>
            <p className="text-xl md:text-2xl font-bold text-red-600">{totalFailed + waTotalFailed}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-1"><Clock className="h-4 w-4 text-amber-500" /><span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Pending</span></div>
            <p className="text-xl md:text-2xl font-bold text-amber-600">{totalPending + waTotalPending}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full md:w-auto overflow-x-auto">
          <TabsTrigger value="campaigns" className="text-xs">Email Campaigns</TabsTrigger>
          <TabsTrigger value="wa_campaigns" className="text-xs">WA Campaigns</TabsTrigger>
          <TabsTrigger value="email_log" className="text-xs">Email Log</TabsTrigger>
          <TabsTrigger value="wa_log" className="text-xs">WhatsApp Log</TabsTrigger>
          <TabsTrigger value="scheduled" className="text-xs">Scheduled</TabsTrigger>
        </TabsList>

        {/* Campaigns */}
        <TabsContent value="campaigns">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Send className="h-4 w-4" />Email Campaigns</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Subject</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs text-center">Recipients</TableHead>
                      <TableHead className="text-xs text-center">Sent</TableHead>
                      <TableHead className="text-xs text-center">Failed</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No campaigns found</TableCell></TableRow>
                    ) : campaigns.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm font-medium max-w-[200px] truncate">{c.subject}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(c.created_at), 'dd MMM yyyy HH:mm')}</TableCell>
                        <TableCell className="text-center text-sm">{c.recipient_count}</TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">{c.sent_count}</Badge></TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">{c.failed_count}</Badge></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            c.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            c.status === 'sending' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            c.status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-amber-50 text-amber-700 border-amber-200'
                          }>{c.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Log */}
        <TabsContent value="email_log">
          <Card>
            <CardHeader className="py-3 px-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <CardTitle className="text-sm flex items-center gap-2"><Mail className="h-4 w-4" />Individual Email Log</CardTitle>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Search by email..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-8 h-8 text-xs" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Recipient</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Sent At</TableHead>
                      <TableHead className="text-xs">Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSends.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">No email records found</TableCell></TableRow>
                    ) : filteredSends.slice(0, 100).map(s => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm">{s.recipient_email}</TableCell>
                        <TableCell>{statusBadge(String(s.status || 'pending'))}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.sent_at ? formatWhen(s.sent_at) : '—'}</TableCell>
                        <TableCell className="text-xs text-red-500 max-w-[200px] truncate">{s.error_message || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* WhatsApp Log */}
        <TabsContent value="wa_log">
          <Card>
            <CardHeader className="py-3 px-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4 text-emerald-500" />WhatsApp Log</CardTitle>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Search by phone..." value={waSearchQuery} onChange={e => setWaSearchQuery(e.target.value)} className="pl-8 h-8 text-xs" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Phone Number</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Sent At</TableHead>
                      <TableHead className="text-xs">Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredWaSends.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">No WhatsApp records found</TableCell></TableRow>
                    ) : filteredWaSends.slice(0, 100).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm font-mono">{s.recipient_phone || '—'}</TableCell>
                        <TableCell>{statusBadge(String(s.status || 'pending'))}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.sent_at ? formatWhen(s.sent_at) : '—'}</TableCell>
                        <TableCell className="text-xs text-red-500 max-w-[200px] truncate">{s.error_message || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Scheduled */}
        <TabsContent value="scheduled">
          <Card>
            <CardHeader className="py-3 px-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-amber-500" />Scheduled sends</CardTitle>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Search scheduled..." value={scheduledSearch} onChange={e => setScheduledSearch(e.target.value)} className="pl-8 h-8 text-xs" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Channel</TableHead>
                      <TableHead className="text-xs">Campaign</TableHead>
                      <TableHead className="text-xs">Recipient</TableHead>
                      <TableHead className="text-xs">Send at</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredScheduled.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No scheduled campaigns in this date range</TableCell></TableRow>
                    ) : filteredScheduled.slice(0, 100).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Badge variant="outline" className={row.channel === 'whatsapp' ? 'border-emerald-200 text-emerald-700 text-[10px]' : 'text-[10px]'}>
                            {row.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-medium max-w-[220px] truncate">{row.title}</TableCell>
                        <TableCell className="text-xs">{row.recipient}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatWhen(row.scheduledAt)}</TableCell>
                        <TableCell>{statusBadge(row.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* WhatsApp Campaigns */}
        <TabsContent value="wa_campaigns">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4 text-emerald-500" />WhatsApp Campaigns</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Title</TableHead>
                      <TableHead className="text-xs">Date</TableHead>
                      <TableHead className="text-xs text-center">Recipients</TableHead>
                      <TableHead className="text-xs text-center">Sent</TableHead>
                      <TableHead className="text-xs text-center">Failed</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {waCampaigns.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No WhatsApp campaigns found</TableCell></TableRow>
                    ) : waCampaigns.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm font-medium max-w-[200px] truncate">{c.subject}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(c.created_at), 'dd MMM yyyy HH:mm')}</TableCell>
                        <TableCell className="text-center text-sm">{c.recipient_count}</TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">{c.sent_count}</Badge></TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">{c.failed_count}</Badge></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            c.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            c.status === 'sending' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            c.status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-amber-50 text-amber-700 border-amber-200'
                          }>{c.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
