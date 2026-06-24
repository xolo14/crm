import type { PaymentLinkPeriod } from "@/utils/paymentLinkPeriod";
import { PAYMENT_LINK_PERIODS } from "@/utils/paymentLinkPeriod";
import { cn } from "@/lib/utils";

interface Props {
  value: PaymentLinkPeriod;
  onChange: (period: PaymentLinkPeriod) => void;
  className?: string;
}

export default function PaymentLinksPeriodTabs({
  value,
  onChange,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-0.5 rounded-full bg-gray-100 p-1",
        className,
      )}
      role="tablist"
      aria-label="Filter by period"
    >
      {PAYMENT_LINK_PERIODS.map((p) => (
        <button
          key={p.value}
          type="button"
          role="tab"
          aria-selected={value === p.value}
          onClick={() => onChange(p.value)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-medium transition-all",
            value === p.value
              ? "bg-white text-gray-900 shadow-sm"
              : "text-slate-500 hover:text-gray-800",
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
