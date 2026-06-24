/** Build absolute URL for a resume stored as `/uploads/resumes/...` on the app origin. */
export function resumePublicHref(path?: string | null): string {
  if (!path) return "";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") return normalized;
  return `${window.location.origin}${normalized}`;
}
