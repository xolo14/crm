import { useState } from "react";
import { Check, Eye, Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { openProtectedUpload, resolveUploadSrc } from "@/lib/resumeHref";
import type { ManualPaymentRow } from "@/utils/normalizePaymentLink";

interface Props {
  rows: ManualPaymentRow[];
  loading: boolean;
  canDeleteApproved?: boolean;
  onChanged: () => void;
}

function fmtInr(rupees: number): string {
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function ManualPaymentApprovalsTab({
  rows,
  loading,
  canDeleteApproved = false,
  onChanged,
}: Props) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function review(id: string, action: "approve" | "reject") {
    setBusyId(id);
    try {
      if (action === "approve") {
        await api.manualPayments.approve(id);
        toast({ title: "Payment approved" });
      } else {
        await api.manualPayments.reject(id);
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

  async function removeApproved(id: string) {
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

  return (
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
            {rows.map((row) => {
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
                        {/\.(jpe?g|png|gif|webp|bmp)$/i.test(row.proof_path) ? (
                          <img
                            src={resolveUploadSrc(row.proof_path)}
                            alt="Proof"
                            className="h-10 w-10 rounded object-cover border border-gray-200"
                          />
                        ) : null}
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                          onClick={() =>
                            void openProtectedUpload(row.proof_path).catch(
                              (err) =>
                                toast({
                                  variant: "destructive",
                                  title: "Could not open proof",
                                  description:
                                    err instanceof Error
                                      ? err.message
                                      : "Try again",
                                }),
                            )
                          }
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
                      {row.status === "pending" ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            className="h-8 text-red-700 border-red-200 hover:bg-red-50"
                            onClick={() => void review(row.id, "reject")}
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
                            className="h-8 bg-[#2ed573] hover:bg-[#25c066] text-[#0f2318]"
                            onClick={() => void review(row.id, "approve")}
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
                          onClick={() => void removeApproved(row.id)}
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
    </div>
  );
}
