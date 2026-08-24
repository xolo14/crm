import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Loader2,
  Megaphone,
  RefreshCw,
  TrendingUp,
  MousePointerClick,
  Eye,
  IndianRupee,
} from "lucide-react";
import { format, subDays } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { isL3AdminRole, normalizeAppRole } from "@/lib/roleUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type InsightRow = {
  campaign_id: string;
  campaign_name?: string;
  ad_account_id: string;
  insight_date: string;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  ctr: number | string;
  cpc: number | string;
  conversions: number | string;
  conversion_value: number | string;
  roas: number | string;
  currency?: string | null;
};

type Totals = {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  ctr: number;
  cpc: number;
  roas: number;
};

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmtMoney(v: number, currency?: string | null): string {
  const cur = (currency || "INR").toUpperCase();
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: cur === "INR" ? "INR" : cur,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }
}

export default function MarketingMetaAdsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { role } = useAuth();
  const canSync =
    normalizeAppRole(role) === "super_admin" || isL3AdminRole(normalizeAppRole(role));

  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [accountId, setAccountId] = useState<string>("all");
  const [accounts, setAccounts] = useState<
    Array<{ ad_account_id: string; account_name?: string | null; is_enabled?: number | boolean }>
  >([]);
  const [connected, setConnected] = useState(false);
  const [leadsReady, setLeadsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [rows, setRows] = useState<InsightRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = (await api.metaAds.status()) as {
        data?: {
          connection?: unknown;
          leads_ready?: boolean;
          accounts?: Array<{
            ad_account_id: string;
            account_name?: string | null;
            is_enabled?: number | boolean;
          }>;
        };
      };
      setConnected(Boolean(res?.data?.connection));
      setLeadsReady(Boolean(res?.data?.leads_ready));
      const list = (res?.data?.accounts ?? []).filter((a) => Boolean(a.is_enabled));
      setAccounts(list);
    } catch {
      setConnected(false);
      setLeadsReady(false);
      setAccounts([]);
    }
  }, []);

  const loadInsights = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await api.metaAds.insights({
        from,
        to,
        ad_account_id: accountId === "all" ? undefined : accountId,
      })) as { data?: { rows?: InsightRow[]; totals?: Totals } };
      setRows(res?.data?.rows ?? []);
      setTotals(res?.data?.totals ?? null);
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Could not load Meta Ads data",
        description: e instanceof Error ? e.message : String(e),
      });
      setRows([]);
      setTotals(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, accountId, toast]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadInsights();
    const t = window.setInterval(() => void loadInsights(), 60_000);
    return () => window.clearInterval(t);
  }, [loadInsights]);

  const chartData = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const d = String(r.insight_date || "").slice(0, 10);
      if (!d) continue;
      byDay.set(d, (byDay.get(d) || 0) + n(r.spend));
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, spend]) => ({ date: date.slice(5), spend: Math.round(spend * 100) / 100 }));
  }, [rows]);

  const campaignRollup = useMemo(() => {
    const map = new Map<
      string,
      { name: string; spend: number; impressions: number; clicks: number; conversions: number; value: number }
    >();
    for (const r of rows) {
      const id = String(r.campaign_id || "");
      if (!id) continue;
      const cur = map.get(id) || {
        name: String(r.campaign_name || id),
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        value: 0,
      };
      cur.spend += n(r.spend);
      cur.impressions += n(r.impressions);
      cur.clicks += n(r.clicks);
      cur.conversions += n(r.conversions);
      cur.value += n(r.conversion_value);
      if (r.campaign_name) cur.name = String(r.campaign_name);
      map.set(id, cur);
    }
    return [...map.values()].sort((a, b) => b.spend - a.spend);
  }, [rows]);

  const onSync = async () => {
    setSyncing(true);
    try {
      const res = (await api.metaAds.syncNow()) as {
        data?: { upserted?: number; leads_imported?: number; errors?: string[] };
      };
      const errs = res?.data?.errors ?? [];
      const leadsN = res?.data?.leads_imported ?? 0;
      const leadBlock = errs.find((e) => /lead/i.test(e));
      toast({
        variant: leadBlock && leadsN === 0 ? "destructive" : "default",
        title: leadBlock && leadsN === 0 ? "Insights synced — leads blocked" : "Meta sync complete",
        description:
          leadBlock && leadsN === 0
            ? leadBlock
            : `Insights ${res?.data?.upserted ?? 0} · Leads imported ${leadsN}`,
      });
      await loadStatus();
      await loadInsights();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary" />
              Meta Ads
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Campaign spend, clicks, conversions & ROAS — refreshed from synced Meta data
              {connected ? "" : " (connect Meta Ads in Settings first)"}.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => navigate("/leads")}>
            View Meta leads
          </Button>
          {canSync ? (
            <Button type="button" size="sm" className="gap-1.5" disabled={syncing || !connected} onClick={() => void onSync()}>
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync now
            </Button>
          ) : null}
        </div>
      </div>

      {connected && !leadsReady ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
          <p className="font-medium">Meta Lead Ads are not importing</p>
          <p className="mt-1 text-amber-900/90">
            Facebook only granted ads/stats access — not{" "}
            <code className="text-xs">leads_retrieval</code>. An admin must finish Meta App Review, set{" "}
            <code className="text-xs">META_ADS_OAUTH_SCOPES=ads_read,leads_retrieval</code>, reconnect in{" "}
            Settings → Meta Ads, then sync.
          </p>
        </div>
      ) : null}

      <Card>
        <CardContent className="pt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Ad account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="All accounts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All enabled accounts</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.ad_account_id} value={a.ad_account_id}>
                    {a.account_name || a.ad_account_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {loading && !totals ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading insights…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <IndianRupee className="h-3.5 w-3.5" /> Spend
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-semibold tabular-nums">
                {fmtMoney(totals?.spend ?? 0)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5" /> Impressions
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-semibold tabular-nums">
                {(totals?.impressions ?? 0).toLocaleString("en-IN")}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <MousePointerClick className="h-3.5 w-3.5" /> Clicks
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-semibold tabular-nums">
                {(totals?.clicks ?? 0).toLocaleString("en-IN")}
                <span className="text-xs font-normal text-muted-foreground ml-2">
                  CTR {(totals?.ctr ?? 0).toFixed(2)}%
                </span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" /> Conversions / ROAS
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xl font-semibold tabular-nums">
                {(totals?.conversions ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                <span className="text-xs font-normal text-muted-foreground ml-2">
                  ROAS {(totals?.roas ?? 0).toFixed(2)}x
                </span>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily spend</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              {chartData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-10 text-center">No insight rows in this range.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="spend" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Campaigns</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Impr.</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                    <TableHead className="text-right">Conv.</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaignRollup.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No campaigns yet — run Sync from Settings → Meta Ads after connecting.
                      </TableCell>
                    </TableRow>
                  ) : (
                    campaignRollup.map((c) => {
                      const ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
                      const roas = c.spend > 0 ? c.value / c.spend : 0;
                      return (
                        <TableRow key={c.name + c.spend}>
                          <TableCell className="font-medium max-w-[220px] truncate">{c.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(c.spend)}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.impressions.toLocaleString("en-IN")}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.clicks.toLocaleString("en-IN")}</TableCell>
                          <TableCell className="text-right tabular-nums">{ctr.toFixed(2)}%</TableCell>
                          <TableCell className="text-right tabular-nums">{c.conversions.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</TableCell>
                          <TableCell className="text-right tabular-nums">{roas.toFixed(2)}x</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
