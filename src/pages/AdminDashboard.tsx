import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, Building2, Layers, IndianRupee, TrendingUp, Shield, Activity, Loader2, Link2, GraduationCap } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import { DateRangeFilter, DateRange } from '@/components/DateRangeFilter';
import { parseServerDateTime, buildDailyLeadTrend } from '@/lib/dateTime';
import { useIsMobile } from '@/hooks/use-mobile';
import { computeLeadKpis, normalizeLeadsByStatus } from '@/lib/dashboardKpis';
import AssignedAssignmentsCard from '@/components/assignments/AssignedAssignmentsCard';
import { formatFormSourceLabel, FORM_SOURCE_PREFIX } from '@/lib/leadSources';

const COLORS = [
  'hsl(162, 63%, 41%)',
  'hsl(200, 70%, 50%)',
  'hsl(38, 92%, 50%)',
  'hsl(0, 70%, 55%)',
  'hsl(270, 60%, 55%)',
  'hsl(330, 70%, 55%)',
  'hsl(45, 80%, 50%)',
  'hsl(180, 60%, 45%)',
];

const SOURCE_LABELS: Record<string, string> = {
  google_ads: 'Google Ads',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  website: 'Website',
  google_forms: 'Google Forms',
  whatsapp: 'WhatsApp',
  referral: 'Referral',
  walkin: 'Walk-in',
  college_seminar: 'College Seminar',
  other: 'Other',
  peaklyy: 'Peaklyy',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  not_answered: 'Not answered',
  messaged: 'Messaged',
  interested: 'Interested',
  demo_scheduled: 'Demo Scheduled',
  demo_attended: 'Demo Attended',
  considering: 'Considering',
  enrolled: 'Enroll',
  converted: 'Enroll',
  lost: 'Lost',
};

const MAX_SOURCE_SLICES = 6;

