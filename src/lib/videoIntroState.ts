export const VIDEO_INTRO_STATUSES = [
  "created",
  "opened",
  "recording",
  "submitted",
  "expired",
  "revoked",
] as const;

export type VideoIntroStatus = (typeof VIDEO_INTRO_STATUSES)[number];

export type VideoIntroAction =
  | "preview"
  | "consent"
  | "start"
  | "complete"
  | "revoke"
  | "regenerate"
  | "expire";

export function isHighEntropyToken(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 32) return false;
  if (/\s/.test(t)) return false;
  return /^[A-Za-z0-9_-]+$/.test(t);
}

export function effectiveVideoIntroStatus(row: {
  status: string;
  expires_at?: string | null;
  nowMs?: number;
}): VideoIntroStatus {
  const status = String(row.status || "created").toLowerCase() as VideoIntroStatus;
  if (status === "submitted" || status === "revoked") return status;
  const exp = String(row.expires_at || "").trim();
  if (exp) {
    const ts = Date.parse(exp.includes("T") ? exp : exp.replace(" ", "T"));
    const now = row.nowMs ?? Date.now();
    if (Number.isFinite(ts) && ts < now) return "expired";
  }
  return VIDEO_INTRO_STATUSES.includes(status) ? status : "created";
}

export function previewMustNotOpen(status: VideoIntroStatus): boolean {
  return status === "created";
}

export function canCandidateAct(status: VideoIntroStatus): boolean {
  return status === "created" || status === "opened" || status === "recording";
}

export function nextStatusAfter(action: VideoIntroAction, status: VideoIntroStatus): VideoIntroStatus | null {
  if (action === "preview") return status;
  if (action === "expire") {
    if (status === "submitted" || status === "revoked") return status;
    return "expired";
  }
  if (action === "revoke") {
    if (status === "revoked") return "revoked";
    return "revoked";
  }
  if (action === "regenerate") {
    if (status === "submitted") return null;
    return "created";
  }
  if (action === "consent") {
    if (!canCandidateAct(status) || status === "submitted") return null;
    if (status === "created") return "opened";
    return status;
  }
  if (action === "start") {
    if (!canCandidateAct(status)) return null;
    return "recording";
  }
  if (action === "complete") {
    if (status === "submitted") return null;
    if (!canCandidateAct(status) && status !== "recording") return null;
    return "submitted";
  }
  return null;
}

export function retriesRemaining(maxRetries: number, retryCount: number): number {
  return Math.max(0, maxRetries - retryCount);
}

export function canRetryTake(invite: {
  retries_remaining?: number | null;
  max_retries?: number;
  retry_count?: number;
} | null | undefined): boolean {
  if (!invite) return false;
  if (typeof invite.retries_remaining === "number") {
    return invite.retries_remaining > 0;
  }
  return retriesRemaining(invite.max_retries ?? 3, invite.retry_count ?? 0) > 0;
}
