/**
 * Resolve the PHP API base path for fetch calls.
 * VITE_API_URL="" must mean /api (same-origin), not "" (which hits the SPA).
 */
export function getApiBase(): string {
  const raw = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (!raw || raw === "/") {
    return "/api";
  }

  let base = raw.replace(/\/$/, "");

  // e.g. https://crm.example.com → https://crm.example.com/api
  if (/^https?:\/\//i.test(base) && !/\/api$/i.test(base)) {
    base = `${base}/api`;
  }

  return base.startsWith("/") ? base : `/${base}`;
}
