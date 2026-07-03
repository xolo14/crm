import { Copy, Eye, Mail, X } from "lucide-react";
import type {
  PaymentLinkStatus,
  RazorpayPaymentLink,
} from "@/types/paymentLinks";

interface Props {
  link: RazorpayPaymentLink;
  onViewDetail: (link: RazorpayPaymentLink) => void;
  onCancel: (id: string) => void;
  onRemind: (id: string, medium: "sms" | "email") => void;
  onCopyShortUrl: (url: string) => void;
}

const STATUS_BADGE: Record<
  PaymentLinkStatus,
  { label: string; cls: string }
> = {
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
    cls: "bg-blue-50 text-blue-700 border-blue-200",
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

function formatDate(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function PaymentLinkCard({
  link,
  onViewDetail,
  onCancel,
  onRemind,
  onCopyShortUrl,
}: Props) {
  const badge = STATUS_BADGE[link.status] ?? STATUS_BADGE.created;
  const isPending = link.status === "created";
  const amountClass = link.status === "paid" ? "text-[#22c55e]" : "text-gray-900";

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">
            {link.customer?.name || "—"}
          </p>
          <p className="text-xs text-gray-500 truncate">
            {link.customer?.email || "—"}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full border ${badge.cls}`}
        >
          {badge.label}
        </span>
      </div>

      <div className="mt-3">
        <p className={`text-xl font-bold ${amountClass}`}>
          ₹{(link.amount / 100).toLocaleString("en-IN")}
        </p>
        <p className="text-sm text-gray-500 truncate">
          {link.description || "Payment request"}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-gray-500 font-mono truncate">
            Ref: {link.reference_id || "—"}
          </p>
          <p className="text-[11px] text-gray-500">
            Created {formatDate(link.created_at)}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onCopyShortUrl(link.short_url)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="Copy link"
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            onClick={() => onViewDetail(link)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            title="View detail"
          >
            <Eye size={14} />
          </button>
          {isPending && (
            <>
              <button
                type="button"
                onClick={() => onRemind(link.id, "email")}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                title="Send email reminder"
              >
                <Mail size={14} />
              </button>
              <button
                type="button"
                onClick={() => onCancel(link.id)}
                className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                title="Cancel link"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
