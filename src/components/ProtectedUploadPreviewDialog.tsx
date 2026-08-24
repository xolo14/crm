import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getApiBase } from "@/lib/apiBase";
import { resumeStoragePath } from "@/lib/resumeHref";

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

function guessMimeFromPath(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".m4a") || lower.endsWith(".aac") || lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".amr")) return "audio/amr";
  if (lower.endsWith(".3gp") || lower.endsWith(".3gpp")) return "audio/3gpp";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return null;
}

/** Detect real format from bytes (Android often names AMR as .wav). */
function sniffMimeFromBytes(buf: ArrayBuffer): string | null {
  const u8 = new Uint8Array(buf.slice(0, 32));
  if (u8.length < 4) return null;
  const asStr = (start: number, len: number) => {
    let out = "";
    for (let i = start; i < start + len && i < u8.length; i++) out += String.fromCharCode(u8[i]);
    return out;
  };

  if (asStr(0, 4) === "RIFF" && u8.length >= 12 && asStr(8, 4) === "WAVE") return "audio/wav";
  if (asStr(0, 5) === "#!AMR") return "audio/amr";
  if (asStr(0, 4) === "OggS") return "audio/ogg";
  if (asStr(0, 4) === "fLaC") return "audio/flac";
  if (asStr(0, 3) === "ID3") return "audio/mpeg";
  if (u8[0] === 0xff && (u8[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (u8.length >= 12 && asStr(4, 4) === "ftyp") {
    const brand = asStr(8, 4).toLowerCase();
    if (brand.startsWith("3g") || brand === "3gp4" || brand === "3gp5" || brand === "3g2a") {
      return "audio/3gpp";
    }
    return "audio/mp4";
  }
  if (asStr(0, 4) === "%PDF") return "application/pdf";
  return null;
}

function isLikelyUnplayableInBrowser(mime: string): boolean {
  const m = mime.toLowerCase();
  return m.includes("amr") || m.includes("3gp") || m.includes("3gpp");
}

function isPdfMime(mime: string, path: string): boolean {
  return mime === "application/pdf" || /\.pdf$/i.test(path);
}

/**
 * In-app preview for private uploads (call recordings, attachments).
 */
export function ProtectedUploadPreviewDialog({
  path,
  open,
  onOpenChange,
  title = "Recording",
}: {
  path: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}) {
  const [blobUrl, setBlobUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mime, setMime] = useState<string>("");
  const [playError, setPlayError] = useState<string | null>(null);
  const [fileBytes, setFileBytes] = useState(0);

  const storage = path ? resumeStoragePath(path) : null;

  useEffect(() => {
    if (!open) {
      setBlobUrl("");
      setError(null);
      setLoading(false);
      setMime("");
      setPlayError(null);
      setFileBytes(0);
      return;
    }

    if (!path) {
      setError("No recording path on this call log");
      setLoading(false);
      return;
    }

    if (!storage) {
      setError(`Invalid recording path: ${path}`);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let created: string | null = null;
    setLoading(true);
    setError(null);
    setPlayError(null);
    setBlobUrl("");
    setFileBytes(0);

    void (async () => {
      try {
        const url = `${getApiBase()}/files.php?path=${encodeURIComponent(storage)}`;
        const res = await fetch(url, { credentials: "include" });
        const contentType = (res.headers.get("Content-Type") || "").split(";")[0].trim();

        if (!res.ok) {
          let msg = `Failed to load (${res.status})`;
          const raw = await res.text().catch(() => "");
          if (raw) {
            try {
              const j = JSON.parse(raw);
              if (j?.error) msg = String(j.error);
              else msg = raw.slice(0, 180);
            } catch {
              msg = raw.slice(0, 180);
            }
          }
          throw new Error(msg);
        }

        if (contentType.includes("json") || contentType.includes("text/html")) {
          const raw = await res.text();
          throw new Error(raw.slice(0, 180) || "Server did not return an audio file");
        }

        const buf = await res.arrayBuffer();
        if (buf.byteLength < 16) {
          throw new Error("Recording file is empty or incomplete on the server");
        }

        const sniffed = sniffMimeFromBytes(buf);
        const guessed = guessMimeFromPath(storage);
        const type =
          sniffed ||
          (contentType &&
          contentType !== "application/octet-stream" &&
          contentType !== "text/plain"
            ? contentType
            : null) ||
          guessed ||
          "audio/wav";

        const blob = new Blob([buf], { type });
        created = URL.createObjectURL(blob);
        if (!cancelled) {
          setMime(type);
          setFileBytes(buf.byteLength);
          setBlobUrl(created);
          if (isLikelyUnplayableInBrowser(type)) {
            setPlayError(
              "This recording is AMR/3GP (common on Android phones). The browser cannot play it — use Download, then open on your phone or with VLC.",
            );
          }
        } else {
          URL.revokeObjectURL(created);
          created = null;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load file");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [open, path, storage]);

  const onDownload = () => {
    if (!blobUrl || !path) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = basename(path);
    a.click();
  };

  const isPdf = Boolean(blobUrl && path && isPdfMime(mime, path));
  const showAudio = Boolean(blobUrl && !isPdf && !isLikelyUnplayableInBrowser(mime));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(92vw,32rem)] max-h-[min(92dvh,100%)] overflow-hidden p-4 sm:p-5 z-[100]">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">
            {title}
            {path ? (
              <span className="block text-xs font-normal text-muted-foreground mt-1 truncate">
                {basename(path)}
                {fileBytes > 0 ? ` · ${(fileBytes / (1024 * 1024)).toFixed(2)} MB` : ""}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[8rem] flex-col items-stretch justify-center gap-3 rounded-lg bg-muted/40 p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading recording…
            </div>
          ) : error ? (
            <div className="space-y-3 py-4 text-center">
              <p className="text-sm text-destructive whitespace-pre-wrap px-2">{error}</p>
              <p className="text-xs text-muted-foreground px-2">
                If the file exists on the server, redeploy <code className="text-[10px]">api/files.php</code> and try again.
              </p>
            </div>
          ) : showAudio ? (
            <>
              <audio
                key={blobUrl}
                controls
                preload="auto"
                className="w-full"
                src={blobUrl}
                onLoadedMetadata={(e) => {
                  const el = e.currentTarget;
                  if (!Number.isFinite(el.duration) || el.duration <= 0) {
                    setPlayError("Audio loaded but duration is unknown — try Download if play fails.");
                  }
                }}
                onError={() =>
                  setPlayError(
                    "Browser could not decode this audio. Download the file and play it with VLC or on your phone.",
                  )
                }
              >
                Your browser does not support audio playback.
              </audio>
              {playError ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">{playError}</p>
              ) : null}
            </>
          ) : isPdf ? (
            <iframe
              title="Attachment"
              src={blobUrl}
              className="h-[min(60dvh,28rem)] w-full rounded border border-border bg-white"
            />
          ) : blobUrl ? (
            <div className="space-y-3 text-center py-4">
              <p className="text-sm text-muted-foreground px-2">
                {playError ||
                  `This format${mime ? ` (${mime})` : ""} cannot play in the browser.`}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">No recording loaded</p>
          )}

          {blobUrl ? (
            <div className="flex justify-end">
              <Button type="button" variant={showAudio || isPdf ? "ghost" : "default"} size="sm" className="gap-1.5" onClick={onDownload}>
                <Download className="h-3.5 w-3.5" />
                {showAudio || isPdf ? "Download" : "Download to play"}
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
