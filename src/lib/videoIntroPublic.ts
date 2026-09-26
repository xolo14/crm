import { getApiBase } from "@/lib/apiBase";

type PublicDto = {
  id: string;
  candidate_name: string;
  position: string;
  status: string;
  max_duration_sec: number;
  max_retries: number;
  retry_count: number;
  retries_remaining: number;
  expires_at: string;
  submitted_at?: string | null;
  retention_days: number;
  org_name?: string;
};

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return { error: "Unexpected server response" };
  }
}

export async function videoIntroPublicAction(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${getApiBase()}/public-video-intro.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify(body),
  });
  const data = await readJson(res);
  if (!res.ok) {
    throw new Error(String(data.error || "Request failed"));
  }
  return data;
}

export async function videoIntroPublicPreview(token: string): Promise<{
  data: PublicDto;
  consent: { reviewers: string; storage: string; camera: string };
}> {
  const data = await videoIntroPublicAction({ action: "preview", token });
  return data as {
    data: PublicDto;
    consent: { reviewers: string; storage: string; camera: string };
  };
}

export async function videoIntroUploadChunks(opts: {
  token: string;
  sessionId: string;
  blob: Blob;
  chunkMax: number;
  onProgress?: (pct: number) => void;
}): Promise<void> {
  const total = opts.blob.size;
  let offset = 0;
  while (offset < total) {
    const end = Math.min(offset + opts.chunkMax, total);
    const slice = opts.blob.slice(offset, end);
    const res = await fetch(`${getApiBase()}/public-video-intro.php?action=chunk`, {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Intro-Token": opts.token,
        "X-Upload-Session": opts.sessionId,
        "X-Chunk-Offset": String(offset),
      },
      body: slice,
    });
    const data = await readJson(res);
    if (!res.ok) {
      throw new Error(String(data.error || "Upload failed"));
    }
    offset = end;
    opts.onProgress?.(Math.round((offset / total) * 100));
  }
}

export type { PublicDto as VideoIntroPublicDto };

export function videoIntroOrgLogoUrl(invite: { id?: string } | null | undefined): string {
  const id = String(invite?.id || "").trim();
  if (!id) return "";
  return `${getApiBase()}/public-video-intro.php?action=org_logo&id=${encodeURIComponent(id)}`;
}
