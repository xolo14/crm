/**
 * Print + PDF export helpers for the payslip print template.
 *
 * - `printPayslip` uses the browser's native print dialog. The print template
 *   itself opts into print-only visibility via a `@media print` block, so
 *   the rest of the app is hidden during print.
 * - `exportPayslipPDF` rasterises the print template DOM node via html2canvas
 *   and embeds the resulting image into a single A4 page with jsPDF.
 */

import type { RefObject } from "react";

export async function printPayslip(_printRef: RefObject<HTMLDivElement>): Promise<void> {
  if (typeof window === "undefined") return;
  window.focus();
  window.print();
}

async function renderPayslipPdf(printRef: RefObject<HTMLDivElement>) {
  if (!printRef.current) {
    throw new Error("Payslip preview is not ready");
  }
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const canvas = await html2canvas(printRef.current, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "mm", "a4");
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  let finalW = imgW;
  let finalH = imgH;
  let x = 0;
  let y = 0;
  if (imgH > pageH) {
    finalH = pageH;
    finalW = (canvas.width * pageH) / canvas.height;
    x = (pageW - finalW) / 2;
    y = 0;
  }
  pdf.addImage(imgData, "PNG", x, y, finalW, finalH);
  return pdf;
}

/** Base64-encoded PDF bytes (no data-URL prefix) for email upload. */
export async function buildPayslipPdfBase64(printRef: RefObject<HTMLDivElement>): Promise<string> {
  const pdf = await renderPayslipPdf(printRef);
  const dataUrl = pdf.output("datauristring") as string;
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export async function exportPayslipPDF(
  printRef: RefObject<HTMLDivElement>,
  payslipID: string,
): Promise<void> {
  const pdf = await renderPayslipPdf(printRef);
  pdf.save(`${payslipID || "payslip"}.pdf`);
}
