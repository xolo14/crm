/** Payload sent to POST /api/payment-links/create (amount in paise). */
export interface StandardPaymentLinkPayload {
  amount: number;
  currency: "INR";
  description?: string;
  customer: {
    name: string;
    email?: string;
    contact?: string;
  };
  notify: {
    sms: boolean;
    email: boolean;
  };
  reminder_enable: boolean;
  expire_by?: number;
  reference_id?: string;
  accept_partial?: boolean;
  first_min_partial_amount?: number;
  notes: Record<string, string>;
}

export interface NotePair {
  key: string;
  value: string;
}

export interface StandardPaymentLinkFormState {
  batchId: string;
  leadId: string;
  amount: string;
  description: string;
  full_name: string;
  email: string;
  notifyEmail: boolean;
  phone: string;
  countryCode: string;
  notifySms: boolean;
  referenceId: string;
  noExpiry: boolean;
  expiryDate: string;
  partialEnabled: boolean;
  minPartialAmount: string;
  referralCode: string;
  notes: NotePair[];
}

export const EMPTY_STANDARD_FORM: StandardPaymentLinkFormState = {
  batchId: "",
  leadId: "",
  amount: "",
  description: "",
  full_name: "",
  email: "",
  notifyEmail: true,
  phone: "",
  countryCode: "+91",
  notifySms: false,
  referenceId: "",
  noExpiry: true,
  expiryDate: "",
  partialEnabled: false,
  minPartialAmount: "",
  referralCode: "",
  notes: [],
};
