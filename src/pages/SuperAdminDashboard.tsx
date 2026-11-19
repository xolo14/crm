import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  IndianRupee,
  Plus,
  RefreshCw,
  Shield,
  Table2,
  TrendingUp,
  UserX,
  Users,
  BarChart3,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
} from "recharts";
import { ORG_SCOPE_ALL, orgScopeParam, useOrgScope } from "@/hooks/useOrgScope";
import { chartAxis, chartGrid, chartSeries, chartTooltip } from "@/lib/chartTheme";
import { cleanName, fmtCount, fmtDateTime, fmtINR, fmtINRCompact, pct } from "@/lib/formatMetric";
import { cn } from "@/lib/utils";

interface MetricsSummary {
  scope: string;
  as_of: string;
  leads_total: number;
  by_status: Record<string, number>;
  new: number;
  in_pipeline: number;
  enrolled: number;
  lost: number;
  unassigned: number;
  unassigned_aging: { "0_2d": number; "3_7d": number; "8_30d": number; "30d_plus": number };
  by_source: { source: string; count: number }[];
  leads_by_week: { week_start: string; count: number; partial?: boolean }[];
  students_total: number;
  registered: number;
  students_enrolled: number;
  collected: number;
  outstanding: number;
  pending_approvals: number;
  active_users: number;
}

interface OrgRow {
  id: string;
  name: string;
  plan?: string;
  is_active?: boolean | number | string;
  user_count?: number | string;
  leads_count?: number | string;
  converted_count?: number | string;
  revenue?: number | string;
}

/** Funnel stages from current CRM status: "reached at least this stage". */
/**
 * Funnel from current CRM status: each stage counts leads at or beyond it.
 * No Demo stage — leads can enroll without a recorded demo, which made Demo → Enrolled
 * read as if most demos converted.
 */
const FUNNEL: { label: string; statuses: string[] }[] = [
  { label: "Active leads", statuses: [] }, // every lead that is not lost
  { label: "Contacted", statuses: ["contacted", "not_answered", "messaged", "qualified", "interested", "demo_scheduled", "demo_attended", "registered", "enrolled"] },
  { label: "Interested", statuses: ["qualified", "interested", "demo_scheduled", "demo_attended", "registered", "enrolled"] },
  { label: "Registered", statuses: ["registered", "enrolled"] },
  { label: "Enrolled", statuses: ["enrolled"] },
];

function prettySource(s: string): string {
  return cleanName(s);
}

/**
 * Imports dwarf every other source (~28x the next one), so one bar chart leaves the
 * organic channels as unreadable slivers. Split it: a share bar Imports vs Organic,
 * then a ranked list of organic channels scaled to the largest organic channel.
 * The same markup works at desktop and phone widths.
 */
function sourceType(name: string): string {
  if (name.startsWith("Form ·")) return "Form";
  if (name.startsWith("Assignment ·")) return "Assignment";
  if (name === "Meta Ads") return "Ads";
  if (name === "All other sources") return "";
  return "Channel";
}

