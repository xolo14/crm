import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subMonths,
} from "date-fns";

export type PaymentLinkPeriod =
  | "today"
  | "week"
  | "month"
  | "last_month"
  | "year"
  | "all";

export const PAYMENT_LINK_PERIODS: {
  value: PaymentLinkPeriod;
  label: string;
}[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "year", label: "This Year" },
  { value: "all", label: "All Time" },
];

/** Unix seconds for Razorpay list API `from` / `to` filters. */
export function paymentLinkPeriodUnixRange(
  period: PaymentLinkPeriod,
): { from?: number; to?: number } {
  if (period === "all") {
    return {};
  }

  const now = new Date();
  let from: Date;
  let to: Date;

  switch (period) {
    case "today":
      from = startOfDay(now);
      to = endOfDay(now);
      break;
    case "week":
      from = startOfWeek(now, { weekStartsOn: 1 });
      to = endOfWeek(now, { weekStartsOn: 1 });
      break;
    case "month":
      from = startOfMonth(now);
      to = endOfMonth(now);
      break;
    case "last_month": {
      const prev = subMonths(now, 1);
      from = startOfMonth(prev);
      to = endOfMonth(prev);
      break;
    }
    case "year":
      from = startOfYear(now);
      to = endOfYear(now);
      break;
    default:
      return {};
  }

  return {
    from: Math.floor(from.getTime() / 1000),
    to: Math.floor(to.getTime() / 1000),
  };
}

/** Client-side filter by created_at (unix seconds). */
export function filterLinksByPeriod<T extends { created_at: number }>(
  links: T[],
  period: PaymentLinkPeriod,
): T[] {
  if (period === "all") return links;
  const { from, to } = paymentLinkPeriodUnixRange(period);
  return links.filter((l) => {
    if (from !== undefined && l.created_at < from) return false;
    if (to !== undefined && l.created_at > to) return false;
    return true;
  });
}
