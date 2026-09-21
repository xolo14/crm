/** Public apply URLs: at most one `ref` (assignee or owner), never creator+user together. */

export function applyFormSlugFromInput(raw: string): string {
  let value = String(raw || "").trim();
  if (!value) return "";

  const looksLikeUrl = value.includes("://") || value.startsWith("/") || value.includes("?");
  if (looksLikeUrl) {
    try {
      const parsed = value.includes("://") ? new URL(value) : new URL(value, "https://local.invalid");
      const fromQuery = (parsed.searchParams.get("form") || "").trim();
      if (fromQuery) {
        value = fromQuery;
      } else {
        const path = parsed.pathname.replace(/^\/apply\/?/i, "").replace(/^\//, "");
        if (path && !path.includes("/")) {
          value = path;
        }
      }
    } catch {
      /* keep raw */
    }
  }

  const cut = value.search(/[?#]/);
  if (cut >= 0) {
    value = value.slice(0, cut);
  }
  return value.trim();
}

export function buildPublicApplyUrl(origin: string, slug: string, referralCode?: string | null): string {
  const form = applyFormSlugFromInput(slug);
  const base = String(origin || "").replace(/\/+$/, "") || (typeof window !== "undefined" ? window.location.origin : "");
  const url = new URL(`${base}/apply`);
  if (form) {
    url.searchParams.set("form", form);
  }
  const ref = String(referralCode || "").trim();
  if (ref) {
    url.searchParams.set("ref", ref);
  }
  return url.toString();
}

export function buildPublicDocFormUrl(origin: string, slug: string, referralCode?: string | null): string {
  const form = String(slug || "").trim().replace(/^\/+|\/+$/g, "");
  const base = String(origin || "").replace(/\/+$/, "") || (typeof window !== "undefined" ? window.location.origin : "");
  const url = new URL(`${base}/doc-form/${encodeURIComponent(form)}`);
  const ref = String(referralCode || "").trim();
  if (ref) url.searchParams.set("ref", ref);
  return url.toString();
}
