/**
 * Rasterise a certificate preview DOM node into a PDF (base64, no data-URL prefix).
 */
export async function buildCertificatePdfBase64(
  el: HTMLElement,
  page: { widthMm: number; heightMm: number },
  opts?: { widthPx?: number; heightPx?: number },
): Promise<string> {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const widthPx = Math.max(
    1,
    Math.round(opts?.widthPx ?? (el.offsetWidth || el.scrollWidth || 1123)),
  );
  const heightPx = Math.max(
    1,
    Math.round(opts?.heightPx ?? (el.offsetHeight || el.scrollHeight || 794)),
  );

  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    allowTaint: false,
    backgroundColor: "#ffffff",
    logging: false,
    width: widthPx,
    height: heightPx,
    windowWidth: widthPx,
    windowHeight: heightPx,
    foreignObjectRendering: false,
    imageTimeout: 15000,
  });

  if (!canvas.width || !canvas.height) {
    throw new Error("Certificate rendered as a blank page (zero-size canvas). Try again or use an image background.");
  }

  // Reject near-empty canvases (all white / almost no ink).
  try {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const sample = ctx.getImageData(
        0,
        0,
        Math.min(canvas.width, 64),
        Math.min(canvas.height, 64),
      ).data;
      let nonWhite = 0;
      for (let i = 0; i < sample.length; i += 16) {
        const r = sample[i];
        const g = sample[i + 1];
        const b = sample[i + 2];
        const a = sample[i + 3];
        if (a > 8 && (r < 250 || g < 250 || b < 250)) nonWhite += 1;
      }
      if (nonWhite < 3) {
        throw new Error(
          "Certificate PDF looks blank. Wait for the preview to load, or use an image background (PDF backgrounds cannot be captured).",
        );
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("blank")) throw e;
  }

  const imgData = canvas.toDataURL("image/png");
  const orient = page.widthMm >= page.heightMm ? "l" : "p";
  const pdf = new jsPDF(orient, "mm", [page.widthMm, page.heightMm]);
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  pdf.addImage(imgData, "PNG", 0, 0, pageW, pageH);
  const dataUrl = pdf.output("datauristring") as string;
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** CSS px for certificate page at ~96dpi (html2canvas layout). */
export function certPageSizePx(page: { widthMm: number; heightMm: number }): {
  widthPx: number;
  heightPx: number;
} {
  const PX_PER_MM = 96 / 25.4;
  return {
    widthPx: Math.round(page.widthMm * PX_PER_MM),
    heightPx: Math.round(page.heightMm * PX_PER_MM),
  };
}
