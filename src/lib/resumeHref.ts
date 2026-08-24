import { getApiBase } from "@/lib/apiBase";

/** Normalize stored upload path to `/uploads/...`. */
export function resumeStoragePath(path?: string | null): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const qp = u.searchParams.get("path");
      if (qp && qp.trim()) {
        candidate = decodeURIComponent(qp.trim());
      } else {
        candidate = u.pathname || "";
      }
    } catch {
      // Fall back to raw value below.
    }
  }

  const uploadsIdx = candidate.indexOf("/uploads/");
  if (uploadsIdx >= 0) {
    candidate = candidate.slice(uploadsIdx);
  } else if (
    candidate.startsWith("uploads/") ||
    candidate.startsWith("recordings/") ||
    candidate.startsWith("call_recordings/")
  ) {
    candidate = candidate.startsWith("uploads/") ? `/${candidate}` : `/uploads/${candidate}`;
  }
  const normalized = candidate.startsWith("/") ? candidate : `/${candidate}`;
  if (!normalized.startsWith("/uploads/")) return null;
  if (normalized.includes("..")) return null;
  return normalized;
}

/**
 * Resolve a stored upload / data / absolute URL for use in <img src> or CSS.
 * Private `/uploads/...` paths go through authenticated files.php (direct /uploads is blocked).
 */
export function resolveUploadSrc(path?: string | null): string {
  if (!path) return "";
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return trimmed;
  }
  const storage = resumeStoragePath(trimmed);
  if (storage) {
    return `${getApiBase()}/files.php?path=${encodeURIComponent(storage)}`;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Open a private upload via cookie-authenticated API (blob URL). */
export async function openProtectedUpload(path?: string | null): Promise<void> {
  const p = resumeStoragePath(path);
  if (!p) return;
  const url = `${getApiBase()}/files.php?path=${encodeURIComponent(p)}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/** Force-download a private upload with an optional filename. */
export async function downloadProtectedUpload(path?: string | null, filename?: string | null): Promise<void> {
  const p = resumeStoragePath(path);
  if (!p) return;
  const url = `${getApiBase()}/files.php?path=${encodeURIComponent(p)}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename || p.split("/").pop() || "download";
  a.click();
  URL.revokeObjectURL(objectUrl);
}
