/** Current site origin — works on any Hostinger domain without build-time env vars. */
export function getSiteOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

export function publicApplyUrl(referralCode: string, form?: string): string {
  const origin = getSiteOrigin();
  const base = origin ? `${origin}/apply` : `/apply`;
  const params = new URLSearchParams({ ref: referralCode });
  if (form) {
    params.set("form", form);
  }
  return `${base}?${params.toString()}`;
}
