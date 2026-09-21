/**
 * Pre-filled links (Google Forms "Get pre-filled link").
 * Public URL params `prefill_<key>=value` or `entry.<key>=value` seed the matching answer.
 */

export function readPrefillFromSearch(search: string, allowedKeys: string[]): Record<string, string> {
  const params = new URLSearchParams(search || "");
  const allowed = new Set(allowedKeys);
  const out: Record<string, string> = {};
  params.forEach((value, name) => {
    let key = "";
    if (name.startsWith("prefill_")) key = name.slice("prefill_".length);
    else if (name.startsWith("entry.")) key = name.slice("entry.".length);
    if (!key || !allowed.has(key)) return;
    const v = String(value || "").trim();
    if (v) out[key] = v.slice(0, 2000);
  });
  return out;
}

export function buildPrefilledUrl(baseUrl: string, values: Record<string, string>): string {
  const url = new URL(baseUrl, typeof window !== "undefined" ? window.location.origin : "https://example.com");
  for (const [k, v] of Object.entries(values)) {
    const val = String(v ?? "").trim();
    if (!val) continue;
    url.searchParams.set(`prefill_${k}`, val);
  }
  return url.toString();
}