function SourceBreakdown({ sources }: { sources: { name: string; value: number }[] }) {
  const series = chartSeries();
  const imports = sources.filter((s) => s.name === "Imports").reduce((a, s) => a + s.value, 0);
  const organicRows = sources.filter((s) => s.name !== "Imports");
  const named = organicRows.filter((s) => s.name !== "All other sources").slice(0, 7);
  const foldedNamed = organicRows.filter((s) => s.name !== "All other sources").slice(7);
  const otherValue =
    organicRows.filter((s) => s.name === "All other sources").reduce((a, s) => a + s.value, 0) +
    foldedNamed.reduce((a, s) => a + s.value, 0);
  const rows = otherValue > 0 ? [...named, { name: "All other sources", value: otherValue }] : named;
  const organic = rows.reduce((a, s) => a + s.value, 0);
  const total = imports + organic;
  const maxOrganic = Math.max(1, ...named.map((r) => r.value), otherValue);
  if (total === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No leads in this scope yet.</p>;
  const importPct = (imports / total) * 100;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Imports ${pct(imports, total)}, organic ${pct(organic, total)}`}>
          <div style={{ width: `${importPct}%`, background: series[1] }} />
          <div style={{ width: `${100 - importPct}%`, background: series[0] }} />
        </div>
        <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: series[1] }} />
            Imports <span className="font-semibold tabular-nums">{fmtCount(imports)}</span>
            <span className="text-muted-foreground">({pct(imports, total)})</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: series[0] }} />
            Organic channels <span className="font-semibold tabular-nums">{fmtCount(organic)}</span>
            <span className="text-muted-foreground">({pct(organic, total)})</span>
          </span>
        </div>
      </div>
      <ul className="space-y-2.5">
        {rows.map((r) => {
          const other = r.name === "All other sources";
          const type = sourceType(r.name);
          return (
            <li key={r.name} className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("truncate", other && "text-muted-foreground")} title={r.name}>
                    {r.name.replace(/^(Form|Assignment) · /, "")}
                  </span>
                  {type ? (
                    <span className="shrink-0 rounded-full border border-border px-1.5 py-0 text-[10px] text-muted-foreground">{type}</span>
                  ) : null}
                </span>
                <span className="shrink-0 whitespace-nowrap tabular-nums">
                  <span className="font-semibold">{fmtCount(r.value)}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground">{pct(r.value, organic)}</span>
                </span>
              </div>
              <div className="mt-1 h-2 w-full rounded-full bg-muted">
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${Math.max(2, (r.value / maxOrganic) * 100)}%`, background: other ? "hsl(var(--ink-400))" : series[0] }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground">Percentages in the list are shares of organic leads.</p>
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  to,
  loading,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Users;
  to?: string;
  loading?: boolean;
  className?: string;
}) {
  const body = (
    <Card className="h-full border-border shadow-none transition-shadow hover:shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <span className="rounded-lg bg-brand-100 p-1.5 text-brand-700 dark:bg-brand-500/15 dark:text-lime-400">
            <Icon className="h-4 w-4" />
          </span>
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-24" />
        ) : (
          <p className="mt-1 text-[28px] font-bold leading-tight tabular-nums text-foreground">{value}</p>
        )}
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
  return to ? (
    <Link to={to} className={cn("block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function ChartCard({
  title,
  question,
  children,
  table,
}: {
  title: string;
  question: string;
  children: React.ReactNode;
  table: React.ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className="border-border shadow-none">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div>
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
          <CardDescription className="text-xs">{question}</CardDescription>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
        >
          {asTable ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
          {asTable ? "Chart" : "Table"}
        </Button>
      </CardHeader>
      <CardContent>{asTable ? table : children}</CardContent>
    </Card>
  );
}

function MiniTable({ rows, cols }: { rows: (string | number)[][]; cols: string[] }) {
  return (
    <div className="max-h-[260px] overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            {cols.map((c, i) => (
              <th key={c} className={cn("py-1.5 font-medium", i > 0 && "text-right")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((v, i) => (
                <td key={i} className={cn("py-1.5", i > 0 && "text-right tabular-nums")}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SuperAdminDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [scope] = useOrgScope();
  const orgId = orgScopeParam(scope);

  const metricsQ = useQuery({
    queryKey: ["metrics_summary", orgId ?? ORG_SCOPE_ALL],
    queryFn: async () => ((await api.metrics.summary(orgId)) as { data: MetricsSummary }).data,
    staleTime: 60_000,
  });
  const orgsQ = useQuery({
    queryKey: ["org_stats"],
    queryFn: async () => (((await api.organizations.stats()) as { data?: OrgRow[] }).data ?? []) as OrgRow[],
    staleTime: 60_000,
  });

  const m = metricsQ.data;
  const loading = metricsQ.isLoading;
  const series = chartSeries();
  const orgs = orgsQ.data ?? [];
  const scopeName =
    scope === ORG_SCOPE_ALL ? "All organizations" : cleanName(orgs.find((o) => o.id === scope)?.name) || "Selected organization";

  const funnel = useMemo(() => {
    if (!m) return [];
    const bs = m.by_status || {};
    const notLost = m.leads_total - (m.lost || 0);
    return FUNNEL.map((stage, i) => {
      const value = i === 0 ? notLost : stage.statuses.reduce((s, k) => s + (bs[k] || 0), 0);
      return { stage: stage.label, value };
    }).map((row, i, arr) => ({
      ...row,
      conv: i === 0 ? "" : pct(row.value, arr[i - 1].value),
    }));
  }, [m]);

  const sources = useMemo(
    () => (m?.by_source ?? []).map((s) => ({ name: prettySource(s.source), value: s.count })),
    [m],
  );

  const weekly = useMemo(
    () =>
      (m?.leads_by_week ?? []).map((w) => ({
        week:
          new Date(`${w.week_start}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) +
          (w.partial ? " (so far)" : ""),
        value: w.count,
      })),
    [m],
  );

  const firstName = profile?.full_name?.split(" ")[0] || "Admin";

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      {/* Slim greeting + scope */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 border-brand-500/30 bg-brand-100 text-brand-900 dark:bg-brand-500/15 dark:text-lime-400">
              <Shield className="h-3 w-3" />
              Super Admin
            </Badge>
            <span className="text-xs text-muted-foreground">{scopeName}</span>
          </div>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight">Welcome back, {firstName}</h1>
          <p className="text-xs text-muted-foreground">
            {m?.as_of ? `Figures as of ${fmtDateTime(m.as_of)}` : "Loading figures…"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void metricsQ.refetch()} disabled={metricsQ.isFetching}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", metricsQ.isFetching && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => navigate("/organizations?create=1")}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add organization
          </Button>
        </div>
      </section>

      {metricsQ.isError ? (
        <Card className="border-destructive/30 bg-destructive/5 shadow-none">
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
            <span>Could not load dashboard figures.</span>
            <Button size="sm" variant="outline" onClick={() => void metricsQ.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}


      {/* KPI row */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile label="Leads" value={fmtCount(m?.leads_total)} sub={m ? `${fmtCount(m.new)} new` : undefined} icon={TrendingUp} to="/leads" loading={loading} />
        <KpiTile
          label="Enrolled"
          value={fmtCount(m?.students_enrolled)}
          sub={m ? `${pct(m.students_enrolled, m.leads_total)} of leads · ${fmtCount(m.registered)} registered` : undefined}
          icon={CheckCircle2}
          to="/students"
          loading={loading}
        />
        <KpiTile label="Collected" value={m ? fmtINRCompact(m.collected) : "—"} sub={m ? fmtINR(m.collected) : undefined} icon={IndianRupee} to="/payments/records" loading={loading} />
        <KpiTile label="Outstanding" value={m ? fmtINRCompact(m.outstanding) : "—"} sub={m ? fmtINR(m.outstanding) : undefined} icon={IndianRupee} to="/payments/records" loading={loading} />
        <KpiTile
          className="col-span-2 lg:col-span-1"
          label="Unassigned"
          value={fmtCount(m?.unassigned)}
          sub={m ? `${pct(m.unassigned, m.leads_total)} of leads` : undefined}
          icon={UserX}
          to="/leads"
          loading={loading}
        />
      </section>

      {/* Decision charts */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard
          title="Lead funnel"
          question="Where do leads stall? (current CRM status; lost leads excluded)"
          table={
            <MiniTable
              cols={["Stage", "Leads", "From previous"]}
              rows={funnel.map((f) => [f.stage, fmtCount(f.value), f.conv || "—"])}
            />
          }
        >
          {loading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={funnel} layout="vertical" margin={{ left: 8, right: 64 }}>
                <CartesianGrid {...chartGrid} horizontal={false} vertical />
                <XAxis type="number" {...chartAxis} />
                <YAxis type="category" dataKey="stage" width={96} interval={0} {...chartAxis} />
                <Tooltip {...chartTooltip} formatter={(v: number) => [fmtCount(v), "Leads"]} />
                <Bar dataKey="value" fill={series[0]} radius={[0, 4, 4, 0]} barSize={22}>
                  <LabelList
                    dataKey="value"
                    position="right"
                    formatter={(v: number) => fmtCount(v)}
                    style={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          {!loading && funnel.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {funnel.slice(1).map((f) => (
                <span key={f.stage}>
                  → {f.stage}: <span className="font-semibold text-foreground">{f.conv}</span>
                </span>
              ))}
            </div>
          ) : null}
        </ChartCard>

        <ChartCard
          title="Leads by source"
          question="Where do leads come from? Bulk imports vs organic channels"
          table={<MiniTable cols={["Source", "Leads"]} rows={sources.map((s) => [s.name, fmtCount(s.value)])} />}
        >
          {loading ? <Skeleton className="h-[240px] w-full" /> : <SourceBreakdown sources={sources} />}
        </ChartCard>

        <ChartCard
          title="New leads per week"
          question="Is lead flow growing? (12 weeks starting Monday, oldest on the left; this week is partial)"
          table={<MiniTable cols={["Week of", "New leads"]} rows={weekly.map((w) => [w.week, fmtCount(w.value)])} />}
        >
          {loading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weekly} margin={{ top: 16, right: 8 }}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="week" {...chartAxis} />
                <YAxis {...chartAxis} width={56} tickFormatter={(v: number) => fmtCount(v)} />
                <Tooltip {...chartTooltip} formatter={(v: number) => [fmtCount(v), "New leads"]} />
                <Bar dataKey="value" fill={series[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Unassigned leads by age"
          question="How long are leads waiting for an owner?"
          table={
            <MiniTable
              cols={["Waiting", "Leads"]}
              rows={
                m
                  ? [
                      ["0–2 days", fmtCount(m.unassigned_aging["0_2d"])],
                      ["3–7 days", fmtCount(m.unassigned_aging["3_7d"])],
                      ["8–30 days", fmtCount(m.unassigned_aging["8_30d"])],
                      ["30+ days", fmtCount(m.unassigned_aging["30d_plus"])],
                    ]
                  : []
              }
            />
          }
        >
          {loading || !m ? (
            <Skeleton className="h-[220px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={[
                  { bucket: "0–2d", value: m.unassigned_aging["0_2d"] },
                  { bucket: "3–7d", value: m.unassigned_aging["3_7d"] },
                  { bucket: "8–30d", value: m.unassigned_aging["8_30d"] },
                  { bucket: "30d+", value: m.unassigned_aging["30d_plus"] },
                ]}
                margin={{ top: 20, right: 8 }}
              >
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="bucket" {...chartAxis} />
                <YAxis {...chartAxis} width={56} tickFormatter={(v: number) => fmtCount(v)} />
                <Tooltip {...chartTooltip} formatter={(v: number) => [fmtCount(v), "Leads"]} />
                <Bar dataKey="value" fill={series[2]} radius={[4, 4, 0, 0]}>
                  <LabelList
                    dataKey="value"
                    position="top"
                    formatter={(v: number) => fmtCount(v)}
                    style={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </section>

      {/* Organizations table */}
      <Card className="border-border shadow-none">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Building2 className="h-4 w-4 text-brand-500" />
              Organizations
            </CardTitle>
            <CardDescription className="text-xs">
              {fmtCount(orgs.length)} total · {fmtCount(m?.active_users)} active users{scope === ORG_SCOPE_ALL ? "" : " in scope"}
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/organizations">
              Manage <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {orgsQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : orgs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No organizations yet.</p>
          ) : (
            <>
            <ul className="space-y-2 sm:hidden">
              {orgs.map((o) => {
                const leads = Number(o.leads_count) || 0;
                const conv = Number(o.converted_count) || 0;
                return (
                  <li key={o.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{cleanName(o.name)}</span>
                      <span className="shrink-0 text-xs capitalize text-muted-foreground">{o.plan || "starter"}</span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-muted-foreground">Users</dt>
                      <dd className="text-right tabular-nums">{fmtCount(Number(o.user_count))}</dd>
                      <dt className="text-muted-foreground">Leads</dt>
                      <dd className="text-right tabular-nums">{fmtCount(leads)}</dd>
                      <dt className="text-muted-foreground">Conversion</dt>
                      <dd className="text-right tabular-nums">{pct(conv, leads)}</dd>
                      <dt className="text-muted-foreground">Revenue</dt>
                      <dd className="text-right tabular-nums">{fmtINR(Number(o.revenue))}</dd>
                    </dl>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 font-medium">Organization</th>
                    <th className="py-2 font-medium">Plan</th>
                    <th className="whitespace-nowrap py-2 pl-3 text-right font-medium">Users</th>
                    <th className="whitespace-nowrap py-2 pl-3 text-right font-medium">Leads</th>
                    <th className="whitespace-nowrap py-2 pl-3 text-right font-medium">Conv.</th>
                    <th className="whitespace-nowrap py-2 pl-3 text-right font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orgs.map((o) => {
                    const leads = Number(o.leads_count) || 0;
                    const conv = Number(o.converted_count) || 0;
                    const active = o.is_active === true || o.is_active === 1 || o.is_active === "1";
                    return (
                      <tr key={o.id}>
                        <td className="py-2">
                          <span className="font-medium">{cleanName(o.name)}</span>
                          {!active ? (
                            <Badge variant="outline" className="ml-2 border-destructive/30 text-[10px] text-destructive">
                              Disabled
                            </Badge>
                          ) : null}
                        </td>
                        <td className="py-2 capitalize text-muted-foreground">{o.plan || "starter"}</td>
                        <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">{fmtCount(Number(o.user_count))}</td>
                        <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">{fmtCount(leads)}</td>
                        <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">{pct(conv, leads)}</td>
                        <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">{fmtINR(Number(o.revenue))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
