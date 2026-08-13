import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { RazorpayPaymentLink } from "@/types/paymentLinks";
import { api } from "@/lib/api";
import {
  canApproveManualPayments,
  canSubmitManualPayment,
} from "@/lib/orgAccess";
import { normalizeAppRole } from "@/lib/roleUtils";
import { getAllPaymentLinks } from "@/utils/paymentLinksApi";
import {
  buildMemberPaymentSummaries,
  buildPaymentRecords,
  mergeManualPaymentsIntoSummaries,
  type ManualPaymentRow,
  type TeamMemberLookup,
} from "@/utils/normalizePaymentLink";
import {
  filterLinksByPeriod,
  type PaymentLinkPeriod,
} from "@/utils/paymentLinkPeriod";
import PaymentRecordsTable, {
  type RecordsTableFilters,
} from "@/components/paymentLinks/PaymentRecordsTable";
import ManualPaymentDialog from "@/components/paymentLinks/ManualPaymentDialog";
import ManualPaymentApprovalsTab from "@/components/paymentLinks/ManualPaymentApprovalsTab";
import { Button } from "@/components/ui/button";

const initialFilters: RecordsTableFilters = {
  from: "",
  to: "",
  search: "",
  memberId: "",
};

function parseTeamList(res: unknown): TeamMemberLookup[] {
  const raw = Array.isArray(res)
    ? res
    : (res as { data?: unknown; members?: unknown })?.data ??
      (res as { members?: unknown })?.members ??
      [];
  if (!Array.isArray(raw)) return [];
  return raw.map((m: Record<string, unknown>) => ({
    id: String(m.id ?? ""),
    full_name: String(m.full_name ?? m.name ?? ""),
    email: m.email ? String(m.email) : undefined,
    referral_code: m.referral_code ? String(m.referral_code) : undefined,
    role: m.role ? String(m.role) : undefined,
  }));
}

function parseManualList(res: unknown): ManualPaymentRow[] {
  const raw = Array.isArray(res)
    ? res
    : (res as { data?: unknown })?.data ?? [];
  if (!Array.isArray(raw)) return [];
  return raw as ManualPaymentRow[];
}

type TabKey = "records" | "approvals";

export default function PaymentLinksRecordsPage() {
  const { user } = useAuth();
  const role = normalizeAppRole(user?.role ?? "");
  const showPaymentsBtn = canSubmitManualPayment(role);
  const showApprovals = canApproveManualPayments(role);
  const canDeleteApproved = role === "admin" || role === "super_admin";

  const [links, setLinks] = useState<RazorpayPaymentLink[]>([]);
  const [team, setTeam] = useState<TeamMemberLookup[]>([]);
  const [manuals, setManuals] = useState<ManualPaymentRow[]>([]);
  const [pending, setPending] = useState<ManualPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PaymentLinkPeriod>("month");
  const [filters, setFilters] = useState<RecordsTableFilters>(initialFilters);
  const [tab, setTab] = useState<TabKey>("records");
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const teamRes = await api.team.list().catch(() => ({ data: [] }));
      setTeam(parseTeamList(teamRes));

      const [linksOutcome, manualsOutcome] = await Promise.allSettled([
        getAllPaymentLinks({ period, forRecords: true }),
        api.manualPayments.list("approved"),
      ]);

      if (linksOutcome.status === "fulfilled") {
        setLinks(linksOutcome.value.items ?? []);
      } else {
        setLinks([]);
      }

      if (manualsOutcome.status === "fulfilled") {
        setManuals(parseManualList(manualsOutcome.value));
      } else {
        setManuals([]);
      }

      if (
        linksOutcome.status === "rejected" &&
        manualsOutcome.status === "rejected"
      ) {
        const msg =
          manualsOutcome.reason instanceof Error
            ? manualsOutcome.reason.message
            : "Failed to load records";
        setError(msg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load records");
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [period]);

  const loadApprovals = useCallback(async () => {
    if (!showApprovals) return;
    setApprovalsLoading(true);
    try {
      const res = await api.manualPayments.approvals();
      setPending(parseManualList(res));
    } catch {
      setPending([]);
    } finally {
      setApprovalsLoading(false);
    }
  }, [showApprovals]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  const records = useMemo(
    () => buildPaymentRecords(links, team),
    [links, team],
  );

  const memberCount = useMemo(() => {
    const periodLinkIds = new Set(
      filterLinksByPeriod(
        records.map((r) => r.link),
        period,
      ).map((l) => l.id),
    );
    const periodRecords = records.filter((r) =>
      periodLinkIds.has(r.link.id),
    );
    const linkSummaries = buildMemberPaymentSummaries(periodRecords);
    return mergeManualPaymentsIntoSummaries(linkSummaries, manuals).length;
  }, [records, period, manuals]);
  const pendingCount = useMemo(
    () => pending.filter((r) => String(r.status || "").toLowerCase() === "pending").length,
    [pending],
  );

  async function refreshAll() {
    await Promise.all([loadData(), loadApprovals()]);
  }

  return (
    <div className="p-6 bg-[#f9fafb] min-h-full">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payment Records</h1>
          <p className="text-sm text-gray-500 mt-1">
            Summary by team member — payment links, manual payments, and total
            collected
            {memberCount > 0 ? ` · ${memberCount} member(s) in period` : ""}
          </p>
        </div>
        {showPaymentsBtn ? (
          <Button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="shrink-0 gap-1.5 bg-[#2ed573] hover:bg-[#25c066] text-[#0f2318]"
          >
            <Plus size={16} />
            Payments
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-1 mb-5 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setTab("records")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "records"
              ? "border-[#2ed573] text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          Records
        </button>
        {showApprovals ? (
          <button
            type="button"
            onClick={() => setTab("approvals")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors inline-flex items-center gap-2 ${
              tab === "approvals"
                ? "border-[#2ed573] text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            Approvals
            {pendingCount > 0 ? (
              <span className="inline-flex min-w-[1.25rem] justify-center rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5">
                {pendingCount}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {error && tab === "records" ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5 text-sm text-red-700">
          <strong>Error:</strong> {error}
          <button
            type="button"
            onClick={() => void loadData()}
            className="ml-3 underline font-medium"
          >
            Retry
          </button>
        </div>
      ) : null}

      {tab === "records" ? (
        <PaymentRecordsTable
          records={records}
          team={team}
          loading={loading}
          period={period}
          onPeriodChange={setPeriod}
          filters={filters}
          onFilterChange={setFilters}
          onRefresh={loadData}
          manualPayments={manuals}
        />
      ) : (
        <ManualPaymentApprovalsTab
          rows={pending}
          loading={approvalsLoading}
          canDeleteApproved={canDeleteApproved}
          onChanged={() => void refreshAll()}
        />
      )}

      {showPaymentsBtn ? (
        <ManualPaymentDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmitted={() => void refreshAll()}
        />
      ) : null}
    </div>
  );
}
