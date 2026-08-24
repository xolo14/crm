/**
 * Rasterise a certificate preview DOM node into a PDF (base64, no data-URL prefix).
 */
export async function buildCertificatePdfBase64(
  el: HTMLElement,
  page: { widthMm: number; heightMm: number },
): Promise<string> {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: "#ffffff",
    logging: false,
  });

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
