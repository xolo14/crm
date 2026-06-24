import { useMemo, useState } from "react";
import {
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Mail,
  RefreshCw,
  X,
} from "lucide-react";
import type {
  PaymentLinkStatus,
  RazorpayPaymentLink,
} from "@/types/paymentLinks";
import PaymentLinksPeriodTabs from "@/components/paymentLinks/PaymentLinksPeriodTabs";
import {
  paymentLinkInvoiceLabel,
  paymentLinkReferralCode,
} from "@/utils/normalizePaymentLink";
import {
  filterLinksByPeriod,
  type PaymentLinkPeriod,
} from "@/utils/paymentLinkPeriod";

export interface TableFilters {
  status: string;
  paymentType: string;
  from: string;
  to: string;
  search: string;
  assignee: string;
}

interface Props {
  links: RazorpayPaymentLink[];
  loading: boolean;
  period: PaymentLinkPeriod;
  onPeriodChange: (period: PaymentLinkPeriod) => void;
  filters: TableFilters;
  onFilterChange: (filters: TableFilters) => void;
  onViewDetail: (link: RazorpayPaymentLink) => void;
  onCancel: (id: string) => void;
  onRemind: (id: string, medium: "sms" | "email") => void;
  onRefresh: () => void;
  onCopyShortUrl: (url: string) => void;
  onCreate?: () => void;
  emptyTitle?: string;
}

const PAGE_SIZE = 15;

const STATUS_BADGE: Record<PaymentLinkStatus, { label: string; cls: string }> =
  {
    created: {
      label: "Pending",
      cls: "bg-amber-50 text-amber-700 border-amber-200",
    },
    paid: {
      label: "Paid",
      cls: "bg-[#e6faf0] text-[#0f5230] border-[#bdebd0]",
    },
    partially_paid: {
      label: "Partial",
      cls: "bg-blue-50 text-blue-800 border-blue-200",
    },
    cancelled: {
      label: "Cancelled",
      cls: "bg-gray-100 text-gray-500 border-gray-200",
    },
    expired: {
      label: "Expired",
      cls: "bg-red-50 text-red-600 border-red-200",
    },
  };

