/** Shared runtime helpers for public Lead / Document forms. */

export type FormCloseMeta = {
  close_at?: unknown;
  response_limit?: unknown;
  submission_count?: unknown;
  allow_multiple_responses?: unknown;
  send_receipt?: unknown;
  payment_enabled?: unknown;
  payment_amount?: unknown;
  payment_gst_enabled?: unknown;
  payment_handling_enabled?: unknown;
  payment_coupon_enabled?: unknown;
  payment_coupon_code?: unknown;
  allow_another_response?: unknown;
  show_progress_bar?: unknown;
  shuffle_questions?: unknown;
  shuffle_options?: unknown;
  edit_after_submit?: unknown;
  confirmation_message?: unknown;
  collect_email?: unknown;
  is_quiz?: unknown;
};

/** Stable shuffle so the respondent doesn't see the order jump while filling. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const arr = [...items];
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = arr.length - 1; i > 0; i--) {
    h = (Math.imul(h, 16807) + 0x7fffffff) % 2147483647;
    const j = h % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function parseCloseAt(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formClosedReason(meta: FormCloseMeta | Record<string, unknown> | null | undefined): string | null {
  const m = (meta || {}) as FormCloseMeta;
  const closeAt = parseCloseAt(m.close_at);
  if (closeAt && Date.now() > closeAt.getTime()) {
    return "This form is no longer accepting responses.";
  }
  const limit = Number(m.response_limit);
  const count = Number(m.submission_count);
  if (Number.isFinite(limit) && limit > 0 && Number.isFinite(count) && count >= limit) {
    return "This form has reached its response limit.";
  }
  return null;
}

function oneResponseStorageKey(formId: string) {
  return `form_one_response_${String(formId || "").trim()}`;
}

export function hasLocalOneResponse(formId: string): boolean {
  if (!formId || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(oneResponseStorageKey(formId)) === "1";
  } catch {
    return false;
  }
}

export function markLocalOneResponse(formId: string): void {
  if (!formId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(oneResponseStorageKey(formId), "1");
  } catch {
    /* private mode */
  }
}

export function quizScore(
  items: Array<{ points?: number; required?: boolean; type?: string }>,
  answered: (item: (typeof items)[number]) => boolean,
): { earned: number; total: number } {
  let earned = 0;
  let total = 0;
  for (const item of items) {
    const pts = Number(item.points) || 0;
    if (pts <= 0) continue;
    if (item.type === "section_break" || item.type === "image" || item.type === "video") continue;
    total += pts;
    if (answered(item)) earned += pts;
  }
  return { earned, total };
}
