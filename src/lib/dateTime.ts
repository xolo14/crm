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
