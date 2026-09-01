import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  GraduationCap,
  IndianRupee,
  Loader2,
  Receipt,
  RefreshCw,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type { PaymentCandidateKpi } from "@/components/paymentLinks/CandidatePaymentRecords";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function fmtInr(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export default function OperationalManagerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpi, setKpi] = useState<PaymentCandidateKpi | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = (await api.paymentCandidates.list()) as { kpi?: PaymentCandidateKpi };
      setKpi(
        res?.kpi ?? {
          candidate_count: 0,
          total_pitch: 0,
          total_paid: 0,
          total_remaining: 0,
          cleared_count: 0,
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payment summary");
      setKpi(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const name = String(user?.full_name || "").trim() || "Operational Manager";
  const inProgress = Math.max(0, (kpi?.candidate_count ?? 0) - (kpi?.cleared_count ?? 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Payments overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome, {name}. Track pitch, collections, and enrolled students.
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title="Students enrolled"
              value={String(kpi?.cleared_count ?? 0)}
              hint="Candidates linked to enrolled students"
              icon={GraduationCap}
            />
            <KpiCard
              title="Total pitch"
              value={fmtInr(kpi?.total_pitch ?? 0)}
              hint={`${kpi?.candidate_count ?? 0} candidates`}
              icon={Wallet}
            />
            <KpiCard
              title="Total paid"
              value={fmtInr(kpi?.total_paid ?? 0)}
              hint="Collected so far"
              icon={IndianRupee}
            />
            <KpiCard
              title="Remaining"
              value={fmtInr(kpi?.total_remaining ?? 0)}
              hint={`${inProgress} in progress`}
              icon={Users}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
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
                  Enrolled students
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
}: {
  title: string;
  value: string;
  hint: string;
  icon: typeof Users;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 pt-5">
        <div className="rounded-lg bg-muted p-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
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
