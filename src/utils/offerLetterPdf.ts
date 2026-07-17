/**
 * Build a PDF (base64, no data-URL prefix) from HTML — used when server Dompdf is unavailable.
 */
export async function buildHtmlDocumentPdfBase64(html: string): Promise<string> {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const host = document.createElement("div");
  host.setAttribute("data-offer-pdf-host", "1");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;color:#000;z-index:-1;overflow:hidden;";
  const wrapped =
    /<html[\s>]/i.test(html)
      ? html
      : `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.45;color:#111;">${html}</body></html>`;

  // Prefer injecting body content into a div (html2canvas cannot reliably paint full HTML documents).
  const bodyMatch = wrapped.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  host.innerHTML = bodyMatch ? bodyMatch[1] : html;
  document.body.appendChild(host);

  try {
    const canvas = await html2canvas(host, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: 794,
    });

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    const pxPerMm = canvas.width / pageW;

    // Multi-page if content is taller than one A4
    if (imgH <= pageH) {
      pdf.addImage(imgData, "PNG", 0, 0, imgW, imgH);
    } else {
      const pageCanvas = document.createElement("canvas");
      const pageCtx = pageCanvas.getContext("2d");
      if (!pageCtx) {
        throw new Error("Could not create PDF canvas");
      }
      const sliceH = Math.floor(pageH * pxPerMm);
      pageCanvas.width = canvas.width;
      let offsetY = 0;
      let first = true;
      while (offsetY < canvas.height) {
        const h = Math.min(sliceH, canvas.height - offsetY);
        pageCanvas.height = h;
        pageCtx.clearRect(0, 0, pageCanvas.width, h);
        pageCtx.drawImage(canvas, 0, offsetY, canvas.width, h, 0, 0, canvas.width, h);
        const sliceData = pageCanvas.toDataURL("image/png");
        const sliceMm = (h * pageW) / canvas.width;
        if (!first) pdf.addPage();
        pdf.addImage(sliceData, "PNG", 0, 0, pageW, sliceMm);
        first = false;
        offsetY += h;
      }
    }

    const dataUrl = pdf.output("datauristring") as string;
    const comma = dataUrl.indexOf(",");
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  } finally {
    host.remove();
  }
}
