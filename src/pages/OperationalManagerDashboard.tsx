import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
 GraduationCap,
 IndianRupee,
 Loader2,
 Receipt,
 RefreshCw,
 Users,
 Wallet,
 UserCog,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type { PaymentCandidateKpi } from "@/components/paymentLinks/CandidatePaymentRecords";
import type { RazorpayPaymentLink } from "@/types/paymentLinks";
import { resolvePaymentLinkCreator, type TeamMemberLookup } from "@/utils/normalizePaymentLink";
import {
 getAllPaymentLinks,
} from "@/utils/paymentLinksApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
 BarChart,
 Bar,
 PieChart,
 Pie,
 Cell,
 LineChart,
 Line,
 XAxis,
 YAxis,
 CartesianGrid,
 Tooltip,
 ResponsiveContainer,
 Legend,
} from "recharts";
import AssignedAssignmentsCard from "@/components/assignments/AssignedAssignmentsCard";
import AssignedFormLinksCard from "@/components/forms/AssignedFormLinksCard";
import AssignedDocFormLinksCard from "@/components/forms/AssignedDocFormLinksCard";
import { localDateKey } from "@/lib/localDate";

const COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

function fmtInr(amount: number): string {
 return `₹${Number(amount || 0).toLocaleString("en-IN", {
 minimumFractionDigits: 0,
 maximumFractionDigits: 0,
 })}`;
}

/** ₹8.5L / ₹45k style for chart axes. */
function fmtInrShort(amount: number): string {
 const n = Number(amount || 0);
 const trim = (x: number) => x.toFixed(1).replace(/\.0$/, "");
 if (n >= 10000000) return `₹${trim(n / 10000000)}Cr`;
 if (n >= 100000) return `₹${trim(n / 100000)}L`;
 if (n >= 1000) return `₹${Math.round(n / 1000)}k`;
 return `₹${Math.round(n)}`;
}

