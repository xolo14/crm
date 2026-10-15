import { getApiBase } from "@/lib/apiBase";
import { paymentLinksFetchInit, paymentLinksUrl } from "@/api/payment-links/client";

export interface PaymentLinkCrmRecord {
  razorpay_payment_link_id: string;
  customer_name?: string;
  customer_email?: string;
  amount?: number;
  amount_paid?: number;
  status?: string;
  invoice_number?: string | null;
  invoice_sent_at?: string | null;
  invoice_sent_for_amount_paid?: number | null;
  has_invoice?: number | boolean;
  salesperson_id?: string;
  salesperson_referral_code?: string;
}

export function paymentLinkInvoiceDownloadUrl(linkId: string): string {
  return paymentLinksUrl("invoice", linkId);
}

/** CRM-stored payment links (invoice paths, sent flags). */
export async function fetchPaymentLinksCrmList(): Promise<
  PaymentLinkCrmRecord[]
> {
  const res = await fetch(
    `${getApiBase()}/payment-links.php?action=crm_list&_=${Date.now()}`,
    paymentLinksFetchInit(),
  );
  const body = await res.json();
  if (!res.ok || !body?.success) {
    return [];
  }
  return (body.data as PaymentLinkCrmRecord[]) ?? [];
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* ignore */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || null;
}

function safeCandidateFilePart(name?: string | null): string {
  const raw = String(name || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 60);
  return raw || "candidate";
}

/** Download invoice PDF (requires auth). Filename includes candidate name when known. */
export async function downloadPaymentLinkInvoice(
  linkId: string,
  opts?: { customerName?: string | null; invoiceNumber?: string | null },
): Promise<void> {
  const res = await fetch(paymentLinkInvoiceDownloadUrl(linkId), {
    ...paymentLinksFetchInit(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string })?.error ?? "Invoice not available",
    );
  }
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const blob = await res.blob();
  // Guard against legacy HTML invoices slipping through.
  if (ct.includes("text/html") || blob.type.includes("text/html")) {
    throw new Error("Invoice PDF could not be generated. Please try again.");
  }
  const pdfBlob =
    blob.type === "application/pdf"
      ? blob
      : new Blob([await blob.arrayBuffer()], { type: "application/pdf" });
  const fromHeader = filenameFromContentDisposition(
    res.headers.get("content-disposition"),
  );
  const candidate = safeCandidateFilePart(opts?.customerName);
  const inv = String(opts?.invoiceNumber || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 40);
  const fallback = inv
    ? `Invoice-${candidate}-${inv}.pdf`
    : `Invoice-${candidate}.pdf`;
  const url = URL.createObjectURL(pdfBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fromHeader && /\.pdf$/i.test(fromHeader) ? fromHeader : fallback;
  a.click();
  URL.revokeObjectURL(url);
}
