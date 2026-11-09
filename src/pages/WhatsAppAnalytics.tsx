import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { phpList } from '@/lib/phpList';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  BarChart3, MessageSquare, CheckCircle2, XCircle, Clock, Loader2,
  Filter, TrendingUp, ArrowLeft, PieChart, Activity
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay, startOfWeek, endOfWeek, differenceInCalendarDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer,
  PieChart as RechartsPie, Pie, Cell, LineChart, Line, Tooltip
} from 'recharts';

const STATUS_COLORS: Record<string, string> = { sent: '#10b981', failed: '#ef4444', pending: '#f59e0b', sending: '#3b82f6', completed: '#10b981' };

function waSendTone(row: { status?: string | null }): 'sent' | 'failed' | 'pending' {
  const status = String(row.status || '').trim().toLowerCase();
  if (status === 'sent' || status === 'delivered' || status === 'read') return 'sent';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function sendStamp(row: { sent_at?: string | null; created_at?: string | null }) {
  return row.sent_at || row.created_at || '';
}

function sendInRange(row: { sent_at?: string | null; created_at?: string | null }, from: Date | null, to: Date | null) {
  if (!from && !to) return true;
  const stamp = sendStamp(row);
  if (!stamp) return false;
  const d = new Date(stamp);
  if (Number.isNaN(d.getTime())) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function summarizeRows(rows: any[]) {
  let sent = 0;
  let failed = 0;
  let pending = 0;
  for (const row of rows) {
    const tone = waSendTone(row);
    if (tone === 'sent') sent += 1;
    else if (tone === 'failed') failed += 1;
    else pending += 1;
  }
  return { sent, failed, pending, total: rows.length };
}

export default function WhatsAppAnalytics({
  embedded = false,
  campaigns: campaignsFeed,
  sends: sendsFeed,
}: {
  embedded?: boolean;
  campaigns?: any[];
  sends?: any[];
}) {
  const { role } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [sends, setSends] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [dateFilter, setDateFilter] = useState('all');
  const [memberFilter, setMemberFilter] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const isSuperAdmin = role === 'super_admin' || role === 'org';
  const isPortalMarketer = role === 'marketing' || role === 'operational_manager';
  const mineOnly = role === 'marketing';
  const hasFeed = Array.isArray(campaignsFeed) && Array.isArray(sendsFeed);

  useEffect(() => { fetchData(); }, [memberFilter, hasFeed, campaignsFeed, sendsFeed]);

  const getDateRange = (): { from: Date | null; to: Date | null } => {
    const now = new Date();
    switch (dateFilter) {
      case 'all': return { from: null, to: null };
      case 'today': return { from: startOfDay(now), to: endOfDay(now) };
      case '7days': return { from: subDays(now, 7), to: now };
      case '30days': return { from: subDays(now, 30), to: now };
      case 'this_week': return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
      case 'custom': return { from: customFrom ? new Date(customFrom) : null, to: customTo ? endOfDay(new Date(customTo)) : now };
      default: return { from: null, to: null };
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      let membersData: any[] = [];
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
      let campData = hasFeed
        ? [...campaignsFeed]
        : phpList(await api.marketing.whatsappCampaigns(mineOnly ? { mine: true } : undefined));
      if (memberFilter !== 'all' && isSuperAdmin) {
        const member = membersData.find((m: any) => m.id === memberFilter);
        if (member) {
          campData = campData.filter((c) => c.created_by === member.id || c.created_by === member.user_id);
        }
      }
      setCampaigns(campData);
      if (hasFeed) {
        const allowed = new Set(campData.map((c) => String(c.id)));
        setSends(sendsFeed.filter((row) => allowed.has(String(row.campaign_id || ''))));
      } else if (campData.length > 0) {
        const sendsRes = await api.marketing.whatsappSends(campData.map((c: any) => c.id));
        setSends(phpList(sendsRes));
      } else {
        setSends([]);
      }
    } catch (err: any) { toast({ variant: 'destructive', title: 'Error', description: err.message }); }
    finally { setLoading(false); }
  };

  const { from, to } = getDateRange();
  const filteredSends = useMemo(
    () => sends.filter((row) => sendInRange(row, from, to)),
    [sends, dateFilter, customFrom, customTo],
  );

  const kpis = summarizeRows(filteredSends);
  const campaignIdsInRange = useMemo(() => {
    const ids = new Set<string>();
    for (const row of filteredSends) {
      const id = String(row.campaign_id || '');
      if (id) ids.add(id);
    }
    return ids;
  }, [filteredSends]);

  const totalCampaigns = dateFilter === 'all' ? campaigns.length : campaignIdsInRange.size;
  const totalSent = kpis.sent;
  const totalFailed = kpis.failed;
  const totalPending = kpis.pending;
  const totalRecipients = kpis.total;
  const deliveryBase = totalSent + totalFailed + totalPending;
  const deliveryRate = deliveryBase > 0 ? ((totalSent / deliveryBase) * 100).toFixed(1) : '0';

  const pieData = [
    { name: 'Sent', value: totalSent, color: STATUS_COLORS.sent },
    { name: 'Failed', value: totalFailed, color: STATUS_COLORS.failed },
    { name: 'Pending', value: totalPending, color: STATUS_COLORS.pending },
  ].filter(d => d.value > 0);

  const trendDays = (() => {
    if (dateFilter === '7days' || dateFilter === 'today' || dateFilter === 'this_week') return 7;
    if (dateFilter === 'custom' && from && to) return Math.min(60, Math.max(1, differenceInCalendarDays(to, from) + 1));
    if (dateFilter === 'all') {
      const times = filteredSends
        .map((row) => sendStamp(row))
        .filter(Boolean)
        .map((stamp) => new Date(stamp).getTime())
        .filter((n) => Number.isFinite(n));
      if (!times.length) return 30;
      return Math.min(90, Math.max(7, differenceInCalendarDays(new Date(), new Date(Math.min(...times))) + 1));
    }
    return 30;
  })();

  const dailyData = (() => {
    const result: any[] = [];
    for (let i = trendDays - 1; i >= 0; i--) {
      const d = subDays(new Date(), i);
      const dateStr = format(d, 'yyyy-MM-dd');
      let sent = 0;
      let failed = 0;
      let pending = 0;
      for (const row of filteredSends) {
        const stamp = sendStamp(row);
        if (!stamp) continue;
        if (format(new Date(stamp), 'yyyy-MM-dd') !== dateStr) continue;
        const tone = waSendTone(row);
        if (tone === 'sent') sent += 1;
        else if (tone === 'failed') failed += 1;
        else pending += 1;
      }
      result.push({ date: format(d, 'dd MMM'), sent, failed, pending });
    }
    return result;
  })();

  const campaignChartData = campaigns
    .map((c: any) => {
      const rows = filteredSends.filter((row) => String(row.campaign_id) === String(c.id));
      if (rows.length === 0) return null;
      const sum = summarizeRows(rows);
      return {
        name: c.subject?.substring(0, 20) || 'No title',
        sent: sum.sent,
        failed: sum.failed,
        pending: sum.pending,
        volume: sum.total,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10);

  const chartConfig = { sent: { label: 'Sent', color: STATUS_COLORS.sent }, failed: { label: 'Failed', color: STATUS_COLORS.failed }, pending: { label: 'Pending', color: STATUS_COLORS.pending } };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4 md:space-y-6">
      {!embedded ? (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate(isPortalMarketer ? '/marketing/whatsapp' : '/marketing-admin')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
              <MessageSquare className="h-5 w-5 md:h-6 md:w-6 text-emerald-500" />WhatsApp Analytics
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground">Campaign performance & delivery insights</p>
          </div>
        </div>
      </div>
      ) : null}

      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            {isSuperAdmin && (
              <Select value={memberFilter} onValueChange={setMemberFilter}>
                <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="All Members" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Members</SelectItem>
                  {members.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
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

      {!embedded ? (
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: 'Campaigns', value: totalCampaigns, icon: BarChart3, color: 'text-emerald-600', borderColor: 'border-l-emerald-600' },
          { label: 'Total Messages', value: totalRecipients, icon: MessageSquare, color: 'text-blue-500', borderColor: 'border-l-blue-500' },
          { label: 'Sent', value: totalSent, icon: CheckCircle2, color: 'text-emerald-500', borderColor: 'border-l-emerald-500' },
          { label: 'Failed', value: totalFailed, icon: XCircle, color: 'text-red-500', borderColor: 'border-l-red-500' },
          { label: 'Pending', value: totalPending, icon: Clock, color: 'text-amber-500', borderColor: 'border-l-amber-500' },
          { label: 'Delivery %', value: `${deliveryRate}%`, icon: TrendingUp, color: 'text-purple-500', borderColor: 'border-l-purple-500' },
        ].map(stat => (
          <Card key={stat.label} className={`border-l-4 ${stat.borderColor}`}>
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <stat.icon className={`h-3.5 w-3.5 ${stat.color}`} />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{stat.label}</span>
              </div>
              <p className="text-lg md:text-xl font-bold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      ) : null}

      <div className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="py-3 px-4"><CardTitle className="text-sm flex items-center gap-2"><PieChart className="h-4 w-4" />Status Distribution</CardTitle></CardHeader>
            <CardContent className="pb-4">
              {pieData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data</p> : (
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPie><Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie><Tooltip /></RechartsPie>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-3 px-4"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" />Campaign Performance</CardTitle></CardHeader>
            <CardContent className="pb-4">
              {campaignChartData.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No campaigns</p> : (
                <ChartContainer config={chartConfig} className="h-[250px]">
                  <BarChart data={campaignChartData}>
                    <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="sent" stackId="status" fill="var(--color-sent)" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="failed" stackId="status" fill="var(--color-failed)" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="pending" stackId="status" fill="var(--color-pending)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="py-3 px-4"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />Daily Message Trends</CardTitle></CardHeader>
          <CardContent className="pb-4">
            <ChartContainer config={chartConfig} className="h-[300px]">
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="sent" stroke="var(--color-sent)" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="failed" stroke="var(--color-failed)" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="pending" stroke="var(--color-pending)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
