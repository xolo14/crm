/**
 * Plain-text editing for HTML email bodies (offer letter mail body).
 * HR types normal paragraphs; we store simple, safe HTML (<p> + <br>).
 * Placeholders like {{candidate_name}} pass through untouched.
 */

const ENTITY: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** True when the HTML only uses <p> and <br> (safe to round-trip through plain text). */
export function isSimpleMailHtml(html: string): boolean {
  const tags = String(html || "").match(/<\/?([a-zA-Z0-9]+)[^>]*>/g) || [];
  return tags.every((t) => /^<\/?(p|br)\s*\/?>$/i.test(t));
}

/** "<p>Dear X,</p><p>Line<br>two</p>" → "Dear X,\n\nLine\ntwo" */
export function mailHtmlToText(html: string): string {
  return String(html || "")
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITY[m] ?? m)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "Dear X,\n\nLine\ntwo" → "<p>Dear X,</p><p>Line<br>two</p>" (text is HTML-escaped). */
export function mailTextToHtml(text: string): string {
  const paras = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paras.map((p) => `<p>${escapeText(p).replace(/\n/g, "<br>")}</p>`).join("");
}
