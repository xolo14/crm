import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Pencil, Plus, RefreshCw, User } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { canEditPaymentCandidatePitch, canSubmitManualPayment } from "@/lib/orgAccess";
import ManualPaymentDialog from "@/components/paymentLinks/ManualPaymentDialog";
import {
  PAYMENT_LINK_PERIODS,
  paymentLinkPeriodUnixRange,
  type PaymentLinkPeriod,
} from "@/utils/paymentLinkPeriod";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type PaymentCandidateRow = {
  id: string;
  customer_name: string;
  customer_email?: string | null;
  customer_phone?: string | null;
  owner_user_id?: string;
  owner_name?: string | null;
  pitch_price: number;
  total_paid: number;
  remaining: number;
  installment_count: number;
  status: "cleared" | "in_progress" | "no_pitch" | string;
  enrolled?: boolean;
  updated_at?: string | null;
  created_at?: string | null;
};

export type PaymentCandidateInstallment = {
  id: string;
  amount: number;
  paid_at?: string | null;
  created_at?: string | null;
  payment_method?: string | null;
  status?: string | null;
  installment_number?: number | null;
  source: "manual" | "payment_link" | string;
  description?: string | null;
};

export type PaymentCandidateKpi = {
  candidate_count: number;
  total_pitch: number;
  total_paid: number;
  total_remaining: number;
  cleared_count: number;
  /** Candidates matched to an enrolled student / lead (separate from payment cleared). */
  enrolled_count?: number;
};

interface Props {
  ownerUserId?: string;
  ownerName?: string;
  showOwnerColumn?: boolean;
  onBack?: () => void;
  onRefreshParent?: () => void;
}

const inputCls =
  "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2ed573]/40 focus:border-[#2ed573]";

function fmtInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPitchCell(pitch: number) {
  const n = Number(pitch || 0);
  if (n <= 0) {
    return (
      <span className="text-gray-400 text-xs font-medium">No pitch</span>
    );
  }
  return (
    <span className="font-semibold text-[#0f5230] tabular-nums whitespace-nowrap">
      {fmtInr(n)}
    </span>
  );
}

