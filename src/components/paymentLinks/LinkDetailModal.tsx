import { useState } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  Mail,
  Phone,
  Smartphone,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadPaymentLinkInvoice } from "@/api/payment-links/invoice";
import type {
  PaymentLinkStatus,
  RazorpayPaymentLink,
} from "@/types/paymentLinks";

interface Props {
  link: RazorpayPaymentLink;
  onClose: () => void;
  onCancel: (id: string) => void;
  onRemind: (id: string, medium: "sms" | "email") => void;
  onCopyShortUrl: (url: string) => void;
}

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

function fmt(unix?: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LinkDetailModal({
  link,
  onClose,
  onCancel,
  onRemind,
  onCopyShortUrl,
}: Props) {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);
  const badge = STATUS_BADGE[link.status] ?? STATUS_BADGE.created;
  const isPending = link.status === "created";
  const isPartial = link.status === "partially_paid";
  const canEmailRemind =
    isPending ||
    isPartial ||
    (link.amount_paid > 0 && link.amount_paid < link.amount);
  const canSmsRemind =
    isPending && (link.customer?.contact || "").replace(/\D/g, "").length >= 10;
  const hasPayment =
    link.status === "paid" ||
    link.status === "partially_paid" ||
    link.amount_paid > 0;

  function copy(label: string, value: string) {
    void navigator.clipboard.writeText(value).catch(() => {});
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  }

  const paidAt = (() => {
    if (link.status !== "paid") return null;
    const last = link.payments?.[link.payments.length - 1];
    return last?.created_at ?? null;
  })();

  const Section = ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <div className="px-6 py-4 border-b border-gray-100">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2">
        {title}
      </p>
      {children}
    </div>
  );

  const Row = ({
    label,
    value,
    copyValue,
    open,
  }: {
    label: string;
    value: React.ReactNode;
    copyValue?: string;
    open?: string;
  }) => (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-medium text-gray-900 break-all">{value}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {copyValue ? (
          <button
            type="button"
            onClick={() => copy(label, copyValue)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            title="Copy"
          >
            <Copy size={14} />
            {copied === label && (
              <span className="ml-1 text-[10px] text-emerald-600">Copied</span>
            )}
          </button>
        ) : null}
        {open ? (
          <a
            href={open}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            title="Open"
          >
            <ExternalLink size={14} />
          </a>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[min(92dvh,100%)] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              Payment Link Details
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{link.id}</p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center text-xs font-semibold px-3 py-1.5 rounded-full border ${badge.cls}`}
            >
              {badge.label}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <Section title="Link Info">
          <Row label="Link ID" value={link.id} copyValue={link.id} />
          <Row
            label="Short URL"
            value={link.short_url}
            copyValue={link.short_url}
            open={link.short_url}
          />
          <Row label="Reference" value={link.reference_id || "—"} />
          <Row label="Description" value={link.description || "—"} />
        </Section>

        <Section title="Amount">
          <p className="text-3xl font-bold text-gray-900">
            ₹{(link.amount / 100).toLocaleString("en-IN")}
          </p>
          {link.status === "paid" && (
            <p className="text-sm text-[#22c55e] font-semibold mt-1">
              ₹{(link.amount_paid / 100).toLocaleString("en-IN")} collected
            </p>
          )}
        </Section>

        <Section title="Customer">
          <Row
            label="Name"
            value={link.customer?.name || "—"}
            copyValue={link.customer?.name || undefined}
          />
          <Row
            label="Email"
            value={link.customer?.email || "—"}
            copyValue={link.customer?.email || undefined}
          />
          <Row
            label="Phone"
            value={link.customer?.contact || "—"}
            copyValue={link.customer?.contact || undefined}
          />
        </Section>

        <Section title="Timeline">
          <Row label="Created" value={fmt(link.created_at)} />
          <Row
            label="Expires"
            value={link.expire_by ? fmt(link.expire_by) : "No expiry"}
          />
          <Row label="Paid at" value={fmt(paidAt)} />
        </Section>

        <Section title="Payment History">
          {link.payments && link.payments.length > 0 ? (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                    <th className="px-2 py-2 font-semibold">Payment ID</th>
                    <th className="px-2 py-2 font-semibold">Amount</th>
                    <th className="px-2 py-2 font-semibold">Method</th>
                    <th className="px-2 py-2 font-semibold">Status</th>
                    <th className="px-2 py-2 font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {link.payments.map((p) => (
                    <tr key={p.payment_id}>
                      <td className="px-2 py-2 font-mono text-[12px] text-gray-700">
                        {p.payment_id}
                      </td>
                      <td className="px-2 py-2 font-medium text-gray-900">
                        ₹{(p.amount / 100).toLocaleString("en-IN")}
                      </td>
                      <td className="px-2 py-2 text-gray-700">
                        {p.method || "—"}
                      </td>
                      <td className="px-2 py-2 text-gray-700">{p.status}</td>
                      <td className="px-2 py-2 text-xs text-gray-700">
                        {fmt(p.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No payments yet</p>
          )}
        </Section>

        <div className="flex flex-wrap items-center justify-end gap-2 px-6 py-4 bg-gray-50 rounded-b-2xl">
          {hasPayment && (
            <button
              type="button"
              disabled={downloadingInvoice}
              onClick={() => {
                setDownloadingInvoice(true);
                void downloadPaymentLinkInvoice(link.id)
                  .catch((err) =>
                    toast({
                      variant: "destructive",
                      title: "Invoice unavailable",
                      description:
                        err instanceof Error
                          ? err.message
                          : "Invoice is generated after payment via webhook",
                    }),
                  )
                  .finally(() => setDownloadingInvoice(false));
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#2ed573]/40 bg-[#e6faf0] text-sm font-medium text-[#0f2318] hover:bg-[#d4f5e3] disabled:opacity-50"
            >
              <Download size={14} />
              {downloadingInvoice ? "Loading…" : "Download Invoice"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onCopyShortUrl(link.short_url)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Copy size={14} />
            Copy Link
          </button>
          {canEmailRemind && (
            <button
              type="button"
              onClick={() => onRemind(link.id, "email")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
              title={
                isPartial || link.amount_paid > 0
                  ? "Send balance-due reminder from support@syncpedia.in"
                  : "Send payment reminder from support@syncpedia.in"
              }
            >
              <Mail size={14} />
              {isPartial || (link.amount_paid > 0 && link.amount_paid < link.amount)
                ? "Email balance reminder"
                : "Email Reminder"}
            </button>
          )}
          {canSmsRemind && (
            <button
              type="button"
              onClick={() => onRemind(link.id, "sms")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Smartphone size={14} />
              SMS Reminder
            </button>
          )}
          {isPending && (
            <button
              type="button"
              onClick={() => onCancel(link.id)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-red-200 bg-white text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <X size={14} />
              Cancel Link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
