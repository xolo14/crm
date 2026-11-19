/**
 * One alert per (type, entity, day) — the entity is the notification's link when it has one
 * (e.g. /offer-letters#followup-<id>), otherwise title + message. On top of that, the same
 * wording within the same minute is one alert whatever its type or link, which catches pairs
 * created twice by one action (e.g. the duplicate "K.D.V.S Bharadwaja" alert).
 */
export function dedupeNotifications<
  T extends { type?: string; title?: string; message?: string | null; created_at?: string; link?: string | null },
>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const n of rows) {
    const created = String(n.created_at || "");
    const day = created.slice(0, 10);
    const minute = created.slice(0, 16);
    const words = `${String(n.title ?? "").trim().toLowerCase()}|${String(n.message ?? "").trim().toLowerCase()}`;
    const link = String(n.link ?? "").trim();
    const entityKey = `e|${n.type ?? ""}|${link || words}|${day}`;
    const wordingKey = `w|${words}|${minute}`;
    if (seen.has(entityKey) || seen.has(wordingKey)) continue;
    seen.add(entityKey);
    seen.add(wordingKey);
    out.push(n);
  }
  return out;
}
