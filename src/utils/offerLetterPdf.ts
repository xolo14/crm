/**
 * Build a PDF (base64, no data-URL prefix) from HTML — used when server Dompdf is unavailable.
 * Multi-page templates stored as full HTML docs separated by <!-- PAGE_BREAK --> are
 * rendered as separate A4 PDF pages (not stacked into one canvas).
 */

export const OFFER_PAGE_BREAK = "<!-- PAGE_BREAK -->";

export function splitOfferHtmlPages(html: string): string[] {
  const parts = String(html || "")
    .split(/<!--\s*PAGE_BREAK\s*-->/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [String(html || "")];
}

function ensureHtmlDocument(pageHtml: string): string {
  const raw = String(pageHtml || "").trim();
  if (/<html[\s>]/i.test(raw)) {
    // Ensure charset meta for reliable rendering
    if (!/<meta[^>]+charset=/i.test(raw)) {
      return raw.replace(/<head([^>]*)>/i, '<head$1><meta charset="UTF-8"/>');
    }
    return raw;
  }
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;">${raw}</body></html>`;
}

function extractBodyHtml(pageHtml: string): string {
  const wrapped = ensureHtmlDocument(pageHtml);
  const bodyMatch = wrapped.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : pageHtml;
}

function extractStyleBlocks(pageHtml: string): string {
  const parts: string[] = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pageHtml)) !== null) {
    const css = (m[1] || "").trim();
    if (css) parts.push(css);
  }
  return parts.join("\n");
}

function waitForImages(doc: Document, timeoutMs = 8000): Promise<void> {
  const imgs = Array.from(doc.images || []);
  if (imgs.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let remaining = imgs.length;
    const finish = () => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearTimeout(timer);
        resolve();
      }
    };
    const timer = window.setTimeout(() => resolve(), timeoutMs);
    imgs.forEach((img) => {
      if (img.complete) finish();
      else {
        img.addEventListener("load", finish, { once: true });
        img.addEventListener("error", finish, { once: true });
      }
    });
  });
}

/** One printable HTML document with real page breaks (for window.print). */
export function buildMultiPagePrintableHtml(html: string): string {
  const pages = splitOfferHtmlPages(html);
  if (pages.length <= 1) {
    return ensureHtmlDocument(pages[0] || html);
  }

  const styleParts = pages.map(extractStyleBlocks).filter(Boolean);
  const uniqueStyles = Array.from(new Set(styleParts));

  const sections = pages
    .map((page, i) => {
      const body = extractBodyHtml(page);
      const breakCss = i < pages.length - 1 ? "page-break-after:always;" : "page-break-after:auto;";
      return `<div class="offer-print-page" style="width:210mm;height:297mm;position:relative;overflow:hidden;margin:0 auto;background:#fff;${breakCss}">${body}</div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Offer Letter</title>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .offer-print-page { box-sizing: border-box; }
  ${uniqueStyles.join("\n")}
</style>
</head>
<body>
${sections}
</body>
</html>`;
}

/**
 * Render one full HTML page (with its own styles/letterhead) via an offscreen iframe.
 * More reliable than stuffing <style> into a div for absolute A4 letter layouts.
 */
async function renderPageElementToCanvas(
  pageHtml: string,
  html2canvas: typeof import("html2canvas").default,
): Promise<HTMLCanvasElement> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-offer-pdf-frame", "1");
  // A4 @ 96dpi ≈ 794 × 1123
  iframe.style.cssText =
    "position:fixed;left:-12000px;top:0;width:794px;height:1123px;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    throw new Error("Could not open PDF render frame");
  }

  try {
    doc.open();
    doc.write(ensureHtmlDocument(pageHtml));
    doc.close();
    await waitForImages(doc);

    // Let layout settle (fonts / absolute letterhead)
    await new Promise((r) => window.setTimeout(r, 50));

    const target = doc.body;
    target.style.margin = "0";
    target.style.width = "794px";
    target.style.minHeight = "1123px";
    target.style.background = "#ffffff";

    return await html2canvas(target, {
      scale: 1.5,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      width: 794,
      height: 1123,
      windowWidth: 794,
      windowHeight: 1123,
      foreignObjectRendering: false,
    });
  } finally {
    iframe.remove();
  }
}

export async function buildHtmlDocumentPdfBase64(html: string): Promise<string> {
  if (!html || !String(html).trim()) {
    throw new Error("Offer letter HTML is empty");
  }

  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const pages = splitOfferHtmlPages(html);
  if (pages.length === 0) {
    throw new Error("No offer letter pages to render");
  }

  const pdf = new jsPDF("p", "mm", "a4");
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pages.length; i++) {
    let canvas: HTMLCanvasElement;
    try {
      canvas = await renderPageElementToCanvas(pages[i], html2canvas);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`PDF page ${i + 1} of ${pages.length} failed: ${msg}`);
    }
    if (!canvas.width || !canvas.height) {
      throw new Error(`PDF page ${i + 1} rendered blank`);
    }
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    if (i > 0) pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, 0, pageW, pageH);
  }

  const dataUrl = pdf.output("datauristring") as string;
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  if (!b64 || b64.length < 100) {
    throw new Error("Generated PDF was empty");
  }
  return b64;
}
