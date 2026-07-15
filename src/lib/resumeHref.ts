import { getApiBase } from "@/lib/apiBase";

/** Normalize stored upload path to `/uploads/...`. */
export function resumeStoragePath(path?: string | null): string | null {
  if (!path) return null;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!normalized.startsWith("/uploads/")) return null;
  if (normalized.includes("..")) return null;
  return normalized;
}

/**
 * @deprecated Direct public URLs are blocked. Use openProtectedUpload().
 * Kept as alias that returns authenticated API URL (requires Authorization — prefer openProtectedUpload).
 */
export function resumePublicHref(path?: string | null): string {
  const p = resumeStoragePath(path);
  if (!p) return "#";
  return `${getApiBase()}/files.php?path=${encodeURIComponent(p)}`;
}

/** Open a private upload via JWT-authenticated API (blob URL). */
export async function openProtectedUpload(path?: string | null): Promise<void> {
  const p = resumeStoragePath(path);
  if (!p) return;
  const token = localStorage.getItem("auth_token") || localStorage.getItem("hr_token");
  if (!token) {
    throw new Error("Not signed in");
  }
  const url = `${getApiBase()}/files.php?path=${encodeURIComponent(p)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
