const ALLOWED_TAGS = new Set([
  "DIV",
  "P",
  "BR",
  "SPAN",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "UL",
  "OL",
  "LI",
  "FONT",
  "A",
]);

const ALLOWED_STYLES = new Set(["font-family", "font-size", "font-weight", "font-style", "text-decoration", "color"]);

/** Only web / mail / phone links survive sanitising; everything else (javascript:, data:) is dropped. */
export function sanitizeLinkHref(raw: string): string {
  const href = String(raw || "").trim();
  if (!href) return "";
  if (/^(https?:)?\/\//i.test(href)) return href.startsWith("//") ? `https:${href}` : href;
  if (/^(mailto:|tel:)/i.test(href)) return href;
  // "www.example.com" or "example.com/path" typed without a scheme.
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(href)) return `https://${href}`;
  return "";
}

const URL_IN_TEXT_RE = /(https?:\/\/[^\s<]+|www\.[^\s<]+\.[a-z]{2,}[^\s<]*)/gi;

/** Plain text → escaped HTML with bare URLs turned into safe links (used for question hints). */
export function linkifyPlainText(text: string): string {
  const raw = String(text || "");
  if (!raw) return "";
  let out = "";
  let last = 0;
  for (const m of raw.matchAll(URL_IN_TEXT_RE)) {
    const idx = m.index ?? 0;
    out += escapeText(raw.slice(last, idx));
    const trailing = m[0].match(/[.,;:!?)]+$/)?.[0] || "";
    const url = m[0].slice(0, m[0].length - trailing.length);
    const href = sanitizeLinkHref(url);
    out += href
      ? `<a href="${escapeText(href)}" target="_blank" rel="noopener noreferrer">${escapeText(url)}</a>${escapeText(trailing)}`
      : escapeText(m[0]);
    last = idx + m[0].length;
  }
  out += escapeText(raw.slice(last));
  return out.replace(/\r?\n/g, "<br>");
}

export function textHasLink(text: string): boolean {
  return URL_IN_TEXT_RE.test(String(text || ""));
}

export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || "").trim());
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Convert plain text (with newlines) into simple HTML blocks. */
export function plainTextToDescriptionHtml(text: string): string {
  const raw = String(text || "");
  if (!raw) return "";
  return raw
    .split(/\r?\n/)
    .map((line) => `<div>${line ? escapeText(line) : "<br>"}</div>`)
    .join("");
}

function sanitizeStyle(style: string): string {
  const parts: string[] = [];
  for (const decl of String(style || "").split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (!ALLOWED_STYLES.has(prop) || !val) continue;
    if (/expression|url\s*\(|javascript:/i.test(val)) continue;
    parts.push(`${prop}: ${val}`);
  }
  return parts.join("; ");
}

function sanitizeNode(node: Node, out: DocumentFragment | Element): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.appendChild(document.createTextNode(node.textContent || ""));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (!ALLOWED_TAGS.has(tag)) {
    for (const child of Array.from(el.childNodes)) sanitizeNode(child, out);
    return;
  }

  if (tag === "A") {
    const href = sanitizeLinkHref(el.getAttribute("href") || "");
    if (!href) {
      // Unsafe or empty link: keep the text, drop the anchor.
      for (const child of Array.from(el.childNodes)) sanitizeNode(child, out);
      return;
    }
    const a = document.createElement("a");
    a.setAttribute("href", href);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    const style = sanitizeStyle(el.getAttribute("style") || "");
    if (style) a.setAttribute("style", style);
    for (const child of Array.from(el.childNodes)) sanitizeNode(child, a);
    if (!a.textContent?.trim()) a.textContent = href;
    out.appendChild(a);
    return;
  }

  const clean = document.createElement(tag === "FONT" ? "span" : tag.toLowerCase());
  if (tag === "FONT") {
    const face = el.getAttribute("face");
    const size = el.getAttribute("size");
    const color = el.getAttribute("color");
    const styles: string[] = [];
    if (face) styles.push(`font-family: ${face}`);
    if (color && /^#?[0-9a-f]{3,8}$/i.test(color.trim())) styles.push(`color: ${color}`);
    if (size) {
      const map: Record<string, string> = {
        "1": "10px",
        "2": "13px",
        "3": "16px",
        "4": "18px",
        "5": "24px",
        "6": "32px",
        "7": "48px",
      };
      styles.push(`font-size: ${map[size] || "16px"}`);
    }
    if (styles.length) clean.setAttribute("style", styles.join("; "));
  } else {
    const style = sanitizeStyle(el.getAttribute("style") || "");
    if (style) clean.setAttribute("style", style);
  }

  for (const child of Array.from(el.childNodes)) sanitizeNode(child, clean);
  out.appendChild(clean);
}

/** Allowlist-sanitize description HTML for editor + public render. */
export function sanitizeFormDescriptionHtml(html: string): string {
  const raw = String(html || "").trim();
  if (!raw) return "";
  if (typeof DOMParser === "undefined") return escapeText(raw);
  const doc = new DOMParser().parseFromString(raw, "text/html");
  const frag = document.createDocumentFragment();
  for (const child of Array.from(doc.body.childNodes)) sanitizeNode(child, frag);
  const wrap = document.createElement("div");
  wrap.appendChild(frag);
  return wrap.innerHTML;
}

export function descriptionToEditorHtml(value: string): string {
  const raw = String(value || "");
  if (!raw.trim()) return "";
  if (looksLikeHtml(raw)) return sanitizeFormDescriptionHtml(raw);
  return plainTextToDescriptionHtml(raw);
}

export function descriptionPlainPreview(value: string): string {
  const raw = String(value || "");
  if (!raw) return "";
  if (!looksLikeHtml(raw)) return raw;
  if (typeof DOMParser === "undefined") return raw.replace(/<[^>]+>/g, " ");
  const doc = new DOMParser().parseFromString(raw, "text/html");
  return (doc.body.textContent || "").trim();
}
