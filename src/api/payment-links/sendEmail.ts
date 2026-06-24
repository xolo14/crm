import type { RazorpayPaymentLink } from "@/types/paymentLinks";
import {
  explainPaymentLinksApiError,
  parseJsonBody,
  paymentLinksFetchInit,
  paymentLinksUrl,
} from "@/api/payment-links/client";

interface SendEmailResponse {
  success: boolean;
  data?: { sent: boolean; to: string; from: string };
  error?: string;
}

/**
 * POST /api/payment-links.php?action=send_email
 * Sends Razorpay-style payment request email from support@syncpedia.com to the lead.
 */
export async function sendPaymentLinkEmail(
  link: RazorpayPaymentLink,
): Promise<{ to: string; from: string }> {
  const customerEmail = link.customer?.email?.trim() ?? "";
  if (!customerEmail) {
    throw new Error("Customer email is missing on this payment link");
  }

  let res: Response;
  try {
    res = await fetch(
      paymentLinksUrl("send_email"),
      paymentLinksFetchInit({
        method: "POST",
        body: JSON.stringify({
          link_id: link.id,
          link,
        }),
      }),
    );
  } catch {
    throw new Error(
      "Cannot reach the server. Check SMTP settings in api/config.php (support@syncpedia.in).",
    );
  }

  const body = await parseJsonBody(res);
  const json = body as SendEmailResponse;

  if (!res.ok || !json.success || !json.data?.sent) {
    throw new Error(explainPaymentLinksApiError(res, body));
  }

  return { to: json.data.to, from: json.data.from };
}
