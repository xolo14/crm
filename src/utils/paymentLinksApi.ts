import type {
  CreatePaymentLinkForm,
  PaymentLinksListResult,
  RazorpayPaymentLink,
} from "@/types/paymentLinks";
import {
  explainPaymentLinksApiError,
  parseJsonBody,
  paymentLinksFetchInit,
  paymentLinksUrl,
} from "@/api/payment-links/client";
import { normalizePaymentLinksList } from "@/utils/normalizePaymentLink";
import {
  paymentLinkPeriodUnixRange,
  type PaymentLinkPeriod,
} from "@/utils/paymentLinkPeriod";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, paymentLinksFetchInit(options));
  } catch {
    throw new Error(
      "Cannot reach Payment Links API. Check your connection and api/config.php on the server.",
    );
  }

  const body = await parseJsonBody(res);
  const data = body as ApiEnvelope<T>;

  if (!res.ok || !data?.success) {
    throw new Error(explainPaymentLinksApiError(res, body));
  }
  return data.data as T;
}

export async function getAllPaymentLinks(filters?: {
  status?: string;
  from?: number;
  to?: number;
  count?: number;
  skip?: number;
  /** Applies Razorpay `from` / `to` on the server (paginated list). */
  period?: PaymentLinkPeriod;
}): Promise<PaymentLinksListResult> {
  const extra: Record<string, string> = {};
  if (filters?.status) extra.status = filters.status;

  let from = filters?.from;
  let to = filters?.to;
  if (filters?.period) {
    const range = paymentLinkPeriodUnixRange(filters.period);
    if (range.from !== undefined) from = range.from;
    if (range.to !== undefined) to = range.to;
  }
  if (from !== undefined) extra.from = String(from);
  if (to !== undefined) extra.to = String(to);
  if (filters?.count) extra.count = String(filters.count);
  if (filters?.skip) extra.skip = String(filters.skip);

  const cacheBust = `_=${Date.now()}`;
  const baseUrl = paymentLinksUrl("list", undefined, extra);
  const url = baseUrl.includes("?")
    ? `${baseUrl}&${cacheBust}`
    : `${baseUrl}?${cacheBust}`;
  const raw = await apiFetch<unknown>(url);
  return normalizePaymentLinksList(raw);
}

export async function getPaymentLink(
  id: string,
): Promise<RazorpayPaymentLink> {
  return apiFetch<RazorpayPaymentLink>(
    paymentLinksUrl("fetch", id),
  );
}

export async function createPaymentLink(
  form: CreatePaymentLinkForm,
): Promise<RazorpayPaymentLink> {
  const expireBy =
    form.expireInDays > 0
      ? Math.floor(Date.now() / 1000) + form.expireInDays * 86400
      : undefined;

  const notes: Record<string, string> = {};
  if (form.notes.trim()) notes.note = form.notes.trim();
  if (form.batchId) notes.batch_id = form.batchId;
  if (form.leadId) notes.lead_id = form.leadId;
  if (form.referralCode) notes.crm_referral = form.referralCode;

  return apiFetch<RazorpayPaymentLink>(paymentLinksUrl("create"), {
    method: "POST",
    body: JSON.stringify({
      amount: form.amount,
      description: form.description,
      customerName: form.customerName,
      customerEmail: form.customerEmail,
      customerPhone: form.customerPhone,
      referenceId: form.referenceId,
      expireBy,
      referralCode: form.referralCode,
      notes,
    }),
  });
}

export async function cancelPaymentLink(
  id: string,
): Promise<RazorpayPaymentLink> {
  return apiFetch<RazorpayPaymentLink>(paymentLinksUrl("cancel", id), {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function sendReminder(
  id: string,
  medium: "sms" | "email",
): Promise<{
  sent?: boolean;
  to?: string;
  from?: string;
  type?: string;
  channel?: string;
}> {
  return apiFetch(paymentLinksUrl("remind", id), {
    method: "POST",
    body: JSON.stringify({ medium }),
  });
}

export async function sendPaidFormLink(
  linkId: string,
  formId: string,
): Promise<{
  sent: boolean;
  to: string;
  from: string;
  form_id: string;
  form_name: string;
}> {
  return apiFetch(paymentLinksUrl("send_form_link"), {
    method: "POST",
    body: JSON.stringify({ link_id: linkId, form_id: formId }),
  });
}