function statusBadge(status: string) {
  if (status === "cleared") {
    return (
      <span className="inline-flex rounded-full bg-[#e6faf0] text-[#0f5230] text-[10px] font-semibold px-2 py-0.5">
        Cleared
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="inline-flex rounded-full bg-amber-50 text-amber-800 text-[10px] font-semibold px-2 py-0.5">
        In progress
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-gray-100 text-gray-600 text-[10px] font-semibold px-2 py-0.5">
      No pitch
    </span>
  );
}

const PAGE_SIZE = 20;

export default function CandidatePaymentRecords({
  ownerUserId,
  ownerName,
  showOwnerColumn = false,
  onBack,
  onRefreshParent,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canUpdate = canSubmitManualPayment(user?.role ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<PaymentLinkPeriod>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rows, setRows] = useState<PaymentCandidateRow[]>([]);
  const [kpi, setKpi] = useState<PaymentCandidateKpi | null>(null);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<
    (PaymentCandidateRow & { installments?: PaymentCandidateInstallment[] }) | null
  >(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [pitchEditOpen, setPitchEditOpen] = useState(false);
  const [pitchDraft, setPitchDraft] = useState("");
  const [pitchSaving, setPitchSaving] = useState(false);

  const canEditPitchFor = useCallback(
    (row: Pick<PaymentCandidateRow, "owner_user_id"> | null | undefined) =>
      canEditPaymentCandidatePitch(user?.role ?? null, user?.id, row?.owner_user_id),
    [user?.id, user?.role],
  );

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const customRange =
        period === "custom"
          ? { from: customFrom || undefined, to: customTo || undefined }
          : undefined;
      const unixRange = paymentLinkPeriodUnixRange(period, customRange);
      const query: {
        owner_user_id?: string;
        search?: string;
        from?: number;
        to?: number;
      } = {
        owner_user_id: ownerUserId,
        search: search.trim() || undefined,
      };
      if (period !== "all") {
        if (unixRange.from !== undefined) query.from = unixRange.from;
        if (unixRange.to !== undefined) query.to = unixRange.to;
      }

      const res = (await api.paymentCandidates.list(query)) as {
        data?: PaymentCandidateRow[];
        kpi?: PaymentCandidateKpi;
      };
      const raw = Array.isArray(res?.data) ? res.data : [];
      setRows(
        raw.map((row) => ({
          ...row,
          pitch_price: Number(row.pitch_price ?? 0),
          total_paid: Number(row.total_paid ?? 0),
          remaining: Number(row.remaining ?? 0),
          installment_count: Number(row.installment_count ?? 0),
        })),
      );
      setKpi(res?.kpi ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load candidates");
      setRows([]);
      setKpi(null);
    } finally {
      setLoading(false);
    }
  }, [ownerUserId, search, period, customFrom, customTo]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    setPage(1);
    setSelectedId(null);
    setDetail(null);
  }, [ownerUserId, period, customFrom, customTo]);

  const periodLabel = useMemo(
    () => PAYMENT_LINK_PERIODS.find((p) => p.value === period)?.label ?? "All Time",
    [period],
  );
  const collectedLabel = period === "all" ? "Collected" : `Collected (${periodLabel})`;

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = (await api.paymentCandidates.detail(id)) as {
        data?: PaymentCandidateRow & { installments?: PaymentCandidateInstallment[] };
      };
      setDetail(res?.data ?? null);
      setSelectedId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load candidate");
      setDetail(null);
      setSelectedId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const filteredRows = rows;
  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredRows.slice(pageStart, pageStart + PAGE_SIZE);

  const headerTitle = useMemo(() => {
    if (selectedId && detail) return detail.customer_name;
    if (ownerName) return `${ownerName} — candidates`;
    return "Candidates";
  }, [selectedId, detail, ownerName]);

  async function handleRefresh() {
    if (selectedId) {
      await loadDetail(selectedId);
    }
    await loadList();
    onRefreshParent?.();
  }

  function openPitchEdit() {
    if (!detail) return;
    setPitchDraft(
      Number(detail.pitch_price || 0) > 0 ? String(Number(detail.pitch_price)) : "",
    );
    setPitchEditOpen(true);
  }

  async function handleSavePitch() {
    if (!detail) return;
    const pitch = Number(pitchDraft);
    if (!Number.isFinite(pitch) || pitch < 0) {
      toast({
        variant: "destructive",
        title: "Invalid pitch",
        description: "Enter a valid amount (0 or greater).",
      });
      return;
    }
    setPitchSaving(true);
    try {
      const res = (await api.paymentCandidates.updatePitch(detail.id, pitch)) as {
        data?: PaymentCandidateRow & { installments?: PaymentCandidateInstallment[] };
      };
      if (res?.data) {
        setDetail(res.data);
      } else if (selectedId) {
        await loadDetail(selectedId);
      }
      setPitchEditOpen(false);
      await loadList();
      onRefreshParent?.();
      toast({ title: "Pitch price updated" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not update pitch",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setPitchSaving(false);
    }
  }

  if (selectedId) {
    return (
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1"
              onClick={() => {
                setSelectedId(null);
                setDetail(null);
              }}
            >
              <ArrowLeft size={16} />
              Back
            </Button>
            <h2 className="text-base font-semibold text-gray-900 truncate">
              {headerTitle}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canEditPitchFor(detail) && detail ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openPitchEdit}
                className="gap-1.5"
              >
                <Pencil size={14} />
                Edit pitch
              </Button>
            ) : null}
            {canUpdate && detail ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setUpdateOpen(true)}
                className="gap-1.5 bg-[#2ed573] hover:bg-[#25c066] text-[#0f2318]"
              >
                <Plus size={14} />
                Update payments
              </Button>
            ) : null}
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={detailLoading}
              className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
            >
              <RefreshCw size={14} className={detailLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        {error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {detailLoading && !detail ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-500">
            Loading candidate…
          </div>
        ) : detail ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <KpiCard label="Pitch price" value={fmtInr(Number(detail.pitch_price || 0))} />
              <KpiCard
                label="Collected"
                value={fmtInr(Number(detail.total_paid || 0))}
                accent="green"
              />
              <KpiCard
                label="Remaining"
                value={fmtInr(Number(detail.remaining || 0))}
                accent="amber"
              />
              <KpiCard
                label="Installments"
                value={String(detail.installment_count ?? 0)}
              />
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900">{detail.customer_name}</p>
                  <p className="text-xs text-gray-500">
                    {[detail.customer_email, detail.customer_phone]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {statusBadge(String(detail.status || ""))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                      <th className="px-4 py-3 font-semibold">#</th>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Source</th>
                      <th className="px-4 py-3 font-semibold">Mode</th>
                      <th className="px-4 py-3 font-semibold text-right">Amount</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(detail.installments ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                          No payments recorded yet
                        </td>
                      </tr>
                    ) : (
                      (detail.installments ?? []).map((inst, idx) => (
                        <tr key={`${inst.source}-${inst.id}-${idx}`} className="hover:bg-gray-50/80">
                          <td className="px-4 py-3 tabular-nums text-gray-600">
                            {inst.installment_number ?? idx + 1}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                            {(inst.paid_at || inst.created_at || "").slice(0, 10) || "—"}
                          </td>
                          <td className="px-4 py-3 capitalize text-gray-700">
                            {inst.source === "payment_link" ? "Payment link" : "Manual"}
                          </td>
                          <td className="px-4 py-3 text-gray-600 capitalize">
                            {inst.payment_method?.replace(/_/g, " ") || "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums text-[#22c55e]">
                            {fmtInr(Number(inst.amount || 0))}
                          </td>
                          <td className="px-4 py-3 capitalize text-gray-600">
                            {inst.status || "paid"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {canUpdate ? (
              <ManualPaymentDialog
                open={updateOpen}
                onOpenChange={setUpdateOpen}
                onSubmitted={() => void handleRefresh()}
                presetCandidate={{
                  id: detail.id,
                  customer_name: detail.customer_name,
                  customer_email: detail.customer_email,
                  customer_phone: detail.customer_phone,
                  pitch_price: Number(detail.pitch_price || 0),
                  total_paid: Number(detail.total_paid || 0),
                  remaining: Number(detail.remaining || 0),
                  next_installment: (detail.installment_count ?? 0) + 1,
                }}
              />
            ) : null}

            <Dialog open={pitchEditOpen} onOpenChange={setPitchEditOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Edit pitch price</DialogTitle>
                </DialogHeader>
                <div className="space-y-2 py-2">
                  <Label htmlFor="edit-pitch-amount">Pitch price (₹)</Label>
                  <Input
                    id="edit-pitch-amount"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="e.g. 50000"
                    value={pitchDraft}
                    onChange={(e) => setPitchDraft(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Set the total target for {detail.customer_name}. Use 0 if not decided yet.
                  </p>
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPitchEditOpen(false)}
                    disabled={pitchSaving}
                  >
                    Cancel
                  </Button>
                  <Button type="button" onClick={() => void handleSavePitch()} disabled={pitchSaving}>
                    {pitchSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save pitch"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          {onBack ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1"
              onClick={onBack}
            >
              <ArrowLeft size={16} />
              Back
            </Button>
          ) : null}
          <h2 className="text-base font-semibold text-gray-900">{headerTitle}</h2>
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {kpi ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          <KpiCard label="Candidates" value={String(kpi.candidate_count)} />
          <KpiCard label="Total pitch" value={fmtInr(kpi.total_pitch)} />
          <KpiCard label={collectedLabel} value={fmtInr(kpi.total_paid)} accent="green" />
          <KpiCard label="Remaining" value={fmtInr(kpi.total_remaining)} accent="amber" />
          <KpiCard label="Cleared" value={String(kpi.cleared_count)} />
        </div>
      ) : null}

      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search candidate name, email, or phone…"
            className={inputCls + " flex-1"}
          />
          <Select
            value={period}
            onValueChange={(v) => {
              setPeriod(v as PaymentLinkPeriod);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-[11rem] shrink-0">
              <SelectValue placeholder="Timeline" />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_LINK_PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {period === "custom" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                setPage(1);
              }}
              className={inputCls}
              title="From date"
            />
            <input
              type="date"
              value={customTo}
              onChange={(e) => {
                setCustomTo(e.target.value);
                setPage(1);
              }}
              className={inputCls}
              title="To date"
            />
          </div>
        ) : null}
        {period !== "all" ? (
          <p className="text-xs text-gray-500">
            Payments counted by paid-on date, then upload date. Pitch and status use all-time totals.
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">
          {error}
          <button
            type="button"
            onClick={() => void loadList()}
            className="ml-3 underline font-medium"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3 font-semibold">Candidate</th>
                {showOwnerColumn ? (
                  <th className="px-4 py-3 font-semibold">Rep</th>
                ) : null}
                <th className="px-4 py-3 font-semibold text-right">Pitch</th>
                <th className="px-4 py-3 font-semibold text-right">Collected</th>
                <th className="px-4 py-3 font-semibold text-right">Remaining</th>
                <th className="px-4 py-3 font-semibold text-right">Installments</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={showOwnerColumn ? 7 : 6}
                    className="px-4 py-12 text-center text-gray-500"
                  >
                    Loading candidates…
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={showOwnerColumn ? 7 : 6}
                    className="px-4 py-14 text-center"
                  >
                    <p className="font-semibold text-gray-900">No candidates yet</p>
                    <p className="text-sm text-gray-500 mt-1">
                      Payment links and manual payments for the same customer will appear here.
                    </p>
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-[#f0fdf4]/60 cursor-pointer"
                    onClick={() => void loadDetail(row.id)}
                  >
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
                    {showOwnerColumn ? (
                      <td className="px-4 py-3 text-gray-700">{row.owner_name || "—"}</td>
                    ) : null}
                    <td className="px-4 py-3 text-right">
                      {fmtPitchCell(Number(row.pitch_price || 0))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#22c55e] font-medium">
                      {fmtInr(Number(row.total_paid || 0))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-amber-700">
                      {fmtInr(Number(row.remaining || 0))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.installment_count ?? 0}
                    </td>
                    <td className="px-4 py-3">{statusBadge(String(row.status || ""))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-gray-600">
          <p>
            {total === 0
              ? "0 candidates"
              : `${pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, total)} of ${total}`}
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

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "amber";
}) {
  const valueCls =
    accent === "green"
      ? "text-[#22c55e]"
      : accent === "amber"
        ? "text-amber-700"
        : "text-gray-900";
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">{label}</p>
      <p className={`text-xl font-bold mt-1 tabular-nums ${valueCls}`}>{value}</p>
    </div>
  );
}
