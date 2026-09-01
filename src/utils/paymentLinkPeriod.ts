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
  | "all"
  | "custom";

export type PaymentLinkCustomRange = {
  from?: string;
  to?: string;
};

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
  { value: "custom", label: "Custom range" },
];

/** Unix seconds for Razorpay list API `from` / `to` filters. */
export function paymentLinkPeriodUnixRange(
  period: PaymentLinkPeriod,
  custom?: PaymentLinkCustomRange,
): { from?: number; to?: number } {
  if (period === "custom") {
    const from = custom?.from
      ? Math.floor(new Date(`${custom.from}T00:00:00`).getTime() / 1000)
      : undefined;
    const to = custom?.to
      ? Math.floor(new Date(`${custom.to}T23:59:59`).getTime() / 1000)
      : undefined;
    return { from, to };
  }

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

function rowTimestampSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized =
    /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00` : trimmed.replace(" ", "T");
  const ts = Math.floor(new Date(normalized).getTime() / 1000);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

function inUnixRange(ts: number, from?: number, to?: number): boolean {
  if (from !== undefined && ts < from) return false;
  if (to !== undefined && ts > to) return false;
  return true;
}

/** Client-side filter by created_at (unix seconds). */
export function filterLinksByPeriod<T extends { created_at: number }>(
  links: T[],
  period: PaymentLinkPeriod,
  custom?: PaymentLinkCustomRange,
): T[] {
  if (period === "all") return links;
  const { from, to } = paymentLinkPeriodUnixRange(period, custom);
  return links.filter((l) => inUnixRange(l.created_at, from, to));
}

/**
 * Filter manual/approval payment rows by period using paid_at (preferred) or created_at.
 * Accepts ISO / MySQL datetime strings.
 */
export function filterManualRowsByPeriod<
  T extends { paid_at?: string | null; created_at?: string | null; reviewed_at?: string | null },
>(rows: T[], period: PaymentLinkPeriod, custom?: PaymentLinkCustomRange): T[] {
  if (period === "all") return rows;
  const { from, to } = paymentLinkPeriodUnixRange(period, custom);
  return rows.filter((row) => {
    const raw = String(row.paid_at || row.reviewed_at || row.created_at || "").trim();
    const ts = rowTimestampSeconds(raw);
    if (ts === null) return false;
    return inUnixRange(ts, from, to);
  });
}

/** Filter payment candidates by updated_at (fallback created_at). */
export function filterCandidatesByPeriod<
  T extends { updated_at?: string | null; created_at?: string | null },
>(rows: T[], period: PaymentLinkPeriod, custom?: PaymentLinkCustomRange): T[] {
  if (period === "all") return rows;
  const { from, to } = paymentLinkPeriodUnixRange(period, custom);
  return rows.filter((row) => {
    const raw = String(row.updated_at || row.created_at || "").trim();
    const ts = rowTimestampSeconds(raw);
    if (ts === null) return false;
    return inUnixRange(ts, from, to);
  });
}
