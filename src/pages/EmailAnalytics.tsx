import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  BarChart3, Mail, CheckCircle2, XCircle, Clock, Loader2,
  Search, Filter, TrendingUp, ArrowLeft, PieChart, Activity
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay, startOfWeek, endOfWeek } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent
} from '@/components/ui/chart';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  PieChart as RechartsPie, Pie, Cell, LineChart, Line, Tooltip, Legend
} from 'recharts';

const STATUS_COLORS: Record<string, string> = {
  sent: '#10b981',
  failed: '#ef4444',
  pending: '#f59e0b',
  sending: '#3b82f6',
  completed: '#10b981',
};

export default function EmailAnalytics() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [sends, setSends] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);

  const [dateFilter, setDateFilter] = useState('30days');
  const [memberFilter, setMemberFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  const isSuperAdmin = role === 'super_admin' || role === 'admin';
  const isMarketing = role === 'marketing';

  useEffect(() => { fetchData(); }, [dateFilter, memberFilter, customFrom, customTo]);

  const getDateRange = () => {
    const now = new Date();
    switch (dateFilter) {
      case 'today': return { from: startOfDay(now), to: endOfDay(now) };
      case '7days': return { from: subDays(now, 7), to: now };
      case '30days': return { from: subDays(now, 30), to: now };
      case 'this_week': return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
      case 'custom':
        return { from: customFrom ? new Date(customFrom) : subDays(now, 30), to: customTo ? new Date(customTo) : now };
      default: return { from: subDays(now, 30), to: now };
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const { from, to } = getDateRange();
      let membersData: any[] = [];

      // Members (for super admin)
      if (isSuperAdmin) {
        const teamData = await api.team.list();
        membersData = (teamData?.data || [])
          .filter((m: any) => String(m.role || '').startsWith('marketing'))
          .map((m: any) => ({
            id: m.id,
            name: m.full_name || m.email,
            email: m.email,
            phone: m.phone || null,
            status: m.is_active ? 'active' : 'inactive',
            created_at: m.created_at,
          }));
        setMembers(membersData);
      } else {
        setMembers([]);
      }

      // Campaigns
      let q = supabase.from('email_campaigns').select('*')
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())
        .order('created_at', { ascending: false });

      if (isMarketing) q = q.eq('created_by', user?.id || '');
      if (memberFilter !== 'all' && isSuperAdmin) {
        const member = membersData.find(m => m.id === memberFilter);
        if (member) q = q.eq('created_by', member.id);
      }

      const { data: campData } = await q;
      setCampaigns(campData || []);

      if (campData && campData.length > 0) {
        const ids = campData.map(c => c.id);
        const { data: sendsData } = await supabase.from('email_sends').select('*')
          .in('campaign_id', ids).order('created_at', { ascending: false }).limit(1000);
        setSends(sendsData || []);
      } else {
        setSends([]);
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Stats
  const totalCampaigns = campaigns.length;
  const totalSent = campaigns.reduce((s, c) => s + (c.sent_count || 0), 0);
  const totalFailed = campaigns.reduce((s, c) => s + (c.failed_count || 0), 0);
  const totalPending = campaigns.reduce((s, c) => s + (c.pending_count || 0), 0);
  const totalRecipients = campaigns.reduce((s, c) => s + (c.recipient_count || 0), 0);
  const deliveryRate = totalRecipients > 0 ? ((totalSent / totalRecipients) * 100).toFixed(1) : '0';

  // Chart data: status distribution
  const pieData = [
    { name: 'Sent', value: totalSent, color: STATUS_COLORS.sent },
    { name: 'Failed', value: totalFailed, color: STATUS_COLORS.failed },
    { name: 'Pending', value: totalPending, color: STATUS_COLORS.pending },
  ].filter(d => d.value > 0);

  // Chart data: daily trend (last 7 or 30 days)
  const dailyData = (() => {
    const days = dateFilter === '7days' || dateFilter === 'today' || dateFilter === 'this_week' ? 7 : 30;
    const result: { date: string; sent: number; failed: number; pending: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = subDays(new Date(), i);
      const dateStr = format(d, 'yyyy-MM-dd');
      const dayCampaigns = campaigns.filter(c => format(new Date(c.created_at), 'yyyy-MM-dd') === dateStr);
      result.push({
        date: format(d, 'dd MMM'),
        sent: dayCampaigns.reduce((s, c) => s + (c.sent_count || 0), 0),
        failed: dayCampaigns.reduce((s, c) => s + (c.failed_count || 0), 0),
        pending: dayCampaigns.reduce((s, c) => s + (c.pending_count || 0), 0),
      });
    }
    return result;
  })();

  // Filtered sends for log
  const filteredSends = sends.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (searchQuery && !s.recipient_email?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  // Campaign-level chart
  const campaignChartData = campaigns.slice(0, 10).map(c => ({
    name: c.subject?.substring(0, 20) || 'No subject',
    sent: c.sent_count || 0,
    failed: c.failed_count || 0,
    pending: c.pending_count || 0,
  }));

  const chartConfig = {
    sent: { label: 'Sent', color: STATUS_COLORS.sent },
    failed: { label: 'Failed', color: STATUS_COLORS.failed },
    pending: { label: 'Pending', color: STATUS_COLORS.pending },
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate(isMarketing ? '/marketing/portal' : '/marketing-admin')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
              <BarChart3 className="h-5 w-5 md:h-6 md:w-6 text-primary" />
              Email Analytics
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground">Campaign performance & delivery insights</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            {isSuperAdmin && (
              <Select value={memberFilter} onValueChange={setMemberFilter}>
                <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="All Members" /></SelectTrigger>
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
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: 'Campaigns', value: totalCampaigns, icon: BarChart3, color: 'primary', borderColor: 'border-l-primary' },
          { label: 'Total Emails', value: totalRecipients, icon: Mail, color: 'blue-500', borderColor: 'border-l-blue-500' },
          { label: 'Sent', value: totalSent, icon: CheckCircle2, color: 'emerald-500', borderColor: 'border-l-emerald-500' },
          { label: 'Failed', value: totalFailed, icon: XCircle, color: 'red-500', borderColor: 'border-l-red-500' },
          { label: 'Pending', value: totalPending, icon: Clock, color: 'amber-500', borderColor: 'border-l-amber-500' },
          { label: 'Delivery %', value: `${deliveryRate}%`, icon: TrendingUp, color: 'purple-500', borderColor: 'border-l-purple-500' },
        ].map(stat => (
          <Card key={stat.label} className={`border-l-4 ${stat.borderColor}`}>
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <stat.icon className={`h-3.5 w-3.5 text-${stat.color}`} />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{stat.label}</span>
              </div>
              <p className="text-lg md:text-xl font-bold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full md:w-auto">
          <TabsTrigger value="overview" className="text-xs gap-1"><PieChart className="h-3 w-3" />Overview</TabsTrigger>
          <TabsTrigger value="trends" className="text-xs gap-1"><Activity className="h-3 w-3" />Trends</TabsTrigger>
          <TabsTrigger value="campaigns" className="text-xs gap-1"><BarChart3 className="h-3 w-3" />Campaigns</TabsTrigger>
          <TabsTrigger value="log" className="text-xs gap-1"><Mail className="h-3 w-3" />Email Log</TabsTrigger>
        </TabsList>

        {/* Overview - Pie + Summary */}
        <TabsContent value="overview">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2"><PieChart className="h-4 w-4" />Status Distribution</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                {pieData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No data for this period</p>
                ) : (
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPie>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                          {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                        </Pie>
                        <Tooltip />
                      </RechartsPie>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" />Campaign Performance</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                {campaignChartData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No campaigns in this period</p>
                ) : (
                  <ChartContainer config={chartConfig} className="h-[250px]">
                    <BarChart data={campaignChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="sent" fill="var(--color-sent)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="failed" fill="var(--color-failed)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="pending" fill="var(--color-pending)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Trends - Line Chart */}
        <TabsContent value="trends">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />Daily Email Trends</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <ChartContainer config={chartConfig} className="h-[300px]">
                <LineChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="sent" stroke="var(--color-sent)" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="failed" stroke="var(--color-failed)" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="pending" stroke="var(--color-pending)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Campaigns Table */}
        <TabsContent value="campaigns">
          <Card>
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
                      <TableHead className="text-xs text-center">Pending</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No campaigns found</TableCell></TableRow>
                    ) : campaigns.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm font-medium max-w-[200px] truncate">{c.subject}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(c.created_at), 'dd MMM yyyy HH:mm')}</TableCell>
                        <TableCell className="text-center text-sm">{c.recipient_count}</TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">{c.sent_count}</Badge></TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">{c.failed_count}</Badge></TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">{c.pending_count}</Badge></TableCell>
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
        <TabsContent value="log">
          <Card>
            <CardHeader className="py-3 px-4">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Search by email..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-8 h-8 text-xs" />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
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
                      <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">No emails found</TableCell></TableRow>
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
      </Tabs>
    </div>
  );
}