function formatSourceName(raw: string, formLabels: Record<string, string>): string {
  const key = String(raw || 'other').trim() || 'other';
  const lower = key.toLowerCase();
  if (SOURCE_LABELS[lower]) return SOURCE_LABELS[lower];
  if (formLabels[key] || formLabels[lower]) return formLabels[key] || formLabels[lower];
  if (lower.startsWith('peaklyy')) return 'Peaklyy';
  if (lower.startsWith(FORM_SOURCE_PREFIX)) {
    return formatFormSourceLabel(lower, formLabels);
  }
  return key
    .replace(/^form_/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || 'Other';
}

export default function AdminDashboard() {
  const { profile, organization, role } = useAuth();
  const isMobile = useIsMobile();
  const [dateRange, setDateRange] = useState<DateRange>({});
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsByStatusServer, setLeadsByStatusServer] = useState<Record<string, number>>({});
  const [batchesCount, setBatchesCount] = useState(0);
  const [activeBatches, setActiveBatches] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [pendingRevenue, setPendingRevenue] = useState(0);
  const [referralData, setReferralData] = useState<any[]>([]);
  const [formLabels, setFormLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetchData();
    void fetchFormLabels();
  }, []);

  const fetchFormLabels = async () => {
    try {
      const res = await api.forms.list();
      const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      const map: Record<string, string> = {};
      for (const f of rows) {
        const slug = String(f?.slug || '').trim();
        const name = String(f?.name || '').trim();
        if (!slug || !name) continue;
        map[slug] = name;
        map[`form_${slug}`] = name;
        map[slug.toLowerCase()] = name;
        map[`form_${slug.toLowerCase()}`] = name;
      }
      setFormLabels(map);
    } catch {
      /* optional */
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await api.profiles.dashboard();
      const payload =
        data?.leads != null || data?.leads_total != null ? data : data?.data || data || {};
      const allLeads = payload.leads || [];
      setLeads(allLeads);
      setLeadsTotal(Number(payload.leads_total ?? allLeads.length) || allLeads.length);
      setLeadsByStatusServer(normalizeLeadsByStatus(payload.leads_by_status));
      setBatchesCount(payload.batches_count || 0);
      setActiveBatches(payload.active_batches || 0);
      setTotalRevenue(Number(payload.total_revenue || 0));
      setPendingRevenue(Number(payload.pending_revenue || 0));

      const profiles = payload.profiles || [];
      const refMap = new Map<
        string,
        { rep_name: string; referral_code: string; leads_count: number; converted: number }
      >();
      for (const p of profiles) {
        if (p.referral_code) {
          refMap.set(p.referral_code, {
            rep_name: p.full_name || 'Unknown',
            referral_code: p.referral_code,
            leads_count: 0,
            converted: 0,
          });
        }
      }
      for (const lead of allLeads) {
        if (lead.referred_by && refMap.has(lead.referred_by)) {
          const e = refMap.get(lead.referred_by)!;
          e.leads_count++;
          if (lead.status === 'converted' || lead.status === 'enrolled') e.converted++;
        }
      }
      setReferralData(
        Array.from(refMap.values())
          .filter((r) => r.leads_count > 0)
          .sort((a, b) => b.leads_count - a.leads_count),
      );
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filteredLeads = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return leads;
    return leads.filter((l) => {
      const d = parseServerDateTime(l.created_at);
      if (!d) return true;
      const t = d.getTime();
      if (dateRange.from && t < dateRange.from.getTime()) return false;
      if (dateRange.to && t > dateRange.to.getTime()) return false;
      return true;
    });
  }, [leads, dateRange]);

  const leadsByStatus = useMemo(() => {
    const hasDateFilter = !!(dateRange.from || dateRange.to);
    if (!hasDateFilter && Object.keys(leadsByStatusServer).length > 0) {
      const c: Record<string, number> = {};
      for (const [raw, n] of Object.entries(leadsByStatusServer)) {
        let key = raw || 'new';
        if (key === 'converted') key = 'enrolled';
        c[key] = (c[key] || 0) + Number(n || 0);
      }
      return Object.entries(c)
        .map(([name, value]) => ({ name: STATUS_LABELS[name] || name.replace(/_/g, ' '), value }))
        .sort((a, b) => b.value - a.value);
    }
    const c: Record<string, number> = {};
    for (const l of filteredLeads) {
      let s = l.status || 'new';
      if (s === 'converted') s = 'enrolled';
      c[s] = (c[s] || 0) + 1;
    }
    return Object.entries(c)
      .map(([name, value]) => ({ name: STATUS_LABELS[name] || name.replace(/_/g, ' '), value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredLeads, leadsByStatusServer, dateRange.from, dateRange.to]);

  const leadsBySource = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of filteredLeads) {
      const raw = String(l.source || 'other').trim() || 'other';
      const label = formatSourceName(raw, formLabels);
      c[label] = (c[label] || 0) + 1;
    }
    const sorted = Object.entries(c)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    if (sorted.length <= MAX_SOURCE_SLICES) return sorted;
    const top = sorted.slice(0, MAX_SOURCE_SLICES - 1);
    const rest = sorted.slice(MAX_SOURCE_SLICES - 1);
    const otherValue = rest.reduce((sum, row) => sum + row.value, 0);
    const otherIdx = top.findIndex((r) => r.name === 'Other');
    if (otherIdx >= 0) {
      top[otherIdx] = { ...top[otherIdx], value: top[otherIdx].value + otherValue };
      return top;
    }
    return [...top, { name: 'Other', value: otherValue }];
  }, [filteredLeads, formLabels]);

  const dailyTrend = useMemo(() => buildDailyLeadTrend(filteredLeads, 14), [filteredLeads]);

  const hasDateFilter = !!(dateRange.from || dateRange.to);
  const { total: totalLeads, converted } = computeLeadKpis({
    hasDateFilter,
    leads: filteredLeads,
    leadsTotal,
    byStatus: leadsByStatusServer,
  });
  const convRate = totalLeads > 0 ? Math.round((converted / totalLeads) * 100) : 0;

  const fmt = (val: number) =>
    val >= 100000 ? `₹${(val / 100000).toFixed(1)}L` : val >= 1000 ? `₹${(val / 1000).toFixed(1)}K` : `₹${val}`;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isSuperAdminOrgView = role === 'super_admin' && !!organization;
  const headerTitle = isSuperAdminOrgView
    ? `${organization?.name || 'Organization'} CRM`
    : `Welcome${profile?.full_name ? `, ${profile.full_name}` : ''} 👋`;
  const headerSubtitle = isSuperAdminOrgView
    ? `Organization dashboard for ${organization?.name || 'selected organization'}`
    : 'Complete overview of your edutech platform';
  const headerBadge = isSuperAdminOrgView ? 'Organization View' : 'Admin';

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-xs">
              <Shield className="h-3 w-3 mr-1" />
              {headerBadge}
            </Badge>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight mt-1">{headerTitle}</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">{headerSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 mb-5">
        {[
          {
            label: 'Total Leads',
            value: totalLeads,
            icon: Users,
            sub: `${converted} enroll`,
            bg: 'from-emerald-500/10 to-teal-500/10',
            ic: 'text-emerald-600',
          },
          {
            label: 'Organization',
            value: organization?.name || '-',
            icon: Building2,
            sub: organization?.slug || 'Current workspace',
            bg: 'from-blue-500/10 to-indigo-500/10',
            ic: 'text-blue-600',
          },
          {
            label: 'Batches',
            value: activeBatches,
            icon: Layers,
            sub: `${batchesCount} total`,
            bg: 'from-purple-500/10 to-pink-500/10',
            ic: 'text-purple-600',
          },
          {
            label: 'Enrolled',
            value: converted,
            icon: GraduationCap,
            sub: `${convRate}% conversion`,
            bg: 'from-teal-500/10 to-emerald-500/10',
            ic: 'text-teal-600',
          },
          {
            label: 'Revenue',
            value: fmt(totalRevenue),
            icon: IndianRupee,
            sub: `${fmt(pendingRevenue)} pending`,
            bg: 'from-green-500/10 to-emerald-500/10',
            ic: 'text-green-600',
          },
          {
            label: 'Conv. Rate',
            value: `${convRate}%`,
            icon: TrendingUp,
            sub: 'Leads → Students',
            bg: 'from-teal-500/10 to-cyan-500/10',
            ic: 'text-teal-600',
          },
        ].map((c) => (
          <Card key={c.label} className="border-border/50 shadow-none hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-1 px-3 pt-3">
              <CardTitle className="text-xs font-medium text-muted-foreground">{c.label}</CardTitle>
              <div className={`h-7 w-7 rounded-lg bg-gradient-to-br ${c.bg} flex items-center justify-center`}>
                <c.icon className={`h-3.5 w-3.5 ${c.ic}`} />
              </div>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="text-lg font-bold">{c.value}</div>
              <p className="text-[10px] text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <AssignedAssignmentsCard />

      <Card className="mb-5 border-border/50 shadow-none">
        <CardHeader className="px-3 sm:px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Daily Lead Trend
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 sm:px-4">
          {dailyTrend.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No trend data</p>
          ) : (
            <ResponsiveContainer width="100%" height={isMobile ? 180 : 240}>
              <LineChart data={dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: isMobile ? 8 : 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                />
                <Line type="monotone" dataKey="leads" stroke="hsl(162, 63%, 41%)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <Card className="border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4">
            <CardTitle className="text-sm font-semibold">Lead Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            {leadsByStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={isMobile ? 200 : 260}>
                <BarChart data={leadsByStatus}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: isMobile ? 8 : 10 }}
                    stroke="hsl(var(--muted-foreground))"
                    interval={0}
                    angle={isMobile ? -25 : 0}
                    textAnchor={isMobile ? 'end' : 'middle'}
                    height={isMobile ? 50 : 30}
                  />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 10,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="value" fill="hsl(162, 63%, 41%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4">
            <CardTitle className="text-sm font-semibold">Leads by Source</CardTitle>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            {leadsBySource.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No data</p>
            ) : (
              <div className="flex flex-col gap-3">
                <ResponsiveContainer width="100%" height={isMobile ? 180 : 220}>
                  <PieChart>
                    <Pie
                      data={leadsBySource}
                      cx="50%"
                      cy="50%"
                      innerRadius={isMobile ? 40 : 55}
                      outerRadius={isMobile ? 70 : 85}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {leadsBySource.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, _name, item) => {
                        const total = leadsBySource.reduce((s, r) => s + r.value, 0);
                        const pct = total > 0 ? Math.round((Number(value) / total) * 100) : 0;
                        return [`${value} (${pct}%)`, item?.payload?.name || 'Source'];
                      }}
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 10,
                        fontSize: 12,
                      }}
                    />
                    {!isMobile && (
                      <Legend
                        layout="vertical"
                        align="right"
                        verticalAlign="middle"
                        wrapperStyle={{ fontSize: 12, maxWidth: 160 }}
                        formatter={(value) => (
                          <span className="text-foreground text-xs">{String(value)}</span>
                        )}
                      />
                    )}
                  </PieChart>
                </ResponsiveContainer>
                {isMobile && (
                  <ul className="grid grid-cols-1 gap-1.5 px-1">
                    {leadsBySource.map((row, i) => {
                      const total = leadsBySource.reduce((s, r) => s + r.value, 0);
                      const pct = total > 0 ? Math.round((row.value / total) * 100) : 0;
                      return (
                        <li key={row.name} className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-2.5 w-2.5 rounded-sm shrink-0"
                              style={{ background: COLORS[i % COLORS.length] }}
                            />
                            <span className="truncate">{row.name}</span>
                          </span>
                          <span className="tabular-nums text-muted-foreground shrink-0">
                            {row.value} · {pct}%
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {referralData.length > 0 && (
        <Card className="mb-5 border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Form Leads by Rep
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-4">
            {isMobile ? (
              <div className="space-y-2 px-3">
                {referralData.map((r) => (
                  <div
                    key={r.referral_code}
                    className="flex items-center justify-between py-2 border-b border-border/30 last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium">{r.rep_name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{r.referral_code}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{r.leads_count} leads</p>
                      <p className="text-[10px] text-emerald-600">
                        {r.converted} enroll ·{' '}
                        {r.leads_count > 0 ? Math.round((r.converted / r.leads_count) * 100) : 0}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sales Rep</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead className="text-center">Leads</TableHead>
                    <TableHead className="text-center">Enroll</TableHead>
                    <TableHead className="text-center">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {referralData.map((r) => (
                    <TableRow key={r.referral_code}>
                      <TableCell className="font-medium">{r.rep_name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.referral_code}</TableCell>
                      <TableCell className="text-center">{r.leads_count}</TableCell>
                      <TableCell className="text-center text-emerald-600 font-semibold">{r.converted}</TableCell>
                      <TableCell className="text-center">
                        {r.leads_count > 0 ? `${Math.round((r.converted / r.leads_count) * 100)}%` : '0%'}
                      </TableCell>
                    </TableRow>
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
