/** Monday-start week key (YYYY-MM-DD) for the civil calendar date in Asia/Kolkata — aligns React Query cache with server IST week. */
export function getCurrentWeekKeyIST(): string {
  const tz = "Asia/Kolkata";
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  const d = Number(parts.find((p) => p.type === "day")!.value);
  const utcMidnight = Date.UTC(y, m - 1, d);
  const dow = new Date(utcMidnight).getUTCDay();
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const mondayUtc = utcMidnight - daysFromMonday * 86400000;
  const dm = new Date(mondayUtc);
  const yy = dm.getUTCFullYear();
  const mm = String(dm.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dm.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function addDaysToISO(isoYmd: string, deltaDays: number): string {
  const [y, m, d] = isoYmd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86400000;
  const dt = new Date(t);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Current ISO week (Mon–Sun) in IST as YYYY-MM-DD bounds */
export function getISTWeekRangeYYYYMMDD(): { from: string; to: string } {
  const mon = getCurrentWeekKeyIST();
  return { from: mon, to: addDaysToISO(mon, 6) };
}

export function getISTLastWeekRangeYYYYMMDD(): { from: string; to: string } {
  const mon = getCurrentWeekKeyIST();
  const lastMon = addDaysToISO(mon, -7);
  const lastSun = addDaysToISO(mon, -1);
  return { from: lastMon, to: lastSun };
}

export function getISTMonthRangeYYYYMMDD(): { from: string; to: string } {
  const tz = "Asia/Kolkata";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const to = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}
