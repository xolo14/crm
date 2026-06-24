import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  ChevronDown,
  Loader2,
  Mail,
  Plus,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { useCreatePaymentLink } from "@/hooks/useCreatePaymentLink";
import type { RazorpayPaymentLink } from "@/types/paymentLinks";
import {
  EMPTY_STANDARD_FORM,
  type StandardPaymentLinkFormState,
} from "@/types/standardPaymentLink";
import {
  batchScheduleStatus,
  batchStatusLabel,
  isOpenBatchSchedule,
} from "@/utils/batchSchedule";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (link: RazorpayPaymentLink) => void;
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NOTES = 15;
const RAZORPAY_REMINDER_URL =
  "https://dashboard.razorpay.com/app/payment-links";

function formatDdMmYyyy(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function splitLeadPhone(raw?: string): { countryCode: string; phone: string } {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) {
    return { countryCode: "+91", phone: digits.slice(2) };
  }
  if (digits.length === 10) {
    return { countryCode: "+91", phone: digits };
  }
  if (digits.length > 10) {
    return { countryCode: "+91", phone: digits.slice(-10) };
  }
  return { countryCode: "+91", phone: digits };
}

function freshForm(referralCode: string): StandardPaymentLinkFormState {
  return { ...EMPTY_STANDARD_FORM, referralCode };
}

function validateForm(form: StandardPaymentLinkFormState): Record<string, string> {
  const e: Record<string, string> = {};
  const amount = Number(form.amount);

  if (!form.amount || !Number.isFinite(amount) || amount < 1) {
    e.amount = "Enter an amount of at least ₹1";
  }
  if (!form.full_name.trim()) {
    e.full_name = "Enter full name or select a lead";
  }
  if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) {
    e.email = "Enter a valid email address";
  }
  const digits = form.phone.replace(/\D/g, "");
  if (digits && digits.length !== 10) {
    e.phone = "Enter a valid 10-digit phone number";
  }
  if (!form.referralCode.trim()) {
    e.referralCode = "Referral code is required";
  }
  if (!form.noExpiry) {
    if (!form.expiryDate) {
      e.expiryDate = "Select an expiry date or check No Expiry";
    } else {
      const end = new Date(`${form.expiryDate}T23:59:59`);
      if (end.getTime() <= Date.now()) {
        e.expiryDate = "Expiry date must be in the future";
      }
    }
  }
  if (form.partialEnabled) {
    const min = Number(form.minPartialAmount);
    if (!form.minPartialAmount || !Number.isFinite(min) || min < 1) {
      e.minPartialAmount = "Enter minimum first payment (at least ₹1)";
    } else if (Number.isFinite(amount) && min >= amount) {
      e.minPartialAmount = "Must be less than the total amount";
    }
  }
  return e;
}

