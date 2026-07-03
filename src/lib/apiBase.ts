/**
 * Resolve the PHP API base path for fetch calls.
 * Hostinger deploy: no env vars — production build always uses same-origin /api.
 */
export function getApiBase(): string {
  // Production on shared hosting: frontend + PHP live in the same public_html folder.
  if (import.meta.env.PROD) {
    const raw = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
    if (!raw || raw === "/") {
      return "/api";
    }
  }

  const raw = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (!raw || raw === "/") {
    return "/api";
  }

  let base = raw.replace(/\/$/, "");

  if (/^https?:\/\//i.test(base) && !/\/api$/i.test(base)) {
    base = `${base}/api`;
  }

  return base.startsWith("/") ? base : `/${base}`;
}
