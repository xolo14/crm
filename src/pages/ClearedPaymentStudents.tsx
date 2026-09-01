import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, User } from "lucide-react";
import { api } from "@/lib/api";
import type { PaymentCandidateRow } from "@/components/paymentLinks/CandidatePaymentRecords";

function fmtInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Operational Manager Students view:
 * enrolled = payment candidates who completed (cleared) their pitch.
 */
export default function ClearedPaymentStudents() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<PaymentCandidateRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = (await api.paymentCandidates.list()) as {
        data?: PaymentCandidateRow[];
      };
      const all = Array.isArray(res?.data) ? res.data : [];
      setRows(all.filter((r) => String(r.status) === "cleared"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load students");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.customer_name,
        r.customer_email,
        r.customer_phone,
        r.owner_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  return (
    <div className="p-6 bg-[#f9fafb] min-h-full">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Students</h1>
          <p className="text-sm text-gray-500 mt-1">
            Enrolled students — pitch payment completed
            {filtered.length > 0 ? ` · ${filtered.length}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone, or rep…"
            className="w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2ed573]/40"
          />
        </div>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3 font-semibold">Student</th>
                <th className="px-4 py-3 font-semibold">Rep</th>
                <th className="px-4 py-3 font-semibold text-right">Pitch</th>
                <th className="px-4 py-3 font-semibold text-right">Collected</th>
                <th className="px-4 py-3 font-semibold text-right">Installments</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                    Loading enrolled students…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-14 text-center">
                    <p className="font-semibold text-gray-900">
                      No payment-completed students yet
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      Candidates appear here when collected amount reaches pitch price.
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 min-w-[12rem]">
                      <div className="flex items-center gap-2">
                        <div className="h-9 w-9 rounded-full bg-[#e6faf0] flex items-center justify-center shrink-0">
                          <User size={16} className="text-[#0f2318]" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 truncate">
                            {row.customer_name}
                          </p>
                          <p className="text-[11px] text-gray-500 truncate">
                            {[row.customer_email, row.customer_phone]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{row.owner_name || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmtInr(Number(row.pitch_price || 0))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#22c55e] font-medium">
                      {fmtInr(Number(row.total_paid || 0))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.installment_count ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-[#e6faf0] text-[#0f5230] text-[10px] font-semibold px-2 py-0.5">
                        Payment completed
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