export default function CreatePaymentLinkModal({
  open,
  onClose,
  onSuccess,
}: Props) {
  const { profile } = useAuth();
  const memberReferral = profile?.referral_code?.trim() ?? "";
  const { createLink, loading } = useCreatePaymentLink();
  const [form, setForm] = useState<StandardPaymentLinkFormState>(
    EMPTY_STANDARD_FORM,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [leadPickerOpen, setLeadPickerOpen] = useState(false);
  const leadPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setForm(freshForm(memberReferral));
    setErrors({});
    setSubmitError(null);
    setOptionsError(null);
    setLeadPickerOpen(false);

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
          setOptionsError("Could not load batches or leads. Try again.");
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

  useEffect(() => {
    if (!leadPickerOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (
        leadPickerRef.current &&
        !leadPickerRef.current.contains(e.target as Node)
      ) {
        setLeadPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [leadPickerOpen]);

  const filteredLeads = useMemo(() => {
    const q = form.full_name.trim().toLowerCase();
    const list = !q
      ? leads
      : leads.filter(
          (l) =>
            l.name.toLowerCase().includes(q) ||
            (l.email || "").toLowerCase().includes(q) ||
            (l.phone || "").replace(/\D/g, "").includes(q.replace(/\D/g, "")),
        );
    return list.slice(0, 40);
  }, [leads, form.full_name]);

  const selectedLead = useMemo(
    () => (form.leadId ? leads.find((l) => l.id === form.leadId) : undefined),
    [leads, form.leadId],
  );

  const canSubmit = useMemo(() => {
    return (
      form.full_name.trim() !== "" &&
      form.amount.trim() !== "" &&
      Number(form.amount) >= 1 &&
      form.referralCode.trim() !== ""
    );
  }, [form.full_name, form.amount, form.referralCode]);

  const partialInfo = useMemo(() => {
    const total = Number(form.amount) || 0;
    const min = Number(form.minPartialAmount) || 0;
    if (!form.partialEnabled || total <= 0 || min <= 0) return null;
    const remaining = Math.max(0, total - min);
    return { min, remaining };
  }, [form.partialEnabled, form.amount, form.minPartialAmount]);

  function patch(partial: Partial<StandardPaymentLinkFormState>) {
    setForm((prev) => ({ ...prev, ...partial }));
    setErrors({});
  }

  function handleBatchChange(batchId: string) {
    if (!batchId) {
      patch({ batchId: "" });
      return;
    }
    const batch = batches.find((b) => b.id === batchId);
    const price = Number(batch?.course_price ?? 0);
    const label = batch
      ? `${batch.name}${batch.course_name ? ` — ${batch.course_name}` : ""}`
      : "";

    patch({
      batchId,
      amount: price > 0 ? String(price) : "",
      description: label,
      referenceId: batch
        ? `BATCH-${batch.id}-${Date.now()}`
        : form.referenceId,
    });
  }

  function handleFullNameChange(value: string) {
    const keepLead =
      selectedLead &&
      value.trim().toLowerCase() === selectedLead.name.trim().toLowerCase();
    patch({
      full_name: value,
      leadId: keepLead ? form.leadId : "",
    });
    setLeadPickerOpen(true);
  }

  function selectLead(lead: LeadOption) {
    const { countryCode, phone } = splitLeadPhone(lead.phone);
    patch({
      leadId: lead.id,
      full_name: lead.name,
      email: lead.email ?? "",
      countryCode,
      phone,
      notifyEmail: !!(lead.email?.trim()),
      notifySms: phone.length === 10,
    });
    setLeadPickerOpen(false);
  }

  function addNote() {
    if (form.notes.length >= MAX_NOTES) return;
    patch({ notes: [...form.notes, { key: "", value: "" }] });
  }

  function updateNote(index: number, field: "key" | "value", value: string) {
    const next = form.notes.map((n, i) =>
      i === index ? { ...n, [field]: value } : n,
    );
    patch({ notes: next });
  }

  function removeNote(index: number) {
    patch({ notes: form.notes.filter((_, i) => i !== index) });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateForm(form);
    if (Object.keys(v).length > 0) {
      setErrors(v);
      return;
    }
    setSubmitError(null);
    try {
      const link = await createLink(form);
      onSuccess(link);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Create failed");
    }
  }

  if (!open) return null;

  const inputCls =
    "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-[#0f2318] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2ed573]/40 focus:border-[#2ed573] disabled:opacity-60";
  const selectCls = `${inputCls} mt-1.5 cursor-pointer`;
  const readonlyCls =
    "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 focus:outline-none";
  const hintCls = "text-[11px] text-gray-500 mt-1";
  const labelCls = "text-sm font-semibold text-[#0f2318]";
  const sectionTitleCls = "text-sm font-bold text-[#0f2318]";
  const errCls = "text-xs text-red-600 mt-1";
  const checkCls =
    "h-4 w-4 rounded border-gray-300 text-[#2ed573] focus:ring-[#2ed573]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2318]/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[92vh] flex flex-col border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0 bg-[#0f2318] rounded-t-2xl">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Standard Payment Link
            </h2>
            <p className="text-xs text-white/70 mt-0.5">
              Select batch — type full name or pick a lead from the list
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/10"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <form
          id="standard-pl-form"
          onSubmit={handleSubmit}
          className="overflow-y-auto flex-1 px-5 py-4 space-y-5 bg-[#f9fafb]"
        >
          {loadingOptions && (
            <div className="flex items-center gap-2 text-xs text-gray-600 bg-white border border-gray-100 rounded-xl px-3 py-2">
              <Loader2 size={14} className="animate-spin text-[#2ed573]" />
              Loading batches and leads…
            </div>
          )}
          {optionsError && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
              {optionsError}
            </div>
          )}

          {/* Batch quick-fill */}
          <div>
            <label className={labelCls} htmlFor="pl-batch">
              Batch
            </label>
            <select
              id="pl-batch"
              value={form.batchId}
              onChange={(e) => handleBatchChange(e.target.value)}
              disabled={loadingOptions}
              className={selectCls}
            >
              <option value="">Select batch to auto-fill (optional)…</option>
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
            {batches.length === 0 && !loadingOptions && (
              <p className="text-[11px] text-amber-600 mt-1">
                No upcoming or active batches found — enter details manually below.
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className={labelCls} htmlFor="pl-desc">
              Description
            </label>
            <input
              id="pl-desc"
              type="text"
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Payment for..."
              className={`${inputCls} mt-1.5`}
            />
            <p className={hintCls}>Auto-filled when you select a batch — editable</p>
          </div>

          {/* Amount */}
          <div>
            <label className={labelCls} htmlFor="pl-amount">
              Amount (₹)
            </label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                ₹
              </span>
              <input
                id="pl-amount"
                type="number"
                min={1}
                step={0.01}
                required
                value={form.amount}
                onChange={(e) => patch({ amount: e.target.value })}
                placeholder="0"
                className={`${inputCls} pl-8`}
              />
            </div>
            {errors.amount && <p className={errCls}>{errors.amount}</p>}
            <p className={hintCls}>Auto-filled from batch course fee — editable</p>
          </div>

          {/* Full name — type manually or search & pick a lead in one field */}
          <div ref={leadPickerRef}>
            <label className={labelCls} htmlFor="pl-full_name">
              Full name
            </label>
            <div className="relative mt-1.5">
              <input
                id="pl-full_name"
                type="text"
                required
                autoComplete="name"
                role="combobox"
                aria-expanded={leadPickerOpen}
                aria-autocomplete="list"
                aria-controls="pl-lead-listbox"
                disabled={loadingOptions}
                value={form.full_name}
                onChange={(e) => handleFullNameChange(e.target.value)}
                onFocus={() => setLeadPickerOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setLeadPickerOpen(false);
                }}
                placeholder="Type name or search leads…"
                className={`${inputCls} pr-9`}
              />
              <button
                type="button"
                tabIndex={-1}
                aria-label="Show leads"
                disabled={loadingOptions || leads.length === 0}
                onClick={() => setLeadPickerOpen((o) => !o)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-gray-600 disabled:opacity-30"
              >
                <ChevronDown
                  size={18}
                  className={leadPickerOpen ? "rotate-180 transition-transform" : ""}
                />
              </button>

              {leadPickerOpen && leads.length > 0 && (
                <ul
                  id="pl-lead-listbox"
                  role="listbox"
                  className="absolute z-20 left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg py-1"
                >
                  {filteredLeads.length === 0 ? (
                    <li className="px-3 py-2 text-xs text-gray-500">
                      No leads match — name will be used as entered
                    </li>
                  ) : (
                    filteredLeads.map((l) => (
                      <li key={l.id} role="option" aria-selected={form.leadId === l.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectLead(l)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-[#e6faf0] ${
                            form.leadId === l.id ? "bg-[#e6faf0]/80" : ""
                          }`}
                        >
                          <span className="font-medium text-[#0f2318] block truncate">
                            {l.name}
                          </span>
                          {(l.email || l.phone) && (
                            <span className="text-[11px] text-gray-500 block truncate">
                              {[l.email, l.phone].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
            {errors.full_name && <p className={errCls}>{errors.full_name}</p>}
            <p className={hintCls}>
              {leads.length === 0 && !loadingOptions
                ? "No leads in CRM — enter the customer name manually"
                : "Type a new name or pick a lead to auto-fill email and phone"}
            </p>
          </div>

          {/* Email */}
          <div>
            <label className={labelCls} htmlFor="pl-email">
              Email
            </label>
            <div className="relative mt-1.5">
              <Mail
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                id="pl-email"
                type="email"
                value={form.email}
                onChange={(e) => patch({ email: e.target.value })}
                placeholder="customer@email.com"
                className={`${inputCls} mt-1.5 pl-9`}
              />
            </div>
            {errors.email && <p className={errCls}>{errors.email}</p>}
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.notifyEmail}
                onChange={(e) => patch({ notifyEmail: e.target.checked })}
                disabled={!form.email.trim()}
                className={`${checkCls} disabled:opacity-40`}
              />
              <span className="text-sm text-gray-600">Notify via Email</span>
            </label>
          </div>

          {/* Phone */}
          <div>
            <label className={labelCls}>Phone</label>
            <div className="flex gap-2 mt-1.5">
              <select
                value={form.countryCode}
                onChange={(e) => patch({ countryCode: e.target.value })}
                className="w-[110px] shrink-0 rounded-xl border border-gray-200 bg-white px-2 py-2.5 text-sm text-[#0f2318] focus:outline-none focus:ring-2 focus:ring-[#2ed573]/40"
              >
                <option value="+91">🇮🇳 +91</option>
                <option value="+1">🇺🇸 +1</option>
                <option value="+44">🇬🇧 +44</option>
              </select>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => patch({ phone: e.target.value })}
                placeholder="10-digit mobile"
                className={`${inputCls} flex-1`}
              />
            </div>
            {errors.phone && <p className={errCls}>{errors.phone}</p>}
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.notifySms}
                onChange={(e) => patch({ notifySms: e.target.checked })}
                disabled={form.phone.replace(/\D/g, "").length !== 10}
                className={`${checkCls} disabled:opacity-40`}
              />
              <span className="text-sm text-gray-600">Notify via SMS</span>
            </label>
          </div>

          {/* Referral Code */}
          <div>
            <label className={labelCls} htmlFor="pl-referral">
              Referral Code
            </label>
            <input
              id="pl-referral"
              type="text"
              readOnly
              value={form.referralCode}
              className={`${readonlyCls} mt-1.5 font-mono`}
            />
            {errors.referralCode && (
              <p className={errCls}>{errors.referralCode}</p>
            )}
            <p className={hintCls}>
              Pre-filled from your profile — editable before sending
            </p>
          </div>

          {/* Reference Id */}
          <div>
            <label className={labelCls} htmlFor="pl-ref">
              Reference Id
            </label>
            <input
              id="pl-ref"
              type="text"
              value={form.referenceId}
              onChange={(e) => patch({ referenceId: e.target.value })}
              placeholder="123456"
              className={`${inputCls} mt-1.5 bg-white`}
            />
          </div>

          {/* Link Expiry */}
          <div>
            <p className={sectionTitleCls}>Link Expiry</p>
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.noExpiry}
                onChange={(e) =>
                  patch({
                    noExpiry: e.target.checked,
                    expiryDate: e.target.checked ? "" : form.expiryDate,
                  })
                }
                className={checkCls}
              />
              <span className="text-sm text-gray-700">No Expiry</span>
            </label>
            {!form.noExpiry && (
              <div className="relative mt-2">
                <Calendar
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
                <input
                  type="date"
                  value={form.expiryDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => patch({ expiryDate: e.target.value })}
                  className={`${inputCls} pl-9 bg-white`}
                />
                {form.expiryDate && (
                  <p className="text-xs text-gray-500 mt-1">
                    {formatDdMmYyyy(form.expiryDate)}
                  </p>
                )}
              </div>
            )}
            {errors.expiryDate && (
              <p className={errCls}>{errors.expiryDate}</p>
            )}
          </div>

          {/* Reminders info */}
          <div className="rounded-xl bg-white border border-gray-100 px-3 py-2.5">
            <p className={sectionTitleCls}>Reminders</p>
            {form.noExpiry ? (
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                Reminders is not set to payment links with no expiry date. Set
                it up{" "}
                <a
                  href={RAZORPAY_REMINDER_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#0f2318] font-medium underline"
                >
                  here
                </a>
              </p>
            ) : (
              <p className="text-xs text-[#15803d] mt-1 font-medium">
                Reminders enabled for this link
              </p>
            )}
          </div>

          {/* Partial Payment */}
          <div>
            <p className={sectionTitleCls}>Partial Payment</p>
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.partialEnabled}
                onChange={(e) =>
                  patch({
                    partialEnabled: e.target.checked,
                    minPartialAmount: e.target.checked
                      ? form.minPartialAmount
                      : "",
                  })
                }
                className={checkCls}
              />
              <span className="text-sm text-gray-700">
                Enable Partial Payment
              </span>
            </label>
            <div
              className={`overflow-hidden transition-all duration-300 ease-out ${
                form.partialEnabled
                  ? "max-h-48 opacity-100 mt-3"
                  : "max-h-0 opacity-0"
              }`}
            >
              <label className={labelCls} htmlFor="pl-min-partial">
                Minimum First Payment Amount (₹)
              </label>
              <div className="relative mt-1.5">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                  ₹
                </span>
                <input
                  id="pl-min-partial"
                  type="number"
                  min={1}
                  step={0.01}
                  value={form.minPartialAmount}
                  onChange={(e) =>
                    patch({ minPartialAmount: e.target.value })
                  }
                  placeholder="e.g. 200"
                  className={`${inputCls} pl-8 bg-white`}
                />
              </div>
              {errors.minPartialAmount && (
                <p className={errCls}>{errors.minPartialAmount}</p>
              )}
              {partialInfo && (
                <p className="text-xs text-gray-600 mt-2">
                  Customer pays at least ₹
                  {partialInfo.min.toLocaleString("en-IN")} now, remaining ₹
                  {partialInfo.remaining.toLocaleString("en-IN")} later
                </p>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <div className="flex items-center justify-between">
              <p className={sectionTitleCls}>Notes</p>
              <button
                type="button"
                onClick={addNote}
                disabled={form.notes.length >= MAX_NOTES}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#0f2318] border border-[#2ed573] rounded-lg px-2.5 py-1 hover:bg-[#2ed573]/10 disabled:opacity-40"
              >
                <Plus size={14} />
                Add New
              </button>
            </div>
            <div className="space-y-2 mt-2">
              {form.notes.map((note, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <input
                    type="text"
                    value={note.key}
                    onChange={(e) => updateNote(i, "key", e.target.value)}
                    placeholder="Key"
                    className={`${inputCls} flex-1 bg-white`}
                  />
                  <input
                    type="text"
                    value={note.value}
                    onChange={(e) => updateNote(i, "value", e.target.value)}
                    placeholder="Value"
                    className={`${inputCls} flex-1 bg-white`}
                  />
                  <button
                    type="button"
                    onClick={() => removeNote(i)}
                    className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                    aria-label="Remove note"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Max {MAX_NOTES} notes. Batch, lead, salesperson ID and referral
              code are added automatically.
            </p>
          </div>

          {submitError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {submitError}
            </div>
          )}
        </form>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 shrink-0 bg-white rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="standard-pl-form"
            disabled={!canSubmit || loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-[#0f2318] bg-[#2ed573] hover:bg-[#22c265] disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? "Creating..." : "Create Payment Link"}
          </button>
        </div>
      </div>
    </div>
  );
}
