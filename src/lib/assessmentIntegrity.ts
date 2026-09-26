export const FAST_ANSWER_MS = 4000;

export type IntegritySnapshot = {
  tab_hides: number;
  hidden_ms: number;
  blurs: number;
  fast_answers: number;
  extension_dom: number;
  resize_devtools: number;
};

export function emptyIntegrity(): IntegritySnapshot {
  return {
    tab_hides: 0,
    hidden_ms: 0,
    blurs: 0,
    fast_answers: 0,
    extension_dom: 0,
    resize_devtools: 0,
  };
}

export function isFastAnswer(shownAt: number, answeredAt: number, floorMs = FAST_ANSWER_MS): boolean {
  if (!shownAt || answeredAt < shownAt) return false;
  return answeredAt - shownAt < floorMs;
}

const EXT_NAMES = ["monica", "grammarly", "chatgpt", "immersive-translate"];

export function isExtensionInjection(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  const id = (el.id || "").toLowerCase();
  const cls = typeof el.className === "string" ? el.className.toLowerCase() : "";
  const src = (el.getAttribute("src") || el.getAttribute("href") || "").toLowerCase();
  if (
    src.includes("chrome-extension://") ||
    src.includes("moz-extension://") ||
    src.includes("edge-extension://")
  ) {
    return true;
  }
  if (id.includes("extension") || cls.includes("extension") || tag.includes("extension")) {
    return true;
  }
  return EXT_NAMES.some((w) => id.includes(w) || cls.includes(w) || tag.includes(w));
}

export function isDevtoolsChromeGap(
  outerW: number,
  innerW: number,
  outerH: number,
  innerH: number,
  threshold = 160,
): boolean {
  return outerW - innerW > threshold || outerH - innerH > threshold;
}

export function pingIntegrityBeacon(apiBase: string, token: string, payload: Record<string, unknown>): void {
  if (!token) return;
  const url = `${apiBase}/assessments.php?action=integrity_ping`;
  const body = JSON.stringify({ attempt_token: token, ...payload });
  try {
    const blob = new Blob([body], { type: "application/json" });
    if (typeof navigator !== "undefined" && navigator.sendBeacon && navigator.sendBeacon(url, blob)) {
      return;
    }
  } catch {
    /* fetch fallback */
  }
  void fetch(url, {
    method: "POST",
    body,
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
  }).catch(() => undefined);
}

