import type { StandardPaymentLinkPayload } from "@/types/standardPaymentLink";
import type { RazorpayPaymentLink } from "@/types/paymentLinks";
import {
  explainPaymentLinksApiError,
  parseJsonBody,
  paymentLinksFetchInit,
  paymentLinksUrl,
} from "@/api/payment-links/client";
import { normalizePaymentLink } from "@/utils/normalizePaymentLink";

interface CreateResponse {
  success: boolean;
  data?: RazorpayPaymentLink;
  error?: string;
  errors?: string[];
}

/**
 * POST /api/payment-links.php?action=create
 * Amount must already be in paise.
 */
export async function createStandardPaymentLink(
  payload: StandardPaymentLinkPayload,
): Promise<RazorpayPaymentLink> {
  let res: Response;
  try {
    res = await fetch(
      paymentLinksUrl("create"),
      paymentLinksFetchInit({
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  } catch {
    throw new Error(
      "Cannot reach Payment Links API. Check api/config.php Razorpay keys on the server.",
    );
  }

  const body = await parseJsonBody(res);
  const json = body as CreateResponse;

  if (!res.ok || !json.success || !json.data) {
    throw new Error(explainPaymentLinksApiError(res, body));
  }

  return normalizePaymentLink(json.data);
}