/** "2026-11-06" → "06 Nov" */
function fmtDayLabel(key: string): string {
 const [y, m, d] = String(key || "").split("-").map(Number);
 if (!y || !m || !d) return String(key || "");
 return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

type PaymentChartData = {
 name: string;
 value: number;
 count: number;
};

type DailyCollection = {
 date: string;
 collected: number;
 links: number;
};

export default function OperationalManagerDashboard() {
 const { user } = useAuth();
 const navigate = useNavigate();
 const [loading, setLoading] = useState(true);
 const [manualPayments, setManualPayments] = useState<any[]>([]);
 const [error, setError] = useState<string | null>(null);
 const [kpi, setKpi] = useState<PaymentCandidateKpi | null>(null);
 const [links, setLinks] = useState<RazorpayPaymentLink[]>([]);
 const [team, setTeam] = useState<TeamMemberLookup[]>([]);
 const [chartPeriod, setChartPeriod] = useState<"7d" | "30d" | "90d" | "all">("30d");

 const [studentCounts, setStudentCounts] = useState<{ enrolled: number; registered: number } | null>(null);

 const load = useCallback(async () => {
 setLoading(true);
 setError(null);
 try {
 // All links once: "Pending links" must include old unpaid links; the chart period
 // only filters what the charts show (client-side), so switching it never refetches.
 const [candidatesRes, linksRes, studentsRes] = await Promise.allSettled([
 api.paymentCandidates.list(),
 getAllPaymentLinks({ period: "all" }),
 api.students.list(),
 ]);

 if (studentsRes.status === "fulfilled") {
 const rows = Array.isArray((studentsRes.value as { data?: unknown })?.data)
 ? ((studentsRes.value as { data: Array<{ course_id?: unknown; batch_id?: unknown }> }).data)
 : [];
 // Same rule as the Students page: no course and no batch yet = registered only.
 const registered = rows.filter((s) => !String(s.course_id ?? "").trim() && !String(s.batch_id ?? "").trim()).length;
 setStudentCounts({ enrolled: rows.length - registered, registered });
 } else {
 setStudentCounts(null);
 }

 const kpiData = (candidatesRes.status === "fulfilled"
 ? (candidatesRes.value as { kpi?: PaymentCandidateKpi })
 : {})?.kpi;
 setKpi(
 kpiData ?? {
 candidate_count: 0,
 total_pitch: 0,
 total_paid: 0,
 total_remaining: 0,
 cleared_count: 0,
 enrolled_count: 0,
 },
 );

 if (linksRes.status === "fulfilled") {
 setLinks(linksRes.value.items ?? []);
 } else {
 setLinks([]);
 }

 // Fetch approved manual payments
 const manualRes = await api.manualPayments.list('approved').catch(() => ({ data: [] }));
 setManualPayments(Array.isArray(manualRes?.data) ? manualRes.data : []);

 // Team roster: resolves who created each payment link (for "Top Members by Collection").
 const teamRes = await api.team.list().catch(() => ({ data: [] }));
 setTeam(Array.isArray(teamRes?.data) ? (teamRes.data as TeamMemberLookup[]) : []);
 } catch (err) {
 setError(err instanceof Error ? err.message : "Failed to load dashboard");
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 void load();
 }, [load]);

 const periodDays = chartPeriod === "7d" ? 7 : chartPeriod === "30d" ? 30 : chartPeriod === "90d" ? 90 : 0;
 const periodLabel = chartPeriod === "all" ? "all time" : `last ${periodDays} days`;
 const sinceSec = periodDays > 0 ? Math.floor(Date.now() / 1000) - periodDays * 86400 : 0;
 const linkPaymentsInPeriod = useCallback(
 (link: RazorpayPaymentLink): Array<{ at: number; amount: number }> => {
 const pays = (link.payments ?? [])
 .filter((p) => !/failed|refunded/i.test(String(p.status || "")) && Number(p.amount || 0) > 0)
 .map((p) => ({ at: Number(p.created_at || 0), amount: Number(p.amount || 0) / 100 }));
 // Older rows carry only amount_paid: count it on the link's own date.
 const list = pays.length > 0 ? pays : (link.amount_paid || 0) > 0 ? [{ at: Number(link.created_at || 0), amount: (link.amount_paid || 0) / 100 }] : [];
 return list.filter((p) => p.at >= sinceSec);
 },
 [sinceSec],
 );
 // Links that belong to the chart period: created in it, or paid during it.
 const chartLinks = useMemo(
 () => (sinceSec === 0 ? links : links.filter((l) => Number(l.created_at || 0) >= sinceSec || linkPaymentsInPeriod(l).length > 0)),
 [links, sinceSec, linkPaymentsInPeriod],
 );

 const name = String(user?.full_name || "").trim() || "Operational Manager";

 // Payment status distribution
 const statusData = useMemo<PaymentChartData[]>(() => {
 const statusMap = new Map<string, { value: number; count: number }>();
 for (const link of chartLinks) {
 const s = link.status || "unknown";
 const existing = statusMap.get(s) || { value: 0, count: 0 };
 statusMap.set(s, { value: existing.value + ((link.amount_paid || 0) / 100), count: existing.count + 1 });
 }
 const labelMap: Record<string, string> = {
 created: "Pending",
 partially_paid: "Partial",
 paid: "Paid",
 cancelled: "Cancelled",
 expired: "Expired",
 };
 return Array.from(statusMap.entries())
 .map(([key, val]) => ({
 name: labelMap[key] || key,
 value: val.value,
 count: val.count,
 }))
 .sort((a, b) => b.value - a.value);
 }, [chartLinks]);

 // Daily collections: every payment on its own date (an installment link is no longer
 // booked entirely on its last payment day). Days without payments show as 0.
 const dailyTrend = useMemo<DailyCollection[]>(() => {
 const dayMap = new Map<string, { collected: number; count: number }>();
 for (const link of chartLinks) {
 for (const p of linkPaymentsInPeriod(link)) {
 const date = localDateKey(p.at * 1000);
 const existing = dayMap.get(date) || { collected: 0, count: 0 };
 dayMap.set(date, { collected: existing.collected + p.amount, count: existing.count + 1 });
 }
 }
 if (periodDays > 0) {
 for (let i = periodDays - 1; i >= 0; i--) {
 const key = localDateKey(Date.now() - i * 86400000);
 if (!dayMap.has(key)) dayMap.set(key, { collected: 0, count: 0 });
 }
 }
 return Array.from(dayMap.entries())
 .map(([date, val]) => ({ date, collected: val.collected, links: val.count }))
 .sort((a, b) => a.date.localeCompare(b.date));
 }, [chartLinks, linkPaymentsInPeriod, periodDays]);

 // Top members by collection (payments received in the chart period)
 const memberData = useMemo(() => {
 const memberMap = new Map<string, { name: string; collected: number; links: number }>();
 for (const link of chartLinks) {
 // Creator lives in Razorpay notes (salesperson_id / staff ID); resolve it against the team roster.
 const creator = resolvePaymentLinkCreator(link, team);
 const key = creator.id || creator.referral_code || "unassigned";
 const label = creator.full_name && creator.full_name !== "—" ? creator.full_name : creator.referral_code || "Unassigned";
 const existing = memberMap.get(key) || { name: label, collected: 0, links: 0 };
 const collected = linkPaymentsInPeriod(link).reduce((s, p) => s + p.amount, 0);
 memberMap.set(key, { name: existing.name, collected: existing.collected + collected, links: existing.links + 1 });
 }
 return Array.from(memberMap.values())
 .sort((a, b) => b.collected - a.collected)
 .slice(0, 10);
 }, [chartLinks, team, linkPaymentsInPeriod]);

 // Same figure as Payment Records (candidate ledger: link payments + approved manual payments).
 const ledgerCollected = Number(kpi?.total_paid ?? 0);
 const totalCollected = kpi && (kpi.candidate_count ?? 0) > 0
 ? ledgerCollected
 : links.filter((l) => l.status === "paid" || l.status === "partially_paid").reduce((s, l) => s + (l.amount_paid || 0), 0) / 100 + manualPayments.reduce((s, m) => s + (parseFloat(m.amount) || 0), 0);
 const totalPitch = kpi?.total_pitch || 0;
 const pendingCount = links.filter((l) => l.status === "created" || l.status === "partially_paid").length;

 return (
 <div className="space-y-6">
 <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
 <div>
 <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
 <p className="mt-1 text-sm text-muted-foreground">
 Welcome, {name}. Operations overview and payment analytics.
 </p>
 </div>
 <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
 <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
 Refresh
 </Button>
 </div>

 {error ? (
 <Card>
 <CardContent className="py-6 text-sm text-destructive">{error}</CardContent>
 </Card>
 ) : null}

 {loading && !kpi ? (
 <div className="flex h-48 items-center justify-center">
 <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
 </div>
 ) : (
 <>
 {/* KPI Cards */}
 <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
 <KpiCard
 title="Total Pitch"
 value={fmtInr(totalPitch)}
 hint={`${kpi?.candidate_count ?? 0} candidates · ${kpi?.cleared_count ?? 0} cleared`}
 icon={Wallet}
 />
 <KpiCard
 title="Total Collected"
 value={fmtInr(totalCollected)}
 hint={`${fmtInr(Math.max(0, totalPitch - totalCollected))} still to collect`}
 icon={IndianRupee}
 color="text-emerald-600"
 />
 <KpiCard
 title="Pending Links"
 value={String(pendingCount)}
 hint="Unpaid or part-paid, all time"
 icon={Receipt}
 color="text-amber-600"
 />
 <KpiCard
 title="Enrolled Students"
 value={String(studentCounts?.enrolled ?? 0)}
 hint={studentCounts ? `${studentCounts.registered} registered · ${studentCounts.enrolled + studentCounts.registered} students in all` : "Students with a course or batch"}
 icon={GraduationCap}
 color="text-blue-600"
 />
 </div>

 <div className="flex flex-wrap items-center justify-between gap-2">
 <p className="text-sm font-semibold text-foreground">Payment charts · {periodLabel}</p>
 <div className="inline-flex rounded-lg border bg-muted/40 p-0.5" role="group" aria-label="Chart period">
 {([["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["all", "All time"]] as const).map(([key, text]) => (
 <button
 key={key}
 type="button"
 aria-pressed={chartPeriod === key}
 onClick={() => setChartPeriod(key)}
 className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${chartPeriod === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
 >
 {text}
 </button>
 ))}
 </div>
 </div>

 {/* Assigned Assignments */}
 <AssignedAssignmentsCard />
 <AssignedFormLinksCard />
 <AssignedDocFormLinksCard />

 {/* Charts */}
 <div className="grid gap-4 lg:grid-cols-2">
 {/* Payment Status Breakdown */}
 <Card className="border-border/50 shadow-none">
 <CardHeader className="px-3 sm:px-4">
 <CardTitle className="text-sm font-semibold">Payment Status <span className="font-normal text-muted-foreground">· links, {periodLabel}</span></CardTitle>
 </CardHeader>
 <CardContent className="px-2 sm:px-4">
 {statusData.length === 0 ? (
 <p className="text-sm text-muted-foreground text-center py-8">No data</p>
 ) : (
 <ResponsiveContainer width="100%" height={260}>
 <PieChart>
 <Pie
 data={statusData}
 cx="50%"
 cy="50%"
 innerRadius={50}
 outerRadius={90}
 paddingAngle={3}
 dataKey="count"
 label={({ name, percent }) =>
 `${name} ${(percent * 100).toFixed(0)}%`
 }
 labelLine={false}
 >
 {statusData.map((_, i) => (
 <Cell key={i} fill={COLORS[i % COLORS.length]} />
 ))}
 </Pie>
 <Tooltip
 formatter={(count: number, _name: string, item: { payload?: PaymentChartData }) => [
 `${count} link${count === 1 ? "" : "s"} · ${fmtInr(item?.payload?.value ?? 0)} collected`,
 item?.payload?.name ?? "",
 ]}
 contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }}
 />
 </PieChart>
 </ResponsiveContainer>
 )}
 </CardContent>
 </Card>

 {/* Daily Collection Trend */}
 <Card className="border-border/50 shadow-none">
 <CardHeader className="px-3 sm:px-4">
 <CardTitle className="text-sm font-semibold">Daily Collections <span className="font-normal text-muted-foreground">· {periodLabel}</span></CardTitle>
 </CardHeader>
 <CardContent className="px-2 sm:px-4">
 {dailyTrend.length === 0 ? (
 <p className="text-sm text-muted-foreground text-center py-8">No data</p>
 ) : (
 <ResponsiveContainer width="100%" height={260}>
 <LineChart data={dailyTrend}>
 <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
 <XAxis
 dataKey="date"
 tickFormatter={fmtDayLabel}
 minTickGap={16}
 tick={{ fontSize: 10 }}
 stroke="hsl(var(--muted-foreground))"
 />
 <YAxis
 tickFormatter={fmtInrShort}
 width={56}
 tick={{ fontSize: 10 }}
 stroke="hsl(var(--muted-foreground))"
 />
 <Tooltip
 labelFormatter={(d: string) => fmtDayLabel(d)}
 formatter={(value: number) => [fmtInr(value), "Collected"]}
 contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }}
 />
 <Line
 type="monotone"
 dataKey="collected"
 stroke="#22c55e"
 strokeWidth={2}
 dot={{ r: 3 }}
 name="Collected"
 />
 </LineChart>
 </ResponsiveContainer>
 )}
 </CardContent>
 </Card>
 </div>

 {/* Top Members by Collection */}
 <Card className="border-border/50 shadow-none">
 <CardHeader className="px-3 sm:px-4">
 <CardTitle className="text-sm font-semibold">Top Members by Collection <span className="font-normal text-muted-foreground">· {periodLabel}</span></CardTitle>
 </CardHeader>
 <CardContent className="px-2 sm:px-4">
 {memberData.length === 0 ? (
 <p className="text-sm text-muted-foreground text-center py-8">No data</p>
 ) : (
 <ResponsiveContainer width="100%" height={260}>
 <BarChart data={memberData}>
 <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
 <XAxis
 dataKey="name"
 tick={{ fontSize: 10 }}
 stroke="hsl(var(--muted-foreground))"
 interval={0}
 angle={-30}
 textAnchor="end"
 height={60}
 />
 <YAxis
 tickFormatter={fmtInrShort}
 width={56}
 tick={{ fontSize: 10 }}
 stroke="hsl(var(--muted-foreground))"
 />
 <Tooltip
 formatter={(value: number) => [fmtInr(value), "Collected"]}
 contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }}
 />
 <Bar dataKey="collected" fill="#22c55e" radius={[6, 6, 0, 0]} name="Collected" />
 </BarChart>
 </ResponsiveContainer>
 )}
 </CardContent>
 </Card>

 {/* Quick Actions */}
 <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
 <Card
 className="cursor-pointer transition-colors hover:bg-muted/40"
 onClick={() => navigate("/team")}
 >
 <CardHeader className="pb-2">
 <CardTitle className="flex items-center gap-2 text-base">
 <UserCog className="h-4 w-4 text-muted-foreground" />
 Team
 </CardTitle>
 </CardHeader>
 <CardContent className="text-sm text-muted-foreground">
 Manage team members, roles, and page access configured by admin.
 </CardContent>
 </Card>
 <Card
 className="cursor-pointer transition-colors hover:bg-muted/40"
 onClick={() => navigate("/payments/records")}
 >
 <CardHeader className="pb-2">
 <CardTitle className="flex items-center gap-2 text-base">
 <Receipt className="h-4 w-4 text-muted-foreground" />
 Payment Records
 </CardTitle>
 </CardHeader>
 <CardContent className="text-sm text-muted-foreground">
 Review candidate pitches, installments, and collection status across the org.
 </CardContent>
 </Card>
 <Card
 className="cursor-pointer transition-colors hover:bg-muted/40"
 onClick={() => navigate("/students")}
 >
 <CardHeader className="pb-2">
 <CardTitle className="flex items-center gap-2 text-base">
 <GraduationCap className="h-4 w-4 text-muted-foreground" />
 Enrolled Students
 </CardTitle>
 </CardHeader>
 <CardContent className="text-sm text-muted-foreground">
 View enrolled students and payment progress (paid vs pitch).
 </CardContent>
 </Card>
 </div>
 </>
 )}
 </div>
 );
}

function KpiCard({
 title,
 value,
 hint,
 icon: Icon,
 color,
}: {
 title: string;
 value: string;
 hint: string;
 icon: typeof Users;
 color?: string;
}) {
 return (
 <Card>
 <CardContent className="flex items-start gap-3 pt-5">
 <div className="rounded-lg bg-muted p-2">
 <Icon className={`h-4 w-4 ${color || "text-muted-foreground"}`} />
 </div>
 <div className="min-w-0 flex-1">
 <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
 <p className="mt-1 truncate text-xl font-semibold tabular-nums text-foreground">{value}</p>
 <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
 </div>
 </CardContent>
 </Card>
 );
}
