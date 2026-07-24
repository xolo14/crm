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
]);

const ALLOWED_STYLES = new Set(["font-family", "font-size", "font-weight", "font-style", "text-decoration", "color"]);

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
