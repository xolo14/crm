import razorpay from "../config/razorpay";

export interface CreatePaymentLinkInput {
  amount: number; // rupees (converted to paise internally)
  currency?: string;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  referenceId?: string;
  /** Unix timestamp (seconds). Optional. */
  expireBy?: number;
  reminderEnable?: boolean;
  notes?: Record<string, string>;
}

export interface FetchAllInput {
  from?: number;
  to?: number;
  status?: string;
  count?: number;
  skip?: number;
}

/** CREATE PAYMENT LINK */
export async function createPaymentLink(input: CreatePaymentLinkInput) {
  const {
    amount,
    currency = "INR",
    description,
    customerName,
    customerEmail,
    customerPhone,
    referenceId,
    expireBy,
    reminderEnable = true,
    notes = {},
  } = input;

  const callbackBase = process.env.CLIENT_URL ?? "http://localhost:8080";

  const payload: Record<string, unknown> = {
    amount: Math.round(amount * 100),
    currency,
    description,
    reference_id: referenceId,
    customer: {
      name: customerName,
      email: customerEmail,
      contact: customerPhone,
    },
    notify: { sms: true, email: true },
    reminder_enable: reminderEnable,
    notes: {
      ...notes,
      crm_referral:
        (typeof notes.crm_referral === "string" && notes.crm_referral.trim()) ||
        process.env.CRM_REFERRAL_CODE ||
        "",
      created_by: "SYNCPedia CRM",
    },
    callback_url: `${callbackBase}/payments?status=paid`,
    callback_method: "get",
  };
  if (expireBy) {
    payload.expire_by = expireBy;
  }

  return razorpay.paymentLink.create(payload as never);
}

/** FETCH ALL PAYMENT LINKS */
export async function fetchAllPaymentLinks(filters: FetchAllInput = {}) {
  const { from, to, status, count = 25, skip = 0 } = filters;
  const params: Record<string, unknown> = { count, skip };
  if (from) params.from = from;
  if (to) params.to = to;
  if (status) params.status = status;

  return razorpay.paymentLink.all(params as never);
}

/** FETCH ONE PAYMENT LINK */
export async function fetchPaymentLink(paymentLinkId: string) {
  return razorpay.paymentLink.fetch(paymentLinkId);
}

/** CANCEL PAYMENT LINK */
export async function cancelPaymentLink(paymentLinkId: string) {
  return razorpay.paymentLink.cancel(paymentLinkId);
}

/** SEND REMINDER (medium: "sms" | "email") */
export async function sendReminder(
  paymentLinkId: string,
  medium: "sms" | "email",
) {
  return razorpay.paymentLink.notifyBy(paymentLinkId, medium);
}

/** FETCH PAYMENTS FOR A LINK (payments are nested in fetch response). */
export async function fetchPaymentsForLink(paymentLinkId: string) {
  const link = (await razorpay.paymentLink.fetch(
    paymentLinkId,
  )) as unknown as { payments?: unknown[] };
  return link.payments ?? [];
}

/** Standard Razorpay payment link — amount already in paise. */
export interface StandardPaymentLinkInput {
  amount: number;
  currency?: string;
  description?: string;
  customer: {
    name: string;
    email?: string;
    contact?: string;
  };
  notify: { sms: boolean; email: boolean };
  reminder_enable: boolean;
  expire_by?: number;
  reference_id?: string;
  accept_partial?: boolean;
  first_min_partial_amount?: number;
  notes?: Record<string, string>;
}

export async function createStandardPaymentLink(
  input: StandardPaymentLinkInput,
) {
  const callbackBase = process.env.CLIENT_URL ?? "http://localhost:8080";

  const customer: Record<string, string> = { name: input.customer.name };
  if (input.customer.email) customer.email = input.customer.email;
  if (input.customer.contact) customer.contact = input.customer.contact;

  const payload: Record<string, unknown> = {
    amount: Math.round(input.amount),
    currency: input.currency ?? "INR",
    customer,
    notify: {
      sms: input.notify.sms,
      email: input.notify.email,
    },
    reminder_enable: input.reminder_enable,
    notes: {
      ...(input.notes ?? {}),
      created_by: "SYNCPedia CRM",
    },
    callback_url: `${callbackBase}/payments?status=paid`,
    callback_method: "get",
  };

  if (input.description) payload.description = input.description;
  if (input.reference_id) payload.reference_id = input.reference_id;
  if (input.expire_by) payload.expire_by = input.expire_by;

  if (input.accept_partial) {
    payload.accept_partial = true;
    if (input.first_min_partial_amount != null) {
      payload.first_min_partial_amount = Math.round(
        input.first_min_partial_amount,
      );
    }
  }

  console.log("[RAZORPAY] Creating standard payment link:", {
    amount: payload.amount,
    partial: input.accept_partial,
    customer: input.customer.email ?? input.customer.name,
  });

  const link = await razorpay.paymentLink.create(payload as never);
  console.log("[RAZORPAY] Link created:", {
    id: (link as { id?: string }).id,
    short_url: (link as { short_url?: string }).short_url,
  });
  return link;
}
