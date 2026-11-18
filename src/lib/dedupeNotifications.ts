/**
 * One alert per (type, entity, day). The entity is the notification's link when it has
 * one (e.g. /offer-letters#followup-<id>); otherwise title + message. Duplicates created
 * in the same minute (e.g. two "Bharadwaja" alerts) collapse into the first one.
 */
export function dedupeNotifications<
  T extends { type?: string; title?: string; message?: string | null; created_at?: string; link?: string | null },
>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const n of rows) {
    const day = String(n.created_at || "").slice(0, 10);
    const link = String(n.link ?? "").trim();
    const entity = link || `${String(n.title ?? "").trim().toLowerCase()}|${String(n.message ?? "").trim().toLowerCase()}`;
    const key = `${n.type ?? ""}|${entity}|${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}
