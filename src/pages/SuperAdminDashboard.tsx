import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Building2, Users, TrendingUp, IndianRupee, Loader2, CalendarDays } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNavigate } from 'react-router-dom';

const COLORS = ['hsl(162, 63%, 41%)', 'hsl(200, 70%, 50%)', 'hsl(38, 92%, 50%)', 'hsl(270, 60%, 55%)', 'hsl(0, 70%, 55%)'];

export default function SuperAdminDashboard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<any[]>([]);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const data = await api.organizations.stats();
      const rows = data.data || [];
      setOrgs(
        rows.map((o: any) => ({
          ...o,
          is_active: o?.is_active === true || o?.is_active === 1 || o?.is_active === '1',
        }))
      );
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const fmt = (v: number) => (v >= 100000 ? `Rs ${(v / 100000).toFixed(1)}L` : v >= 1000 ? `Rs ${(v / 1000).toFixed(1)}K` : `Rs ${v}`);

  const totals = useMemo(
    () =>
      orgs.reduce(
        (acc, o) => ({
          users: acc.users + (parseInt(o.user_count) || 0),
          leads: acc.leads + (parseInt(o.leads_count) || 0),
          revenue: acc.revenue + (parseFloat(o.revenue) || 0),
        }),
        { users: 0, leads: 0, revenue: 0 }
      ),
    [orgs]
  );

  const activeCount = orgs.filter((o) => !!o.is_active).length;
  const inactiveCount = orgs.length - activeCount;

  const industryData = useMemo(() => {
    const map: Record<string, number> = {};
    orgs.forEach((o) => {
      const k = o.industry || 'Unspecified';
      map[k] = (map[k] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [orgs]);

  const planData = useMemo(() => {
    const map: Record<string, number> = {};
    orgs.forEach((o) => {
      const k = o.plan || 'starter';
      map[k] = (map[k] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [orgs]);

  const topOrgs = useMemo(
    () =>
      [...orgs]
        .sort((a, b) => (parseFloat(b.revenue) || 0) - (parseFloat(a.revenue) || 0))
        .slice(0, 8),
    [orgs]
  );

  const growth = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 6);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let today = 0;
    let week = 0;
    let month = 0;

    orgs.forEach((o) => {
      const created = o?.created_at ? new Date(o.created_at) : null;
      if (!created || Number.isNaN(created.getTime())) return;
      if (created >= startOfToday) today += 1;
      if (created >= startOfWeek) week += 1;
      if (created >= startOfMonth) month += 1;
    });

    return { today, week, month };
  }, [orgs]);

  const recentOrgs = useMemo(
    () =>
      [...orgs]
        .filter((o) => o?.created_at)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 8),
    [orgs]
  );

  const formatDate = (value?: string) => {
    if (!value) return '-';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '-';
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200 text-xs">Super Admin</Badge>
        </div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight mt-1">
          Welcome{profile?.full_name ? `, ${profile.full_name}` : ''} 👋
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          Platform-wide summary across all organizations
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button size="sm" onClick={() => navigate('/organizations')}>Go to Organizations</Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/organizations?create=1')}>Add Organization</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5">
        {[
          { label: 'Organizations', value: orgs.length, icon: Building2, ic: 'text-blue-600', bg: 'bg-blue-500/10' },
          { label: 'Total Users', value: totals.users, icon: Users, ic: 'text-emerald-600', bg: 'bg-emerald-500/10' },
          { label: 'Total Leads', value: totals.leads, icon: TrendingUp, ic: 'text-amber-600', bg: 'bg-amber-500/10' },
          { label: 'Total Revenue', value: fmt(totals.revenue), icon: IndianRupee, ic: 'text-green-600', bg: 'bg-green-500/10' },
        ].map((c) => (
          <Card key={c.label} className="border-border/50 shadow-none">
            <CardContent className="pt-3 pb-2.5 px-3">
              <div className="flex items-center gap-2.5">
                <div className={`h-8 w-8 rounded-lg ${c.bg} flex items-center justify-center`}><c.icon className={`h-4 w-4 ${c.ic}`} /></div>
                <div><p className="text-lg font-bold leading-none">{c.value}</p><p className="text-[10px] text-muted-foreground mt-0.5">{c.label}</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mb-5">
        {[
          { label: 'New Today', value: growth.today },
          { label: 'Last 7 Days', value: growth.week },
          { label: 'This Month', value: growth.month },
        ].map((g) => (
          <Card key={g.label} className="border-border/50 shadow-none">
            <CardContent className="pt-3 pb-3 px-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-muted-foreground">{g.label}</p>
                  <p className="text-xl font-bold mt-0.5">{g.value}</p>
                </div>
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <CalendarDays className="h-4 w-4 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <Card className="border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4">
            <CardTitle className="text-sm font-semibold">Organizations by Plan</CardTitle>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            <ResponsiveContainer width="100%" height={isMobile ? 200 : 260}>
              <BarChart data={planData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(162, 63%, 41%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4">
            <CardTitle className="text-sm font-semibold">Organizations by Industry</CardTitle>
          </CardHeader>
          <CardContent className="px-2 sm:px-4">
            <ResponsiveContainer width="100%" height={isMobile ? 200 : 260}>
              <PieChart>
                <Pie data={industryData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={isMobile ? 35 : 55} outerRadius={isMobile ? 70 : 90} label>
                  {industryData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50 shadow-none">
        <CardHeader className="px-3 sm:px-4">
          <CardTitle className="text-sm font-semibold">
            Top Organizations by Revenue ({activeCount} active / {inactiveCount} inactive)
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 sm:px-4">
          <div className="space-y-2">
            {topOrgs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No organizations yet</p>
            ) : (
              topOrgs.map((o) => (
                <div key={o.id} className="flex items-center justify-between border border-border/50 rounded-md px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{o.name}</p>
                    <p className="text-[11px] text-muted-foreground">{o.slug}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{fmt(parseFloat(o.revenue) || 0)}</p>
                    <p className="text-[11px] text-muted-foreground">{parseInt(o.user_count) || 0} users</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50 shadow-none mt-5">
        <CardHeader className="px-3 sm:px-4">
          <CardTitle className="text-sm font-semibold">Recently Created Organizations</CardTitle>
        </CardHeader>
        <CardContent className="px-3 sm:px-4">
          <div className="space-y-2">
            {recentOrgs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No recent organization records</p>
            ) : (
              recentOrgs.map((o) => (
                <div key={o.id} className="flex items-center justify-between border border-border/50 rounded-md px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{o.name}</p>
                    <p className="text-[11px] text-muted-foreground">{o.slug}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium">{formatDate(o.created_at)}</p>
                    <p className="text-[11px] text-muted-foreground">{o.is_active ? 'Active' : 'Inactive'}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
