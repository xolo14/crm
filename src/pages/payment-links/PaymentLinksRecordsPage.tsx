import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import type { RazorpayPaymentLink } from "@/types/paymentLinks";
import { api } from "@/lib/api";
import { getAllPaymentLinks } from "@/utils/paymentLinksApi";
import {
  buildMemberPaymentSummaries,
  buildPaymentRecords,
  type TeamMemberLookup,
} from "@/utils/normalizePaymentLink";
import {
  filterLinksByPeriod,
  type PaymentLinkPeriod,
} from "@/utils/paymentLinkPeriod";
import PaymentRecordsTable, {
  type RecordsTableFilters,
} from "@/components/paymentLinks/PaymentRecordsTable";

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

export default function PaymentLinksRecordsPage() {
  const { user, profile } = useAuth();
  const role = user?.role ?? "";
  const isSalesRep = role === "sales_representative";

  const [links, setLinks] = useState<RazorpayPaymentLink[]>([]);
  const [team, setTeam] = useState<TeamMemberLookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PaymentLinkPeriod>("all");
  const [filters, setFilters] = useState<RecordsTableFilters>(() => ({
    ...initialFilters,
    memberId: isSalesRep && user?.id ? String(user.id) : "",
  }));

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [linksRes, teamRes] = await Promise.all([
        getAllPaymentLinks({ period }),
        api.team.list(),
      ]);
      setLinks(linksRes.items ?? []);
      setTeam(parseTeamList(teamRes));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load records");
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
    return buildMemberPaymentSummaries(periodRecords).length;
  }, [records, period]);

  return (
    <div className="p-6 bg-[#f9fafb] min-h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Payment Records</h1>
        <p className="text-sm text-gray-500 mt-1">
          Summary by team member — payment links created, paid, partial, and
          total collected
          {memberCount > 0 ? ` · ${memberCount} member(s) in period` : ""}
        </p>
      </div>

      {error && (
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
      )}

      <PaymentRecordsTable
        records={records}
        team={team}
        loading={loading}
        period={period}
        onPeriodChange={setPeriod}
        filters={filters}
        onFilterChange={setFilters}
        onRefresh={loadData}
      />
    </div>
  );
}
