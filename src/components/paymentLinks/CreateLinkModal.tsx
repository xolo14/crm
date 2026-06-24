import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import {
  batchScheduleStatus,
  batchStatusLabel,
  isOpenBatchSchedule,
} from "@/utils/batchSchedule";
import type { CreatePaymentLinkForm } from "@/types/paymentLinks";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (form: CreatePaymentLinkForm) => Promise<void>;
}

interface BatchOption {
  id: string;
  name: string;
  course_name?: string;
  course_price?: number | string;
  start_date?: string;
  end_date?: string;
  status: string;
}

interface LeadOption {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

const EXPIRY_OPTIONS = [
  { label: "No expiry", value: 0 },
  { label: "1 day", value: 1 },
  { label: "3 days", value: 3 },
  { label: "7 days", value: 7 },
  { label: "15 days", value: 15 },
  { label: "30 days", value: 30 },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function freshForm(referralCode: string): CreatePaymentLinkForm {
  return {
    batchId: "",
    leadId: "",
    amount: 0,
    description: "",
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    referenceId: `SYNC-${Date.now()}`,
    expireInDays: 0,
    notes: "",
    referralCode,
  };
}

export default function CreateLinkModal({ open, onClose, onCreate }: Props) {
  const { profile } = useAuth();
  const memberReferral = profile?.referral_code?.trim() ?? "";

  const [form, setForm] = useState<CreatePaymentLinkForm>(() =>
    freshForm(memberReferral),
  );
  const [errors, setErrors] = useState<
    Partial<Record<keyof CreatePaymentLinkForm, string>>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(freshForm(memberReferral));
    setErrors({});
    setServerError(null);
    setSubmitting(false);

    let cancelled = false;
    const load = async () => {
      setLoadingOptions(true);
      try {
        const [batchRes, leadRes] = await Promise.all([
          api.batches.list(),
          api.leads.list(),
        ]);
        if (cancelled) return;

        const batchList = (
          Array.isArray(batchRes)
            ? batchRes
            : batchRes.data || batchRes.batches || []
        ) as BatchOption[];

        const openBatches = batchList
          .filter((b) => isOpenBatchSchedule(b.start_date, b.end_date))
          .map((b) => ({
            ...b,
            id: String(b.id),
            status: batchScheduleStatus(b.start_date, b.end_date),
          }))
          .sort((a, b) => {
            if (a.status === "active" && b.status !== "active") return -1;
            if (b.status === "active" && a.status !== "active") return 1;
            return (a.name || "").localeCompare(b.name || "");
          });

        const leadList = (
          Array.isArray(leadRes) ? leadRes : leadRes.data || leadRes.leads || []
        ) as LeadOption[];

        setBatches(openBatches);
        setLeads(
          leadList
            .map((l) => ({
              id: String(l.id),
              name: l.name || "Unnamed lead",
              email: l.email || "",
              phone: l.phone || "",
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch {
        if (!cancelled) {
          setServerError("Could not load batches or leads. Try again.");
        }
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, memberReferral]);

  const previewLine = useMemo(() => {
    const parts: string[] = [];
    if (form.amount > 0)
      parts.push(`₹${form.amount.toLocaleString("en-IN")}`);
    if (form.customerName) parts.push(form.customerName);
    if (form.customerEmail) parts.push(form.customerEmail);
    return parts.join(" · ");
  }, [form.amount, form.customerName, form.customerEmail]);

  const previewSub = useMemo(() => {
    const expiry =
      form.expireInDays > 0
        ? `${form.expireInDays} day${form.expireInDays > 1 ? "s" : ""}`
        : "No expiry";
    const ref = form.referralCode || "—";
    return `Ref: ${form.referenceId || "—"} · Referral: ${ref} · Expires: ${expiry}`;
  }, [form.referenceId, form.expireInDays, form.referralCode]);

  function set<K extends keyof CreatePaymentLinkForm>(
    key: K,
    value: CreatePaymentLinkForm[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function handleBatchChange(batchId: string) {
    const batch = batches.find((b) => b.id === batchId);
    const price = Number(batch?.course_price ?? 0);
    const label = batch
      ? `${batch.name}${batch.course_name ? ` — ${batch.course_name}` : ""}`
      : "";

    setForm((prev) => ({
      ...prev,
      batchId,
      amount: price > 0 ? price : 0,
      description: label,
      referenceId: batch
        ? `BATCH-${batch.id}-${Date.now()}`
        : prev.referenceId,
    }));
    setErrors((prev) => ({
      ...prev,
      batchId: undefined,
      amount: undefined,
      description: undefined,
    }));
  }

  function handleLeadChange(leadId: string) {
    const lead = leads.find((l) => l.id === leadId);
    setForm((prev) => ({
      ...prev,
      leadId,
      customerName: lead?.name ?? "",
      customerEmail: lead?.email ?? "",
      customerPhone: lead?.phone ?? "",
    }));
    setErrors((prev) => ({
      ...prev,
      leadId: undefined,
      customerName: undefined,
      customerEmail: undefined,
    }));
  }

  function validate(): boolean {
    const next: Partial<Record<keyof CreatePaymentLinkForm, string>> = {};
    if (!form.batchId) next.batchId = "Select a batch";
    if (!(form.amount > 0)) next.amount = "Batch has no course fee set";
    if (!form.description.trim()) next.description = "Select a batch";
    if (!form.leadId) next.leadId = "Select a lead";
    if (!form.customerName.trim()) next.customerName = "Select a lead";
    if (!EMAIL_RE.test(form.customerEmail.trim()))
      next.customerEmail = "Lead must have a valid email";
    if (!form.referralCode.trim())
      next.referralCode = "Your profile has no referral code";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!validate()) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await onCreate({
        ...form,
        description: form.description.trim(),
        customerName: form.customerName.trim(),
        customerEmail: form.customerEmail.trim(),
        customerPhone: form.customerPhone.trim(),
        referenceId: form.referenceId.trim() || `SYNC-${Date.now()}`,
        notes: form.notes.trim(),
        referralCode: form.referralCode.trim(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Create failed";
      setServerError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const inputCls =
    "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2ed573] focus:ring-offset-1 disabled:bg-gray-50 disabled:text-gray-500";
  const labelCls = "text-xs font-semibold text-gray-700";
  const errCls = "text-[11px] text-red-600 mt-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between px-6 pt-6 pb-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Create Payment Link
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Select a batch and lead — amount and customer details fill
              automatically
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <form className="px-6 pb-6 space-y-4" onSubmit={handleSubmit}>
          {loadingOptions && (
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              <Loader2 size={14} className="animate-spin" />
              Loading batches and leads…
            </div>
          )}

          <div>
            <label className={labelCls} htmlFor="batchId">
              Batch <span className="text-red-500">*</span>
            </label>
            <select
              id="batchId"
              value={form.batchId}
              onChange={(e) => handleBatchChange(e.target.value)}
              disabled={loadingOptions}
              className={`${inputCls} mt-1`}
            >
              <option value="">Select upcoming or active batch…</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.course_name ? ` — ${b.course_name}` : ""} (
                  {batchStatusLabel(b.status)})
                  {b.course_price
                    ? ` · ₹${Number(b.course_price).toLocaleString("en-IN")}`
                    : ""}
                </option>
              ))}
            </select>
            {errors.batchId && <p className={errCls}>{errors.batchId}</p>}
            {batches.length === 0 && !loadingOptions && (
              <p className="text-[11px] text-amber-600 mt-1">
                No upcoming or active batches found.
              </p>
            )}
          </div>

          <div>
            <label className={labelCls} htmlFor="amount">
              Amount (₹) <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                ₹
              </span>
              <input
                id="amount"
                type="number"
                readOnly
                value={form.amount || ""}
                placeholder="Select a batch"
                className={`${inputCls} pl-7 bg-gray-50`}
              />
            </div>
            {errors.amount && <p className={errCls}>{errors.amount}</p>}
            <p className="text-[11px] text-gray-400 mt-1">
              From course fee linked to the selected batch
            </p>
          </div>

          <div>
            <label className={labelCls} htmlFor="description">
              Description <span className="text-red-500">*</span>
            </label>
            <input
              id="description"
              type="text"
              readOnly
              value={form.description}
              placeholder="Auto-filled from batch"
              className={`${inputCls} mt-1 bg-gray-50`}
            />
            {errors.description && (
              <p className={errCls}>{errors.description}</p>
            )}
          </div>

          <div className="pt-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Customer Details
            </p>
            <div className="space-y-3">
              <div>
                <label className={labelCls} htmlFor="leadId">
                  Lead <span className="text-red-500">*</span>
                </label>
                <select
                  id="leadId"
                  value={form.leadId}
                  onChange={(e) => handleLeadChange(e.target.value)}
                  disabled={loadingOptions}
                  className={`${inputCls} mt-1`}
                >
                  <option value="">Select lead…</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.email ? ` · ${l.email}` : ""}
                    </option>
                  ))}
                </select>
                {errors.leadId && <p className={errCls}>{errors.leadId}</p>}
              </div>

              <div>
                <label className={labelCls} htmlFor="customerName">
                  Full Name
                </label>
                <input
                  id="customerName"
                  type="text"
                  readOnly
                  value={form.customerName}
                  className={`${inputCls} mt-1 bg-gray-50`}
                />
                {errors.customerName && (
                  <p className={errCls}>{errors.customerName}</p>
                )}
              </div>
              <div>
                <label className={labelCls} htmlFor="customerEmail">
                  Email
                </label>
                <input
                  id="customerEmail"
                  type="email"
                  readOnly
                  value={form.customerEmail}
                  className={`${inputCls} mt-1 bg-gray-50`}
                />
                {errors.customerEmail && (
                  <p className={errCls}>{errors.customerEmail}</p>
                )}
              </div>
              <div>
                <label className={labelCls} htmlFor="customerPhone">
                  Phone
                </label>
                <input
                  id="customerPhone"
                  type="tel"
                  readOnly
                  value={form.customerPhone}
                  placeholder="From selected lead"
                  className={`${inputCls} mt-1 bg-gray-50`}
                />
              </div>
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="referralCode">
              Referral Code
            </label>
            <input
              id="referralCode"
              type="text"
              readOnly
              value={form.referralCode || "—"}
              className={`${inputCls} mt-1 bg-gray-50 font-mono`}
            />
            {errors.referralCode && (
              <p className={errCls}>{errors.referralCode}</p>
            )}
            <p className="text-[11px] text-gray-400 mt-1">
              From your member profile — attached to the Razorpay link
            </p>
          </div>

          <div>
            <label className={labelCls} htmlFor="referenceId">
              Reference ID
            </label>
            <input
              id="referenceId"
              type="text"
              value={form.referenceId}
              onChange={(e) => set("referenceId", e.target.value)}
              className={`${inputCls} mt-1`}
            />
          </div>

          <div>
            <label className={labelCls} htmlFor="expireInDays">
              Expires In
            </label>
            <select
              id="expireInDays"
              value={form.expireInDays}
              onChange={(e) => set("expireInDays", Number(e.target.value))}
              className={`${inputCls} mt-1`}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls} htmlFor="notes">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Internal note about this payment"
              className={`${inputCls} mt-1 resize-none`}
            />
          </div>

          <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
              Live Preview
            </p>
            <p className="text-sm text-gray-800 font-medium mt-1 truncate">
              {previewLine || "Select batch and lead to preview"}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">{previewSub}</p>
          </div>

          {serverError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {serverError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || loadingOptions}
              className="px-5 py-2.5 rounded-xl bg-[#2ed573] text-[#0f2318] text-sm font-semibold hover:bg-[#22c265] transition-colors shadow-sm flex items-center gap-2 disabled:opacity-60"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? "Creating..." : "Create & Copy Link"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
