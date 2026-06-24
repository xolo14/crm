import { useCallback, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { createStandardPaymentLink } from "@/api/payment-links/create";
import type { RazorpayPaymentLink } from "@/types/paymentLinks";
import type {
  StandardPaymentLinkFormState,
  StandardPaymentLinkPayload,
} from "@/types/standardPaymentLink";

function buildPayload(
  form: StandardPaymentLinkFormState,
  salespersonId: string,
  referralCode: string,
  salespersonName?: string,
): StandardPaymentLinkPayload {
  const amountPaise = Math.round(Number(form.amount) * 100);

  const notes: Record<string, string> = {
    salesperson_id: salespersonId,
    referral_code: referralCode,
    crm_referral: referralCode,
  };
  if (salespersonName?.trim()) {
    notes.salesperson_name = salespersonName.trim();
  }
  if (form.batchId) notes.batch_id = form.batchId;
  if (form.leadId) notes.lead_id = form.leadId;
  for (const n of form.notes) {
    const k = n.key.trim();
    const v = n.value.trim();
    if (k) notes[k] = v;
  }

  const customer: StandardPaymentLinkPayload["customer"] = {
    name: form.full_name.trim(),
  };
  const email = form.email.trim();
  const digits = form.phone.replace(/\D/g, "");
  const contact =
    digits.length > 0 ? `${form.countryCode}${digits}` : undefined;
  if (email) customer.email = email;
  if (contact) customer.contact = contact;

  const payload: StandardPaymentLinkPayload = {
    amount: amountPaise,
    currency: "INR",
    description: form.description.trim() || undefined,
    customer,
    notify: {
      sms: form.notifySms && !!contact,
      email: form.notifyEmail && !!email,
    },
    reminder_enable: !form.noExpiry,
    reference_id: form.referenceId.trim() || undefined,
    accept_partial: form.partialEnabled,
    notes,
  };

  if (!form.noExpiry && form.expiryDate) {
    const end = new Date(`${form.expiryDate}T23:59:59`);
    payload.expire_by = Math.floor(end.getTime() / 1000);
  }

  if (form.partialEnabled) {
    payload.first_min_partial_amount = Math.round(
      Number(form.minPartialAmount) * 100,
    );
  }

  return payload;
}

export function useCreatePaymentLink() {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createLink = useCallback(
    async (
      form: StandardPaymentLinkFormState,
    ): Promise<RazorpayPaymentLink> => {
      if (!user?.id) {
        throw new Error("You must be logged in to create a payment link");
      }

      setLoading(true);
      setError(null);
      try {
        const payload = buildPayload(
          form,
          user.id,
          form.referralCode.trim() || profile?.referral_code?.trim() || "",
          profile?.full_name?.trim(),
        );
        const link = await createStandardPaymentLink(payload);
        return link;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Create failed";
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [user?.id, profile?.referral_code],
  );

  return { createLink, loading, error, clearError: () => setError(null) };
}