function fmtDateTime(unix?: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 14)}…` : id;
}

const inputCls =
  "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2ed573]/40 focus:border-[#2ed573]";

const initialFilters: TableFilters = {
  status: "",
  paymentType: "",
  from: "",
  to: "",
  search: "",
  assignee: "",
};

export default function PaymentLinksTable({
  links,
  loading,
  period,
  onPeriodChange,
  filters,
  onFilterChange,
  onViewDetail,
  onCancel,
  onRemind,
  onRefresh,
  onCopyShortUrl,
  onCreate,
  emptyTitle = "No payment links yet",
}: Props) {
  const [page, setPage] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function setField<K extends keyof TableFilters>(
    key: K,
    value: TableFilters[K],
  ) {
    onFilterChange({ ...filters, [key]: value });
    setPage(1);
  }

  const filtered = useMemo(() => {
    let list = filterLinksByPeriod(links, period);

    const fromTs = filters.from
      ? Math.floor(new Date(filters.from + "T00:00:00").getTime() / 1000)
      : null;
    const toTs = filters.to
      ? Math.floor(new Date(filters.to + "T23:59:59").getTime() / 1000)
      : null;
    const term = filters.search.trim().toLowerCase();

    return list.filter((l) => {
      if (filters.status && l.status !== filters.status) return false;
      if (fromTs !== null && l.created_at < fromTs) return false;
      if (toTs !== null && l.created_at > toTs) return false;
      if (term) {
        const invoice = paymentLinkInvoiceLabel(l);
        const hay = [
          l.id,
          l.reference_id,
          invoice,
          l.customer?.name,
          l.customer?.email,
          l.customer?.contact,
          l.description,
          l.short_url,
          paymentLinkReferralCode(l),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [links, period, filters]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  function handleCopyText(id: string, text: string) {
    void navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1500);
  }

  function clearAll() {
    onFilterChange(initialFilters);
    setPage(1);
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="text-base font-semibold text-gray-900">Payment Links</h2>
        <PaymentLinksPeriodTabs value={period} onChange={onPeriodChange} />
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select
            value={filters.status}
            onChange={(e) => setField("status", e.target.value)}
            className={inputCls}
          >
            <option value="">All statuses</option>
            <option value="created">Pending</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
            <option value="expired">Expired</option>
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
            placeholder="Search invoice, customer, link ID…"
            className={inputCls}
          />
        </div>
        <div className="flex items-center justify-between mt-3">
          <button
            type="button"
            onClick={clearAll}
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            Clear filters
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-3 font-semibold">Link ID</th>
                <th className="px-3 py-3 font-semibold">Invoice / Ref</th>
                <th className="px-3 py-3 font-semibold">Customer</th>
                <th className="px-3 py-3 font-semibold">Phone</th>
                <th className="px-3 py-3 font-semibold">Email</th>
                <th className="px-3 py-3 font-semibold">Amount</th>
                <th className="px-3 py-3 font-semibold">Paid</th>
                <th className="px-3 py-3 font-semibold">Description</th>
                <th className="px-3 py-3 font-semibold">Referral</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Created</th>
                <th className="px-3 py-3 font-semibold">Expires</th>
                <th className="px-3 py-3 font-semibold">Payment URL</th>
                <th className="px-3 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={14}
                    className="px-4 py-12 text-center text-sm text-gray-500"
                  >
                    Loading payment links…
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-4 py-14 text-center">
                    <p className="text-base font-semibold text-gray-900">
                      {emptyTitle}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      {links.length > 0
                        ? "Try another period or clear filters."
                        : "Create a payment link to see it here."}
                    </p>
                    {onCreate && links.length === 0 && (
                      <button
                        type="button"
                        onClick={onCreate}
                        className="mt-4 inline-flex items-center gap-2 bg-[#2ed573] text-[#0f2318] font-semibold px-4 py-2 rounded-xl text-sm"
                      >
                        Create Payment Link
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                pageRows.map((l) => {
                  const badge =
                    STATUS_BADGE[l.status] ?? STATUS_BADGE.created;
                  const isPending = l.status === "created";
                  const invoice = paymentLinkInvoiceLabel(l);
                  const referral = paymentLinkReferralCode(l);
                  const lastPayment = l.payments?.[l.payments.length - 1];

                  return (
                    <tr key={l.id} className="hover:bg-gray-50/80 align-top">
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => handleCopyText(l.id, l.id)}
                          className="font-mono text-[11px] text-gray-700 hover:text-[#0f2318] text-left"
                          title={l.id}
                        >
                          {shortId(l.id)}
                          {copiedId === l.id ? (
                            <span className="block text-[10px] text-emerald-600">
                              Copied
                            </span>
                          ) : null}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-start gap-1">
                          <FileText
                            size={14}
                            className="text-gray-400 shrink-0 mt-0.5"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyText(`inv-${l.id}`, invoice)
                            }
                            className="font-mono text-[11px] text-gray-800 hover:underline text-left break-all"
                            title="Invoice / reference"
                          >
                            {invoice}
                          </button>
                        </div>
                        {lastPayment?.payment_id ? (
                          <p className="text-[10px] text-gray-500 mt-1 font-mono">
                            Pay: {shortId(lastPayment.payment_id)}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 font-medium text-gray-900 max-w-[8rem]">
                        <span className="line-clamp-2">
                          {l.customer?.name || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-700 whitespace-nowrap">
                        {l.customer?.contact || "—"}
                      </td>
                      <td className="px-3 py-3 text-xs max-w-[10rem]">
                        <span className="text-gray-700 break-all line-clamp-2">
                          {l.customer?.email || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-semibold text-gray-900 whitespace-nowrap">
                        {fmtInr(l.amount)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {l.amount_paid > 0 ? (
                          <span className="text-[#22c55e] font-medium">
                            {fmtInr(l.amount_paid)}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 max-w-[10rem]">
                        <span className="text-gray-700 line-clamp-2 text-xs">
                          {l.description || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {referral ? (
                          <span className="font-mono text-[11px] text-[#0f2318] bg-[#e6faf0] px-1.5 py-0.5 rounded">
                            {referral}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-700 whitespace-nowrap">
                        {fmtDateTime(l.created_at)}
                      </td>
                      <td
                        className={`px-3 py-3 text-xs whitespace-nowrap ${l.status === "expired" ? "text-red-600" : "text-gray-700"}`}
                      >
                        {l.expire_by ? fmtDateTime(l.expire_by) : "No expiry"}
                      </td>
                      <td className="px-3 py-3 max-w-[8rem]">
                        {l.short_url ? (
                          <a
                            href={l.short_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-blue-600 hover:underline break-all line-clamp-2 inline-flex items-start gap-0.5"
                          >
                            {l.short_url.replace(/^https?:\/\//, "")}
                            <ExternalLink size={10} className="shrink-0" />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => onCopyShortUrl(l.short_url)}
                            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
                            title="Copy URL"
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onViewDetail(l)}
                            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
                            title="View"
                          >
                            <Eye size={14} />
                          </button>
                          {isPending && l.customer?.email ? (
                            <button
                              type="button"
                              onClick={() => onRemind(l.id, "email")}
                              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
                              title="Razorpay reminder"
                            >
                              <Mail size={14} />
                            </button>
                          ) : null}
                          {isPending ? (
                            <button
                              type="button"
                              onClick={() => onCancel(l.id)}
                              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
          <p>
            {total === 0
              ? "0 links"
              : `Showing ${pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, total)} of ${total}`}
            {links.length !== total ? ` (${links.length} loaded)` : ""}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-xs">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
