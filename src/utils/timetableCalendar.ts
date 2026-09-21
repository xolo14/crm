export type PeriodType = "week" | "month";

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function periodBounds(type: PeriodType, anchorYmd: string): { start: string; end: string } {
  const d = parseYmd(anchorYmd);
  if (type === "month") {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start: toYmd(start), end: toYmd(end) };
  }
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: toYmd(start), end: toYmd(end) };
}

export function eachDayInRange(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  let cur = parseYmd(startYmd);
  const end = parseYmd(endYmd);
  while (cur <= end) {
    out.push(toYmd(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 12, 0, 0, 0);
  }
  return out;
}

export function formatDayLabel(ymd: string): string {
  return parseYmd(ymd).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export function formatPeriodLabel(type: PeriodType, start: string, end: string): string {
  if (type === "month") {
    return parseYmd(start).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }
  const a = parseYmd(start).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const b = parseYmd(end).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return `${a} – ${b}`;
}

export type PeriodOption = { value: string; label: string };

/** Monday YMD for the week containing `anchorYmd` (Mon–Sun). */
export function weekPeriodStart(anchorYmd: string): string {
  return periodBounds("week", anchorYmd).start;
}

/** First-of-month YMD for the month containing `anchorYmd`. */
export function monthPeriodStart(anchorYmd: string): string {
  return periodBounds("month", anchorYmd).start;
}

/** Default anchor: current week (Monday). */
export function defaultWeekAnchor(): string {
  return weekPeriodStart(toYmd(new Date()));
}

/** Default anchor: current month (1st). */
export function defaultMonthAnchor(): string {
  return monthPeriodStart(toYmd(new Date()));
}

/** Current + next 11 weeks (Mon–Sun), 12 options total. */
export function weekPeriodOptions(count = 12): PeriodOption[] {
  const out: PeriodOption[] = [];
  let monday = parseYmd(defaultWeekAnchor());
  for (let i = 0; i < count; i++) {
    const startYmd = toYmd(monday);
    const endYmd = periodBounds("week", startYmd).end;
    out.push({ value: startYmd, label: formatPeriodLabel("week", startYmd, endYmd) });
    monday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7, 12, 0, 0, 0);
  }
  return out;
}

/** Current + next 11 months, 12 options total. */
export function monthPeriodOptions(count = 12): PeriodOption[] {
  const out: PeriodOption[] = [];
  const seed = parseYmd(defaultMonthAnchor());
  let y = seed.getFullYear();
  let m = seed.getMonth();
  for (let i = 0; i < count; i++) {
    const startYmd = toYmd(new Date(y, m, 1, 12, 0, 0, 0));
    const endYmd = periodBounds("month", startYmd).end;
    out.push({ value: startYmd, label: formatPeriodLabel("month", startYmd, endYmd) });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/** Keep edited timetables visible when their period falls outside the default window. */
export function mergePeriodOption(
  options: PeriodOption[],
  periodStart: string,
  type: PeriodType,
): PeriodOption[] {
  const start = periodStart.trim();
  if (start === "" || options.some((o) => o.value === start)) {
    return options;
  }
  const end = periodBounds(type, start).end;
  return [
    { value: start, label: formatPeriodLabel(type, start, end) },
    ...options,
  ].sort((a, b) => a.value.localeCompare(b.value));
}

export function formatTime12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return t;
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}:${pad2(m || 0)} ${ampm}`;
}
