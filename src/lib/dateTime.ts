/** App display timezone — matches PHP/MySQL session (+05:30 / Asia/Kolkata). */
export const APP_TIMEZONE = "Asia/Kolkata";

/**
 * Parse API/MySQL datetime strings into a Date.
 * Naive "YYYY-MM-DD HH:mm:ss" values are treated as India time (not browser-local guesswork).
 */
export function parseServerDateTime(value?: string | null): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // Already has timezone / Z
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] || "00"}:${m[5] || "00"}:${m[6] || "00"}+05:30`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** e.g. "15 Jul 2026 · 03:45 pm" in India time */
export function formatServerDateTime(value?: string | null): string {
  const d = parseServerDateTime(value);
  if (!d) return "—";
  const date = d.toLocaleDateString("en-IN", {
    timeZone: APP_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-IN", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${date} · ${time}`;
}

export function formatServerDate(value?: string | null): string {
  const d = parseServerDateTime(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", {
    timeZone: APP_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Last N calendar days of lead counts (zeros included), chronological. */
export function buildDailyLeadTrend(
  leads: Array<{ created_at?: string | null }>,
  days = 14,
): Array<{ date: string; leads: number }> {
  const counts = new Map<string, number>();
  for (const l of leads) {
    const d = parseServerDateTime(l.created_at);
    if (!d) continue;
    const key = d.toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const out: Array<{ date: string; leads: number }> = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = day.toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
    const label = day.toLocaleDateString("en-IN", {
      timeZone: APP_TIMEZONE,
      month: "short",
      day: "numeric",
    });
    out.push({ date: label, leads: counts.get(key) || 0 });
  }
  return out;
}

/** True if the server datetime falls on the same calendar day as `vs` in app timezone. */
export function isSameAppCalendarDay(
  value?: string | null,
  vs: Date = new Date(),
): boolean {
  const d = parseServerDateTime(value);
  if (!d) return false;
  return (
    d.toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE }) ===
    vs.toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE })
  );
}


