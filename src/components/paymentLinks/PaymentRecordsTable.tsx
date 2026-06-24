import { useMemo, useState } from "react";
import { RefreshCw, User } from "lucide-react";
import PaymentLinksPeriodTabs from "@/components/paymentLinks/PaymentLinksPeriodTabs";
import type { PaymentRecordRow, TeamMemberLookup } from "@/utils/normalizePaymentLink";
import {
  buildMemberPaymentSummaries,
  type MemberPaymentSummary,
} from "@/utils/normalizePaymentLink";
import {
  filterLinksByPeriod,
  type PaymentLinkPeriod,
} from "@/utils/paymentLinkPeriod";

export interface RecordsTableFilters {
  from: string;
  to: string;
  search: string;
  memberId: string;
}

interface Props {
  records: PaymentRecordRow[];
  team: TeamMemberLookup[];
  loading: boolean;
  period: PaymentLinkPeriod;
  onPeriodChange: (period: PaymentLinkPeriod) => void;
  filters: RecordsTableFilters;
  onFilterChange: (filters: RecordsTableFilters) => void;
  onRefresh: () => void;
}

const PAGE_SIZE = 20;

function fmtInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const inputCls =
  "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2ed573]/40 focus:border-[#2ed573]";

export default function PaymentRecordsTable({
  records,
  team,
  loading,
  period,
  onPeriodChange,
  filters,
  onFilterChange,
  onRefresh,
}: Props) {
  const [page, setPage] = useState(1);

  function setField<K extends keyof RecordsTableFilters>(
    key: K,
    value: RecordsTableFilters[K],
  ) {
    onFilterChange({ ...filters, [key]: value });
    setPage(1);
  }

  const periodRecords = useMemo(() => {
    const periodLinkIds = new Set(
      filterLinksByPeriod(
        records.map((r) => r.link),
        period,
      ).map((l) => l.id),
    );
    return records.filter((r) => periodLinkIds.has(r.link.id));
  }, [records, period]);

  const filteredRecords = useMemo(() => {
    const fromTs = filters.from
      ? Math.floor(new Date(filters.from + "T00:00:00").getTime() / 1000)
      : null;
    const toTs = filters.to
      ? Math.floor(new Date(filters.to + "T23:59:59").getTime() / 1000)
      : null;
    const term = filters.search.trim().toLowerCase();

    return periodRecords.filter((r) => {
      const l = r.link;
      if (filters.memberId && r.creator.id !== filters.memberId) return false;
      if (fromTs !== null && l.created_at < fromTs) return false;
      if (toTs !== null && l.created_at > toTs) return false;
      if (term) {
        const hay = [
          r.creator.full_name,
          r.creator.email,
          r.creator.referral_code,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [periodRecords, filters]);

  const memberRows = useMemo(
    () => buildMemberPaymentSummaries(filteredRecords),
    [filteredRecords],
  );

  const totals = useMemo(() => {
    return memberRows.reduce(
      (acc, m) => ({
        links: acc.links + m.totalLinks,
        paid: acc.paid + m.paidCount,
        partial: acc.partial + m.partialCount,
        payments: acc.payments + m.paymentsReceivedCount,
        collected: acc.collected + m.totalCollectedPaise,
      }),
      { links: 0, paid: 0, partial: 0, payments: 0, collected: 0 },
    );
  }, [memberRows]);

  const creatorsWithLinks = useMemo(() => {
    const ids = new Set(
      periodRecords
        .map((r) => r.creator.id)
        .filter((id) => id && id !== ""),
    );
    return team
      .filter((m) => ids.has(String(m.id)))
      .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
  }, [periodRecords, team]);

  const total = memberRows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = memberRows.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="text-base font-semibold text-gray-900">
          Team member summary
        </h2>
        <PaymentLinksPeriodTabs value={period} onChange={onPeriodChange} />
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select
            value={filters.memberId}
            onChange={(e) => setField("memberId", e.target.value)}
            className={inputCls}
          >
            <option value="">All members</option>
            {creatorsWithLinks.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {m.full_name || m.email}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setField("from", e.target.value)}
            className={inputCls}
            title="From date"
          />
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setField("to", e.target.value)}
            className={inputCls}
            title="To date"
          />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => setField("search", e.target.value)}
            placeholder="Search member name or referral…"
            className={inputCls}
          />
        </div>
        <div className="flex justify-end mt-3">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3 font-semibold">Member</th>
                <th className="px-4 py-3 font-semibold text-right">
                  Payment links
                </th>
                <th className="px-4 py-3 font-semibold text-right">Paid</th>
                <th className="px-4 py-3 font-semibold text-right">Partial</th>
                <th className="px-4 py-3 font-semibold text-right">
                  Payments received
                </th>
                <th className="px-4 py-3 font-semibold text-right">
                  Total collected
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-gray-500"
                  >
                    Loading payment records…
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-14 text-center">
                    <p className="font-semibold text-gray-900">
                      No member activity for this period
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      When team members create payment links, their totals will
                      appear here.
                    </p>
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => (
                  <MemberSummaryRow key={rowKey(row)} row={row} />
                ))
              )}
            </tbody>
            {!loading && memberRows.length > 0 ? (
              <tfoot>
                <tr className="bg-[#f0fdf4] border-t-2 border-[#bdebd0] font-semibold text-[#0f2318]">
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {totals.links}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#22c55e]">
                    {totals.paid}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-blue-700">
                    {totals.partial}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {totals.payments}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#22c55e]">
                    {fmtInr(totals.collected)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-gray-600">
          <p>
            {total === 0
              ? "0 members"
              : `${pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, total)} of ${total} member(s)`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-xs self-center">
              {currentPage}/{totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function rowKey(row: MemberPaymentSummary): string {
  return row.creator.id || row.creator.full_name;
}

function MemberSummaryRow({ row }: { row: MemberPaymentSummary }) {
  const { creator } = row;
  const ref = creator.referral_code?.trim();

  return (
    <tr className="hover:bg-gray-50/80">
      <td className="px-4 py-3 min-w-[12rem]">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-full bg-[#e6faf0] flex items-center justify-center shrink-0">
            <User size={16} className="text-[#0f2318]" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">
              {creator.full_name}
            </p>
            {creator.email ? (
              <p className="text-[11px] text-gray-500 truncate">
                {creator.email}
              </p>
            ) : null}
            {ref ? (
              <p className="text-[10px] font-mono text-[#2ed573] mt-0.5">
                {ref}
              </p>
            ) : null}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {row.totalLinks}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <span className="inline-flex min-w-[1.5rem] justify-center rounded-full bg-[#e6faf0] text-[#0f5230] text-xs font-semibold px-2 py-0.5">
          {row.paidCount}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <span className="inline-flex min-w-[1.5rem] justify-center rounded-full bg-blue-50 text-blue-800 text-xs font-semibold px-2 py-0.5">
          {row.partialCount}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums">
        {row.paymentsReceivedCount}
      </td>
      <td className="px-4 py-3 text-right font-semibold text-[#22c55e] tabular-nums whitespace-nowrap">
        {fmtInr(row.totalCollectedPaise)}
      </td>
    </tr>
  );
}
