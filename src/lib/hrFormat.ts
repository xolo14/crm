/** Display helpers for the HR Portal (India-based teams: DD/MM/YYYY dates, readable status words). */

/** "not_interested" → "Not interested", "in_progress" → "In progress". */
export function statusLabel(value: string | null | undefined): string {
  const s = String(value ?? "").trim().replace(/_/g, " ");
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Parse "YYYY-MM-DD" (or a datetime) without shifting the day across time zones. */
function parseDay(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 25/11/2026 */
export function formatDateIN(value: string | Date | null | undefined): string {
  const d = parseDay(value);
  return d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}

/** 25/11/2026, 5:43 pm */
export function formatDateTimeIN(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Wednesday */
export function weekdayName(value: string | Date | null | undefined): string {
  const d = parseDay(value);
  return d ? d.toLocaleDateString("en-IN", { weekday: "long" }) : "—";
}

/** "YYYY-MM-DD" for a local Date (no UTC shift). */
export function isoDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Evenly spaced chart axis labels that always include the latest bucket (today / this month). */
export function evenTicks(labels: string[], range: "week" | "month" | "year" | string): string[] {
  const step = range === "month" ? 5 : range === "year" ? 2 : 1;
  const n = labels.length;
  return labels.filter((_, i) => (n - 1 - i) % step === 0);
}
