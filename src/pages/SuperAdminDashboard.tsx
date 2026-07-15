import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Users,
  TrendingUp,
  IndianRupee,
  Loader2,
  CalendarDays,
  Plus,
  ArrowRight,
  Activity,
  Shield,
  MessageSquare,
  ClipboardList,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const PLAN_COLORS = [
  "hsl(162, 63%, 41%)",
  "hsl(200, 70%, 50%)",
  "hsl(38, 92%, 50%)",
  "hsl(215, 25%, 45%)",
];

const STATUS_COLORS = {
  active: "hsl(162, 63%, 41%)",
  inactive: "hsl(215, 16%, 65%)",
};

function fmtMoney(v: number) {
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
}

function formatDate(value?: string) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function SuperAdminDashboard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<any[]>([]);

  useEffect(() => {
    void fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const data = await api.organizations.stats();
      const rows = data.data || [];
      setOrgs(
        rows.map((o: any) => ({
          ...o,
          is_active: o?.is_active === true || o?.is_active === 1 || o?.is_active === "1",
        })),
      );
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const totals = useMemo(
    () =>
      orgs.reduce(
        (acc, o) => ({
          users: acc.users + (parseInt(o.user_count) || 0),
          leads: acc.leads + (parseInt(o.leads_count) || 0),
          students: acc.students + (parseInt(o.students_count) || 0),
          revenue: acc.revenue + (parseFloat(o.revenue) || 0),
        }),
        { users: 0, leads: 0, students: 0, revenue: 0 },
      ),
    [orgs],
  );

  const activeCount = orgs.filter((o) => !!o.is_active).length;
  const inactiveCount = orgs.length - activeCount;

  const statusData = useMemo(
    () => [
      { name: "Active", value: activeCount, fill: STATUS_COLORS.active },
      { name: "Disabled", value: inactiveCount, fill: STATUS_COLORS.inactive },
    ].filter((d) => d.value > 0),
    [activeCount, inactiveCount],
  );

  const planData = useMemo(() => {
    const map: Record<string, number> = {};
    orgs.forEach((o) => {
      const k = String(o.plan || "starter");
      map[k] = (map[k] || 0) + 1;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [orgs]);

  const topOrgs = useMemo(
    () =>
      [...orgs]
        .sort((a, b) => (parseFloat(b.revenue) || 0) - (parseFloat(a.revenue) || 0))
        .slice(0, 6),
    [orgs],
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
        .slice(0, 6),
    [orgs],
  );

  const firstName = profile?.full_name?.split(" ")[0] || "Admin";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const kpis = [
    { label: "Organizations", value: orgs.length, icon: Building2, tone: "text-sky-700 bg-sky-500/10" },
    { label: "Users", value: totals.users, icon: Users, tone: "text-emerald-700 bg-emerald-500/10" },
    { label: "Leads", value: totals.leads, icon: TrendingUp, tone: "text-amber-700 bg-amber-500/10" },
    { label: "Revenue", value: fmtMoney(totals.revenue), icon: IndianRupee, tone: "text-teal-700 bg-teal-500/10" },
  ];

  const shortcuts = [
    { label: "Organizations", desc: "Manage tenants & admins", to: "/organizations", icon: Building2 },
    { label: "Add organization", desc: "Provision a new tenant", to: "/organizations?create=1", icon: Plus },
    { label: "Form management", desc: "Forms & public links", to: "/form-management", icon: ClipboardList },
    { label: "Communications", desc: "WhatsApp & dialer hub", to: "/communications", icon: MessageSquare },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-teal-50 via-background to-sky-50 dark:from-teal-950/30 dark:via-background dark:to-sky-950/20 px-5 py-6 sm:px-7 sm:py-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-teal-400/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-sky-400/10 blur-2xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-200/80 gap-1">
              <Shield className="h-3 w-3" />
              Super Admin
            </Badge>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Welcome back, {firstName}
            </h1>
            <p className="text-sm text-muted-foreground max-w-xl">
              Platform overview across all organizations — {activeCount} active
              {inactiveCount > 0 ? `, ${inactiveCount} disabled` : ""}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button size="sm" className="gap-1.5" onClick={() => navigate("/organizations?create=1")}>
              <Plus className="h-3.5 w-3.5" />
              Add organization
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate("/organizations")}>
              Manage orgs
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((c) => (
          <Card key={c.label} className="border-border/50 shadow-none">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
                  <p className="text-2xl font-bold tracking-tight mt-1 truncate">{c.value}</p>
                </div>
                <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", c.tone)}>
                  <c.icon className="h-4 w-4" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Growth + shortcuts */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="border-border/50 shadow-none lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              New organizations
            </CardTitle>
            <CardDescription className="text-xs">Signup momentum</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {[
              { label: "Today", value: growth.today },
              { label: "Last 7 days", value: growth.week },
              { label: "This month", value: growth.month },
            ].map((g) => (
              <div key={g.label} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">{g.label}</span>
                <span className="text-lg font-bold tabular-nums">{g.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-none lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Quick actions
            </CardTitle>
            <CardDescription className="text-xs">Jump into common platform tasks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {shortcuts.map((s) => (
                <button
                  key={s.to}
                  type="button"
                  onClick={() => navigate(s.to)}
                  className="flex items-start gap-3 rounded-xl border border-border/50 bg-muted/20 px-3 py-3 text-left transition-colors hover:bg-muted/50 hover:border-border"
                >
                  <div className="h-9 w-9 rounded-lg bg-background border border-border/60 flex items-center justify-center shrink-0">
                    <s.icon className="h-4 w-4 text-foreground/80" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{s.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{s.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="border-border/50 shadow-none">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-semibold">Organizations by plan</CardTitle>
            <CardDescription className="text-xs">Plan mix across the platform</CardDescription>
          </CardHeader>
          <CardContent className="px-2 sm:px-4 pb-4">
            {planData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-16">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={isMobile ? 200 : 240}>
                <BarChart data={planData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                    contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {planData.map((_, i) => (
                      <Cell key={i} fill={PLAN_COLORS[i % PLAN_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-none">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-semibold">Organization status</CardTitle>
            <CardDescription className="text-xs">
              {activeCount} active · {inactiveCount} disabled
            </CardDescription>
          </CardHeader>
          <CardContent className="px-2 sm:px-4 pb-4">
            {statusData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-16">No organizations yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={isMobile ? 200 : 240}>
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={isMobile ? 42 : 58}
                    outerRadius={isMobile ? 72 : 88}
                    paddingAngle={3}
                  >
                    {statusData.map((d) => (
                      <Cell key={d.name} fill={d.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Lists */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="border-border/50 shadow-none">
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold">Top by revenue</CardTitle>
              <CardDescription className="text-xs">Highest earning organizations</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => navigate("/organizations")}>
              View all
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {topOrgs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No organizations yet</p>
            ) : (
              topOrgs.map((o, idx) => (
                <div
                  key={o.id}
                  className="flex items-center gap-3 rounded-xl border border-border/50 px-3 py-2.5"
                >
                  <span className="text-xs font-bold text-muted-foreground w-4 tabular-nums">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{o.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">{o.slug}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums">{fmtMoney(parseFloat(o.revenue) || 0)}</p>
                    <p className="text-[11px] text-muted-foreground">{parseInt(o.user_count) || 0} users</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-none">
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold">Recently created</CardTitle>
              <CardDescription className="text-xs">Latest tenants on the platform</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => navigate("/organizations?create=1")}>
              Add new
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentOrgs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No recent organizations</p>
            ) : (
              recentOrgs.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center gap-3 rounded-xl border border-border/50 px-3 py-2.5"
                >
                  <div className="h-9 w-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{o.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">{o.slug}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium">{formatDate(o.created_at)}</p>
                    <Badge variant={o.is_active ? "default" : "secondary"} className="text-[10px] mt-0.5">
                      {o.is_active ? "Active" : "Disabled"}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
