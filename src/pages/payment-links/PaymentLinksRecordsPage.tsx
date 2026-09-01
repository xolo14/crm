import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { RazorpayPaymentLink } from "@/types/paymentLinks";
import { api } from "@/lib/api";
import {
  canApproveManualPayments,
  canSubmitManualPayment,
  isPaymentRecordsOrgCandidatesView,
  isPaymentRecordsTeamView,
} from "@/lib/orgAccess";
import { normalizeAppRole } from "@/lib/roleUtils";
import { getAllPaymentLinks } from "@/utils/paymentLinksApi";
import {
  buildMemberPaymentSummaries,
  buildPaymentRecords,
  mergeManualPaymentsIntoSummaries,
  type ManualPaymentRow,
  type MemberPaymentSummary,
  type PaymentCandidateSummaryInput,
  type TeamMemberLookup,
} from "@/utils/normalizePaymentLink";
import {
  filterCandidatesByPeriod,
  filterLinksByPeriod,
  filterManualRowsByPeriod,
  type PaymentLinkPeriod,
} from "@/utils/paymentLinkPeriod";
import PaymentRecordsTable, {
  type RecordsTableFilters,
} from "@/components/paymentLinks/PaymentRecordsTable";
import CandidatePaymentRecords from "@/components/paymentLinks/CandidatePaymentRecords";
import ManualPaymentDialog from "@/components/paymentLinks/ManualPaymentDialog";
import ManualPaymentApprovalsTab from "@/components/paymentLinks/ManualPaymentApprovalsTab";
import PaymentBankDetailsChip from "@/components/paymentLinks/PaymentBankDetailsChip";
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
  const teamView = isPaymentRecordsTeamView(role);
  const orgCandidatesView = isPaymentRecordsOrgCandidatesView(role);
  const showPaymentsBtn = canSubmitManualPayment(role);
  const showApprovals = canApproveManualPayments(role);
  const canDeleteApproved = role === "org" || role === "super_admin";

  const [links, setLinks] = useState<RazorpayPaymentLink[]>([]);
  const [team, setTeam] = useState<TeamMemberLookup[]>([]);
  const [manuals, setManuals] = useState<ManualPaymentRow[]>([]);
  const [candidates, setCandidates] = useState<PaymentCandidateSummaryInput[]>([]);
  const [pending, setPending] = useState<ManualPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PaymentLinkPeriod>("month");
  const [filters, setFilters] = useState<RecordsTableFilters>(initialFilters);
  const [tab, setTab] = useState<TabKey>("records");
  /** Org/admin/manager: candidates list (migrated payment_candidates) vs legacy link summary. */
  const [teamSummaryMode, setTeamSummaryMode] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drillMember, setDrillMember] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Team summary needs payment links; L1 candidate view does not (avoids 403 noise).
      if (!teamView) {
        setLinks([]);
        setManuals([]);
        setCandidates([]);
        setTeam([]);
        setLoading(false);
        return;
      }

      const teamRes = await api.team.list().catch(() => ({ data: [] }));
      setTeam(parseTeamList(teamRes));

      const customRange =
        period === "custom"
          ? { from: filters.from || undefined, to: filters.to || undefined }
          : undefined;

      const [linksOutcome, manualsOutcome, candidatesOutcome] = await Promise.allSettled([
        getAllPaymentLinks({ period, forRecords: true, customRange }),
        api.manualPayments.list("approved"),
        api.paymentCandidates.list(),
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

      if (candidatesOutcome.status === "fulfilled") {
        const raw = candidatesOutcome.value as { data?: PaymentCandidateSummaryInput[] };
        setCandidates(Array.isArray(raw?.data) ? raw.data : []);
      } else {
        setCandidates([]);
      }

      if (
        linksOutcome.status === "rejected" &&
        manualsOutcome.status === "rejected" &&
        candidatesOutcome.status === "rejected"
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
  }, [period, teamView, filters.from, filters.to]);

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
    const customRange =
      period === "custom"
        ? { from: filters.from || undefined, to: filters.to || undefined }
        : undefined;
    const periodLinkIds = new Set(
      filterLinksByPeriod(
        records.map((r) => r.link),
        period,
        customRange,
      ).map((l) => l.id),
    );
    const periodRecords = records.filter((r) =>
      periodLinkIds.has(r.link.id),
    );
    const linkSummaries = buildMemberPaymentSummaries(periodRecords);
    const manualsInPeriod = filterManualRowsByPeriod(manuals, period, customRange);
    const fromCandidates = filterCandidatesByPeriod(candidates, period, customRange);
    const ownerIds = new Set([
      ...linkSummaries.map((s) => s.creator.id),
      ...manualsInPeriod.map((m) => String(m.submitted_by)),
      ...fromCandidates.map((c) => String(c.owner_user_id || "")),
    ]);
    return ownerIds.size;
  }, [records, period, manuals, candidates, filters.from, filters.to]);
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
            {teamView && teamSummaryMode && !drillMember
              ? "Summary by team member — click a member to view their candidates"
              : teamView && drillMember
                ? `Candidates for ${drillMember.name}`
                : teamView
                  ? "All payment candidates in the organization"
                  : orgCandidatesView
                    ? "All candidates in the organization (read-only)"
                    : "Pitch price, installments, and collected amounts per candidate"}
            {!teamView && !orgCandidatesView && memberCount > 0
              ? ` · ${memberCount} member(s) in period`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <PaymentBankDetailsChip />
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

      {tab === "records" && teamView ? (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            onClick={() => {
              setTeamSummaryMode(false);
              setDrillMember(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              !teamSummaryMode && !drillMember
                ? "bg-[#2ed573] text-[#0f2318] border-[#2ed573]"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
            }`}
          >
            All candidates
          </button>
          <button
            type="button"
            onClick={() => {
              setTeamSummaryMode(true);
              setDrillMember(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              teamSummaryMode && !drillMember
                ? "bg-[#2ed573] text-[#0f2318] border-[#2ed573]"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
            }`}
          >
            Team summary
          </button>
        </div>
      ) : null}

      {tab === "records" ? (
        teamView && teamSummaryMode && !drillMember ? (
          <PaymentRecordsTable
            records={records}
            team={team}
            candidates={candidates}
            loading={loading}
            period={period}
            onPeriodChange={setPeriod}
            filters={filters}
            onFilterChange={setFilters}
            onRefresh={loadData}
            manualPayments={manuals}
            onMemberClick={(row: MemberPaymentSummary) =>
              setDrillMember({
                id: row.creator.id,
                name: row.creator.full_name || row.creator.email || "Member",
              })
            }
          />
        ) : (
          <CandidatePaymentRecords
            ownerUserId={drillMember?.id}
            ownerName={drillMember?.name}
            showOwnerColumn={teamView || orgCandidatesView}
            onBack={
              drillMember
                ? () => setDrillMember(null)
                : undefined
            }
            onRefreshParent={loadData}
          />
        )
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
