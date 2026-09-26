export const VIDEO_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }
  for (const type of VIDEO_MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export function recordingSupported(): { ok: boolean; reason?: string } {
  if (typeof window === "undefined") return { ok: false, reason: "unsupported" };
  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    return { ok: false, reason: "insecure" };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "no-media" };
  }
  if (typeof MediaRecorder === "undefined") {
    return { ok: false, reason: "no-recorder" };
  }
  return { ok: true };
}

export function permissionErrorMessage(err: unknown): string {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
  const msg = err instanceof Error ? err.message : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera or microphone permission was denied. Allow both in your browser settings, then reload this page.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera or microphone was found. Connect a camera and mic, then retry.";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return "The camera or microphone is already in use by another app. Close that app and retry.";
  }
  if (name === "OverconstrainedError") {
    return "This camera does not support the requested settings. Retry with a different camera if you have one.";
  }
  if (name === "SecurityError" || name === "NotSupportedError") {
    return "This browser blocked camera access. Open this link in Chrome, Edge, or Safari over HTTPS.";
  }
  return msg || "Could not access camera and microphone.";
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
}

export function bothTracksLive(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  const video = stream.getVideoTracks().some((t) => t.readyState === "live" && t.enabled);
  const audio = stream.getAudioTracks().some((t) => t.readyState === "live" && t.enabled);
  return video && audio;
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
