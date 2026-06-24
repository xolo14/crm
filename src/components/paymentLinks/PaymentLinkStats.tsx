import { Link2, IndianRupee, Clock, CheckCircle2 } from "lucide-react";
import type { PaymentLinkStats as Stats } from "@/types/paymentLinks";

interface Props {
  stats: Stats;
  loading?: boolean;
}

interface Card {
  label: string;
  value: string;
  sub?: string;
  Icon: typeof Link2;
  bg: string;
  fg: string;
}

export default function PaymentLinkStats({ stats, loading }: Props) {
  const cards: Card[] = [
    {
      label: "TOTAL LINKS",
      value: String(stats.totalLinks),
      Icon: Link2,
      bg: "#eff6ff",
      fg: "#3b82f6",
    },
    {
      label: "TOTAL COLLECTED",
      value: `₹${stats.totalCollected.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
      Icon: IndianRupee,
      bg: "#f0fdf4",
      fg: "#22c55e",
    },
    {
      label: "PENDING",
      value: String(stats.pending),
      sub: "awaiting payment",
      Icon: Clock,
      bg: "#fffbeb",
      fg: "#f59e0b",
    },
    {
      label: "PAID",
      value: String(stats.paid),
      Icon: CheckCircle2,
      bg: "#f0fdf4",
      fg: "#22c55e",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ label, value, sub, Icon, bg, fg }) => (
        <div
          key={label}
          className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 flex items-start gap-4"
        >
          <div
            className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: bg, color: fg }}
          >
            <Icon size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-wider text-gray-500">
              {label}
            </p>
            {loading ? (
              <div className="mt-2 h-7 w-24 rounded bg-gray-100 animate-pulse" />
            ) : (
              <p className="text-2xl font-bold text-gray-900 mt-1 truncate">
                {value}
              </p>
            )}
            {sub ? (
              <p className="text-[11px] text-gray-500 mt-1">{sub}</p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
