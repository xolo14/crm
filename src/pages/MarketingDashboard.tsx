import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { phpList, inDateRange } from '@/lib/phpList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Mail, Send, AlertTriangle, Clock, Users, Eye, Loader2,
  BarChart3, Filter, Calendar, TrendingUp, CheckCircle2, XCircle, Search,
  MessageSquare, UserPlus, Shuffle
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

interface CampaignStats {
  total_campaigns: number;
  total_sent: number;
  total_failed: number;
  total_pending: number;
}

interface MemberStats {
  member_id: string;
  member_name: string;
  member_email: string;
  total_campaigns: number;
  total_sent: number;
  total_failed: number;
  total_pending: number;
}

export default function MarketingDashboard() {
  const { role, user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const [members, setMembers] = useState<MarketingMember[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [sends, setSends] = useState<any[]>([]);
  const [waCampaigns, setWaCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  // Filters
  const [memberFilter, setMemberFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('7days');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Lead assignment
  const [formLeads, setFormLeads] = useState<any[]>([]);
  const [formLeadAssignments, setFormLeadAssignments] = useState<Record<string, string[]>>({});
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [assignMemberId, setAssignMemberId] = useState('');
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assigning, setAssigning] = useState(false);

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

      const leadsRes = await api.leads.list({ form_leads: true });
      setFormLeads(phpList(leadsRes));

      // Fetch lead assignment map for cases where assigned_to isn't directly set
      const assignmentRes = await api.leadAssignments.list();
      const assignmentRows = assignmentRes?.data || [];
      const assignmentMap: Record<string, string[]> = {};
      (assignmentRows || []).forEach((a: any) => {
        if (!assignmentMap[a.lead_id]) assignmentMap[a.lead_id] = [];
        assignmentMap[a.lead_id].push(a.user_id);
      });
      setFormLeadAssignments(assignmentMap);
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
  const totalEmails = totalSent + totalFailed + totalPending;

  // WhatsApp stats
  const waTotalCampaigns = waCampaigns.length;
  const waTotalSent = waCampaigns.reduce((sum, c) => sum + (c.sent_count || 0), 0);
  const waTotalFailed = waCampaigns.reduce((sum, c) => sum + (c.failed_count || 0), 0);
  const waTotalPending = waCampaigns.reduce((sum, c) => sum + (c.pending_count || 0), 0);

  // Member-wise stats
  const memberStats: MemberStats[] = members.map(m => {
    const memberCampaigns = campaigns.filter(c => c.created_by === m.id || c.created_by === m.user_id);
    const memberWaCampaigns = waCampaigns.filter(c => c.created_by === m.id || c.created_by === m.user_id);
    return {
      member_id: m.id,
      member_name: m.name,
      member_email: m.email,
      total_campaigns: memberCampaigns.length + memberWaCampaigns.length,
      total_sent: memberCampaigns.reduce((s, c) => s + (c.sent_count || 0), 0) + memberWaCampaigns.reduce((s, c) => s + (c.sent_count || 0), 0),
      total_failed: memberCampaigns.reduce((s, c) => s + (c.failed_count || 0), 0) + memberWaCampaigns.reduce((s, c) => s + (c.failed_count || 0), 0),
      total_pending: memberCampaigns.reduce((s, c) => s + (c.pending_count || 0), 0) + memberWaCampaigns.reduce((s, c) => s + (c.pending_count || 0), 0),
    };
  });

  const filteredSends = searchQuery
    ? sends.filter(s => s.recipient_email?.toLowerCase().includes(searchQuery.toLowerCase()))
    : sends;

  // Lead assignment
  const unassignedLeads = formLeads.filter(l => !l.assigned_to && !(formLeadAssignments[l.id]?.length > 0));
  const handleAssignLeads = async () => {
    if (selectedLeadIds.size === 0 || !assignMemberId) return;
    setAssigning(true);
    try {
      const member = members.find(m => m.id === assignMemberId);
      if (!member) throw new Error('Member not found');
      for (const leadId of selectedLeadIds) {
        // Keep legacy compatibility field
        await api.leads.update(leadId, { assigned_to: member.user_id || member.id });
        // Keep assignment relation in sync for reporting screens
        const existing = await api.leadAssignments.list(leadId);
        for (const a of existing?.data || []) {
          if (a?.id) await api.leadAssignments.delete(a.id);
        }
        await api.leadAssignments.assign({ lead_id: leadId, user_id: member.id });
      }
      toast({ title: `${selectedLeadIds.size} leads assigned to ${member.name}` });
      setSelectedLeadIds(new Set());
      setShowAssignDialog(false);
      setAssignMemberId('');
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally { setAssigning(false); }
  };

  const toggleLeadSelect = (id: string) => {
    setSelectedLeadIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleAllLeads = () => {
    if (selectedLeadIds.size === unassignedLeads.length) setSelectedLeadIds(new Set());
    else setSelectedLeadIds(new Set(unassignedLeads.map(l => l.id)));
  };

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
            Email & WhatsApp campaigns, templates, member activity & analytics
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
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center gap-2 mb-1"><Users className="h-4 w-4 text-blue-500" /><span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Unassigned Leads</span></div>
            <p className="text-xl md:text-2xl font-bold text-blue-600">{unassignedLeads.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full md:w-auto overflow-x-auto">
          <TabsTrigger value="overview" className="text-xs">Members</TabsTrigger>
          <TabsTrigger value="assign_leads" className="text-xs">Assign Leads</TabsTrigger>
          <TabsTrigger value="campaigns" className="text-xs">Email Campaigns</TabsTrigger>
          <TabsTrigger value="wa_campaigns" className="text-xs">WA Campaigns</TabsTrigger>
          <TabsTrigger value="email_log" className="text-xs">Email Log</TabsTrigger>
        </TabsList>

        {/* Members Overview */}
        <TabsContent value="overview">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" />Marketing Members Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Member</TableHead>
                      <TableHead className="text-xs">Email</TableHead>
                      <TableHead className="text-xs text-center">Campaigns</TableHead>
                      <TableHead className="text-xs text-center">Sent</TableHead>
                      <TableHead className="text-xs text-center">Failed</TableHead>
                      <TableHead className="text-xs text-center">Pending</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {memberStats.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No marketing members yet</TableCell></TableRow>
                    ) : memberStats.map(ms => {
                      const member = members.find(m => m.id === ms.member_id);
                      return (
                        <TableRow key={ms.member_id}>
                          <TableCell className="text-sm font-medium">{ms.member_name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{ms.member_email}</TableCell>
                          <TableCell className="text-center text-sm">{ms.total_campaigns}</TableCell>
                          <TableCell className="text-center"><Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">{ms.total_sent}</Badge></TableCell>
                          <TableCell className="text-center"><Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">{ms.total_failed}</Badge></TableCell>
                          <TableCell className="text-center"><Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">{ms.total_pending}</Badge></TableCell>
                          <TableCell><Badge className={member?.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'} variant="outline">{member?.status || 'active'}</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

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
                        <TableCell>
                          <Badge variant="outline" className={
                            s.status === 'sent' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            s.status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
                            'bg-amber-50 text-amber-700 border-amber-200'
                          }>{s.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.sent_at ? format(new Date(s.sent_at), 'dd MMM HH:mm') : '—'}</TableCell>
                        <TableCell className="text-xs text-red-500 max-w-[200px] truncate">{s.error_message || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        {/* Assign Leads */}
        <TabsContent value="assign_leads">
          <Card>
            <CardHeader className="py-3 px-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <CardTitle className="text-sm flex items-center gap-2"><UserPlus className="h-4 w-4" />Assign Leads to Marketing Members</CardTitle>
                {selectedLeadIds.size > 0 && (
                  <Button size="sm" className="gap-1.5" onClick={() => setShowAssignDialog(true)}>
                    <Shuffle className="h-3.5 w-3.5" />Assign {selectedLeadIds.size} Leads
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"><Checkbox checked={unassignedLeads.length > 0 && selectedLeadIds.size === unassignedLeads.length} onCheckedChange={toggleAllLeads} /></TableHead>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Email</TableHead>
                      <TableHead className="text-xs">Phone</TableHead>
                      <TableHead className="text-xs">Source</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Assigned To</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {formLeads.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No form leads found</TableCell></TableRow>
                    ) : formLeads.slice(0, 100).map(l => {
                      const fallbackAssignedUserId = (formLeadAssignments[l.id] || [])[0];
                      const assignedMember = members.find(m =>
                        m.id === l.assigned_to ||
                        m.user_id === l.assigned_to ||
                        m.id === fallbackAssignedUserId ||
                        m.user_id === fallbackAssignedUserId
                      );
                      return (
                        <TableRow key={l.id}>
                          <TableCell><Checkbox checked={selectedLeadIds.has(l.id)} onCheckedChange={() => toggleLeadSelect(l.id)} disabled={!!l.assigned_to} /></TableCell>
                          <TableCell className="text-sm font-medium">{l.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{l.email || '—'}</TableCell>
                          <TableCell className="text-xs">{l.phone || '—'}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{l.source || 'other'}</Badge></TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{l.status || 'new'}</Badge></TableCell>
                          <TableCell className="text-xs">{assignedMember ? <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">{assignedMember.name}</Badge> : <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                        </TableRow>
                      );
                    })}
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

      {/* Assign Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign {selectedLeadIds.size} Leads to Marketing Member</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Select Marketing Member</Label>
              <Select value={assignMemberId} onValueChange={setAssignMemberId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Choose member" /></SelectTrigger>
                <SelectContent>
                  {members.filter(m => m.status === 'active').map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name} ({m.email})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button onClick={handleAssignLeads} disabled={assigning || !assignMemberId} className="w-full gap-1.5">
                {assigning && <Loader2 className="h-4 w-4 animate-spin" />}
                Assign Leads
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
