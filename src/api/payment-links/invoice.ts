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

/** Download invoice PDF (requires auth). */
export async function downloadPaymentLinkInvoice(
  linkId: string,
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
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `invoice-${linkId.replace(/^plink_/, "")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
