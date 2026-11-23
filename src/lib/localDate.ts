/**
 * Calendar dates in the user's own timezone (IST for this team), never UTC.
 *
 * `new Date().toISOString().slice(0, 10)` gives the UTC date, which in India is still
 * "yesterday" between midnight and 5:30 AM, and turns a local-midnight Date into the
 * previous day. Use these helpers for "today", date inputs, day buckets and file names.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Parse a Date, epoch milliseconds, or a date string. "YYYY-MM-DD HH:MM:SS" (MySQL) is read as local time. */
function toDate(value: Date | number | string): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const s = value.trim();
  // A bare date already is a calendar day; parsing it would read it as UTC midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  // MySQL DATETIME has no timezone: treat it as local (Safari rejects the space form).
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) return new Date(s.replace(" ", "T"));
  return new Date(s);
}

/** "YYYY-MM-DD" in local time; "" for an invalid value. Defaults to today. */
export function localDateKey(value: Date | number | string = new Date()): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM" in local time; "" for an invalid value. Defaults to this month. */
export function localMonthKey(value: Date | number | string = new Date()): string {
  return localDateKey(value).slice(0, 7);
}
