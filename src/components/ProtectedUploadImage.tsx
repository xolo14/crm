import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { resolveUploadSrc, resumeStoragePath } from "@/lib/resumeHref";
import { getApiBase } from "@/lib/apiBase";

type Props = {
  path?: string | null;
  alt?: string;
  className?: string;
  /** Use fetch + blob URL for /uploads paths (needed when files.php requires auth). */
  protected?: boolean;
};

/** Render a private /uploads asset with cookie-authenticated fetch when needed. */
export function ProtectedUploadImage({
  path,
  alt = "",
  className,
  protected: useProtected = true,
}: Props) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    const trimmed = String(path || "").trim();
    if (!trimmed) {
      setSrc("");
      return;
    }

    if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
      setSrc(trimmed);
      return;
    }

    const storage = resumeStoragePath(trimmed);
    const direct = resolveUploadSrc(trimmed);
    if (!useProtected || !storage) {
      setSrc(direct);
      return;
    }

    let blobUrl: string | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(direct, { credentials: "include" });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!blob.type.startsWith("image/") && blob.type !== "application/octet-stream" && blob.type !== "") {
          throw new Error(blob.type || "not-image");
        }
        blobUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(blobUrl);
      } catch {
        if (!cancelled) setSrc("");
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [path, useProtected]);

  if (!src) return null;

  return (
    <img
      src={src}
      alt={alt}
      className={cn(className)}
      draggable={false}
      onError={() => {
        const trimmed = String(path || "").trim();
        const storage = resumeStoragePath(trimmed);
        if (!storage) return;
        if (src === storage) {
          setSrc(`${getApiBase()}/files.php?path=${encodeURIComponent(storage)}`);
          return;
        }
        if (src.startsWith("blob:")) return;
        setSrc(`${getApiBase()}/files.php?path=${encodeURIComponent(storage)}`);
      }}
    />
  );
}
