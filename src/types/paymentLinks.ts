export type PaymentLinkStatus =
  | "created"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "expired";

export type PaymentType = "one_time" | "subscription";

export interface RazorpayCustomer {
  name: string;
  email: string;
  contact: string;
}

export interface RazorpayPayment {
  payment_id: string;
  amount: number; // paise
  status: string;
  created_at: number;
  method: string;
}

export interface RazorpayPaymentLink {
  id: string;
  amount: number; // paise
  amount_paid: number; // paise
  currency: string;
  description: string;
  status: PaymentLinkStatus;
  short_url: string;
  created_at: number; // unix seconds
  expire_by?: number;
  reference_id: string;
  customer: RazorpayCustomer;
  payments?: RazorpayPayment[];
  notes: Record<string, string>;
  reminder_enable: boolean;
}

/** Form payload used by CreateLinkModal. */
export interface CreatePaymentLinkForm {
  batchId: string;
  leadId: string;
  amount: number;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  referenceId: string;
  /** 0 = no expiry. */
  expireInDays: number;
  notes: string;
  /** Logged-in member referral code (sent to Razorpay notes). */
  referralCode: string;
}

/** Razorpay list endpoint shape. */
export interface PaymentLinksListResult {
  entity?: string;
  count?: number;
  items: RazorpayPaymentLink[];
}

/** KPI summary derived client-side from the links list. */
export interface PaymentLinkStats {
  totalLinks: number;
  totalCollected: number; // rupees
  pending: number;
  paid: number;
  cancelled: number;
  expired: number;
}
