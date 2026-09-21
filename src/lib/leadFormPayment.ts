/** Paid / not-paid status for lead-form Razorpay collections. */

export type LeadFormPaymentInfo = {
  required: boolean;
  status: "paid" | "not_paid" | "none";
  amount?: number;
  linkId?: string;
};

export const LEAD_FORM_GST_RATE = 0.18;
export const LEAD_FORM_HANDLING_RATE = 0.02;

export type LeadFormPaymentBreakdown = {
  /** Original form amount (before coupon). */
  originalBase: number;
  /** Amount charged after coupon (0 if coupon applied). */
  base: number;
  gst: number;
  handling: number;
  total: number;
  gstEnabled: boolean;
  handlingEnabled: boolean;
  couponApplied: boolean;
  couponCode?: string;
};

function parseTags(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  try {
    const o = JSON.parse(String(raw));
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function leadFormPaymentInfo(lead: any): LeadFormPaymentInfo {
  const fromApi = String(lead?.form_payment_status || "").toLowerCase();
  if (fromApi === "paid" || fromApi === "partially_paid") {
    return {
      required: true,
      status: "paid",
      amount: Number(lead.form_payment_amount) || undefined,
      linkId: String(lead.form_payment_link_id || "").trim() || undefined,
    };
  }
  if (
    fromApi === "created" ||
    fromApi === "not_paid" ||
    fromApi === "cancelled" ||
    fromApi === "expired"
  ) {
    return {
      required: true,
      status: "not_paid",
      amount: Number(lead.form_payment_amount) || undefined,
      linkId: String(lead.form_payment_link_id || "").trim() || undefined,
    };
  }
  const tags = parseTags(lead?.tags);
  const linkId = String(tags.payment_link_id || "").trim();
  const tagStatus = String(tags.payment_status || "").toLowerCase();
  if (linkId || tagStatus === "paid" || tagStatus === "not_paid" || tagStatus === "created") {
    return {
      required: true,
      status: tagStatus === "paid" || tagStatus === "partially_paid" ? "paid" : "not_paid",
      amount: Number(tags.payment_amount) || undefined,
      linkId: linkId || undefined,
    };
  }
  return { required: false, status: "none" };
}

export function formatInrAmount(amount: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "₹0";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function leadFormPaymentBadge(lead: any): { label: string; paid: boolean } | null {
  const info = leadFormPaymentInfo(lead);
  if (info.status === "none") return null;
  const amt = formatInrAmount(info.amount);
  if (info.status === "paid") {
    return { label: amt ? `Paid ${amt}` : "Paid", paid: true };
  }
  return { label: amt ? `Not paid ${amt}` : "Not paid", paid: false };
}

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Compute payable total from form meta + optional applied coupon.
 * Coupon zeros the base amount only. GST / handling always use the original amount.
 */
export function computeLeadFormPaymentBreakdown(
  meta: Record<string, unknown> | null | undefined,
  opts?: { couponApplied?: boolean; couponCode?: string },
): LeadFormPaymentBreakdown | null {
  if (!meta?.payment_enabled) return null;
  const baseRaw = Number(meta.payment_amount);
  if (!Number.isFinite(baseRaw) || baseRaw <= 0) return null;
  const originalBase = roundMoney(baseRaw);
  const couponApplied = !!opts?.couponApplied;
  const base = couponApplied ? 0 : originalBase;
  const gstEnabled = !!meta.payment_gst_enabled;
  const handlingEnabled = !!meta.payment_handling_enabled;
  // Fees are always on the original amount — coupon does not reduce GST/handling.
  const gst = gstEnabled ? roundMoney(originalBase * LEAD_FORM_GST_RATE) : 0;
  const handling = handlingEnabled ? roundMoney(originalBase * LEAD_FORM_HANDLING_RATE) : 0;
  return {
    originalBase,
    base,
    gst,
    handling,
    total: roundMoney(base + gst + handling),
    gstEnabled,
    handlingEnabled,
    couponApplied,
    couponCode: opts?.couponCode?.trim() || undefined,
  };
}

export function normalizeCouponCode(raw: unknown): string {
  return String(raw || "").trim().toUpperCase();
}

export function couponMatchesForm(
  meta: Record<string, unknown> | null | undefined,
  entered: string,
): boolean {
  if (!meta?.payment_coupon_enabled) return false;
  const expected = normalizeCouponCode(meta.payment_coupon_code);
  const got = normalizeCouponCode(entered);
  return expected !== "" && got !== "" && expected === got;
}
