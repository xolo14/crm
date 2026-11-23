import { useEffect, useMemo, useState } from "react";
import { Check, Eye, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ProtectedUploadImage } from "@/components/ProtectedUploadImage";
import { resolveUploadSrc } from "@/lib/resumeHref";
import type { ManualPaymentRow } from "@/utils/normalizePaymentLink";
import { confirmAction, promptAction } from "@/components/ConfirmDialogHost";

interface Props {
  rows: ManualPaymentRow[];
  loading: boolean;
  canDeleteApproved?: boolean;
  onChanged: () => void;
}

function fmtInr(rupees: number): string {
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function isImageProof(path: string): boolean {
  return /\.(jpe?g|png|gif|webp|bmp)$/i.test(path);
}

function ProofPreviewDialog({
  path,
  open,
  onOpenChange,
}: {
  path: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [blobUrl, setBlobUrl] = useState("");
  const [loadingBlob, setLoadingBlob] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const image = Boolean(path && isImageProof(path));

  useEffect(() => {
    if (!open || !path || image) {
      setBlobUrl("");
      setError(null);
      setLoadingBlob(false);
      return;
    }

    let cancelled = false;
    let created: string | null = null;
    setLoadingBlob(true);
    setError(null);

    void (async () => {
      try {
        const src = resolveUploadSrc(path);
        const res = await fetch(src, { credentials: "include" });
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const blob = await res.blob();
        created = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(created);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load proof");
        }
      } finally {
        if (!cancelled) setLoadingBlob(false);
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [open, path, image]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-[min(92vw,56rem)] max-h-[min(92dvh,100%)] overflow-hidden p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>Payment proof</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-[12rem] max-h-[min(75dvh,40rem)] items-center justify-center overflow-auto rounded-lg bg-muted/40 p-2">
          {!path ? null : image ? (
            <ProtectedUploadImage
              path={path}
              alt="Payment proof"
              className="max-h-[min(72dvh,38rem)] max-w-full object-contain"
            />
          ) : loadingBlob ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading proof…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : blobUrl ? (
            <iframe
              title="Payment proof"
              src={blobUrl}
              className="h-[min(72dvh,38rem)] w-full rounded border border-border bg-white"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Shruti Verma · ₹8,000" for confirmation titles. */
function paymentLabel(row: { customer_name?: string | null; amount?: number | string | null }): string {
  return `${row.customer_name || "this payment"} · ₹${Number(row.amount || 0).toLocaleString("en-IN")}`;
}

export default function ManualPaymentApprovalsTab({
  rows,
  loading,
  canDeleteApproved = false,
  onChanged,
}: Props) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Approvals is a work queue: show what still needs a decision first, a page at a time.
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  useEffect(() => {
    setPage(1);
  }, [statusFilter]);
  const shownRows = useMemo(() => {
    const order: Record<string, number> = { pending: 0, rejected: 1, approved: 2 };
    return rows
      .filter((r) => statusFilter === "all" || r.status === statusFilter)
      .slice()
      .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
  }, [rows, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(shownRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = shownRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  async function review(id: string, action: "approve" | "reject", label = "this payment") {
    // Money decisions are confirmed first; a rejection can carry a reason for the submitter.
    let reason = "";
    if (action === "approve") {
      const ok = await confirmAction({ title: `Approve ${label}?`, description: "It will count as collected in Payment Records.", confirmLabel: "Approve" });
      if (!ok) return;
    } else {
      const r = await promptAction({ title: `Reject ${label}?`, inputLabel: "Reason (shown to the person who submitted it)", placeholder: "e.g. Proof does not match the amount", confirmLabel: "Reject", destructive: true });
      if (r === null) return;
      reason = r;
    }
    setBusyId(id);
    try {
      if (action === "approve") {
        await api.manualPayments.approve(id);
        toast({ title: "Payment approved" });
      } else {
        await api.manualPayments.reject(id, reason);
        toast({ title: "Payment rejected" });
      }
      onChanged();
    } catch (err) {
      toast({
        variant: "destructive",
        title: action === "approve" ? "Approve failed" : "Reject failed",
        description: err instanceof Error ? err.message : "Try again",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function removeApproved(id: string, label = "this payment") {
    const ok = await confirmAction({
      title: `Delete the approved payment for ${label}?`,
      description: "It will no longer count as collected. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(id);
    try {
      await api.manualPayments.delete(id);
      toast({ title: "Approved payment deleted" });
      onChanged();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Try again",
      });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading approvals…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 px-6 py-14 text-center">
        <p className="font-semibold text-gray-900">No manual payment records</p>
        <p className="text-sm text-gray-500 mt-1">
          Pending, approved, and rejected records will appear here.
        </p>
      </div>
    );
  }

  const filterChips: Array<[typeof statusFilter, string]> = [
    ["pending", `Pending (${pendingCount})`],
    ["approved", "Approved"],
    ["rejected", "Rejected"],
    ["all", `All (${rows.length})`],
  ];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
        {filterChips.map(([key, text]) => (
          <button
            key={key}
            type="button"
            aria-pressed={statusFilter === key}
            onClick={() => setStatusFilter(key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${statusFilter === key ? "border-primary bg-primary text-primary-foreground" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            {text}
          </button>
        ))}
      </div>
      {shownRows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-10 text-center text-sm text-gray-500">
          {statusFilter === "pending" ? "Nothing waiting for approval." : "No payments with this status."}
        </div>
      ) : (
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[880px]">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3 font-semibold">Submitted by</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold text-right">Amount</th>
                <th className="px-4 py-3 font-semibold">Method</th>
                <th className="px-4 py-3 font-semibold">Paid on</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Proof</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRows.map((row) => {
                const busy = busyId === row.id;
                const amt = Number(row.amount || 0);
                return (
                  <tr key={row.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">
                        {row.submitted_by_name || "Unknown"}
                      </p>
                      {row.submitted_by_email ? (
                        <p className="text-[11px] text-gray-500">
                          {row.submitted_by_email}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {row.customer_name || "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#22c55e]">
                      {fmtInr(amt)}
                    </td>
                    <td className="px-4 py-3 capitalize text-gray-700">
                      {(row.payment_method || "—").replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {row.paid_at
                        ? new Date(row.paid_at).toLocaleDateString("en-IN")
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          row.status === "approved"
                            ? "bg-emerald-100 text-emerald-800"
                            : row.status === "rejected"
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {(row.status || "pending").toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.proof_path ? (
                        <div className="flex items-center gap-2">
                          {isImageProof(row.proof_path) ? (
                            <button
                              type="button"
                              className="shrink-0 rounded border border-gray-200 overflow-hidden"
                              title="View proof"
                              onClick={() => setPreviewPath(row.proof_path)}
                            >
                              <ProtectedUploadImage
                                path={row.proof_path}
                                alt="Proof"
                                className="h-10 w-10 object-cover"
                              />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                            onClick={() => setPreviewPath(row.proof_path)}
                          >
                            <Eye size={14} />
                            View
                          </button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {row.status === "pending" && row.can_review === false ? (
                          <span className="text-xs text-muted-foreground" title="Payments submitted by a manager are approved by an admin">
                            Needs admin
                          </span>
                        ) : null}
                        {row.status === "pending" && row.can_review !== false ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              className="h-8 text-red-700 border-red-200 hover:bg-red-50"
                              onClick={() => void review(row.id, "reject", paymentLabel(row))}
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <>
                                  <X className="h-3.5 w-3.5 mr-1" />
                                  Reject
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              disabled={busy}
                              className="h-8 bg-primary hover:bg-brand-700 text-primary-foreground"
                              onClick={() => void review(row.id, "approve", paymentLabel(row))}
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <>
                                  <Check className="h-3.5 w-3.5 mr-1" />
                                  Approve
                                </>
                              )}
                            </Button>
                          </>
                        ) : null}
                        {row.status === "approved" && canDeleteApproved ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            className="h-8 text-red-700 border-red-200 hover:bg-red-50"
                            onClick={() => void removeApproved(row.id, paymentLabel(row))}
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <>
                                <Trash2 className="h-3.5 w-3.5 mr-1" />
                                Delete
                              </>
                            )}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pageCount > 1 ? (
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-2.5 text-xs text-gray-500">
            <span>
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, shownRows.length)} of {shownRows.length}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                ← Prev
              </Button>
              <span className="tabular-nums">{safePage} / {pageCount}</span>
              <Button size="sm" variant="outline" className="h-8" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
                Next →
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      )}

      <ProofPreviewDialog
        path={previewPath}
        open={Boolean(previewPath)}
        onOpenChange={(open) => {
          if (!open) setPreviewPath(null);
        }}
      />
    </>
  );
}
