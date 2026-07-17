import { useEffect, useState } from "react";
import { CreditCard, FileText, Loader2, Mail } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { RazorpayPaymentLink } from "@/types/paymentLinks";
import { sendPaidFormLink } from "@/utils/paymentLinksApi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AvailableForm {
  id: string;
  name: string;
  slug: string;
  is_active?: boolean | number | string;
}

interface Props {
  link: RazorpayPaymentLink | null;
  onClose: () => void;
  onReminder: (id: string, medium: "email") => Promise<void>;
}

function isActiveForm(form: AvailableForm): boolean {
  return form.is_active === true || form.is_active === 1 || form.is_active === "1";
}

export default function PaymentMailDialog({ link, onClose, onReminder }: Props) {
  const { toast } = useToast();
  const [forms, setForms] = useState<AvailableForm[]>([]);
  const [selectedFormId, setSelectedFormId] = useState("");
  const [loadingForms, setLoadingForms] = useState(false);
  const [sending, setSending] = useState<"reminder" | "form" | null>(null);

  const isPaid = link?.status === "paid";
  const canRemind =
    link?.status === "created" || link?.status === "partially_paid";

  useEffect(() => {
    setSelectedFormId("");
    setForms([]);
    if (!link || link.status !== "paid") return;

    let cancelled = false;
    setLoadingForms(true);
    void api.forms
      .list()
      .then((response: { data?: AvailableForm[] }) => {
        if (cancelled) return;
        const active = (response?.data ?? []).filter(isActiveForm);
        setForms(active);
        if (active.length === 1) setSelectedFormId(active[0].id);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast({
          variant: "destructive",
          title: "Could not load forms",
          description: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingForms(false);
      });
    return () => {
      cancelled = true;
    };
  }, [link, toast]);

  async function handleReminder() {
    if (!link || !canRemind) return;
    setSending("reminder");
    try {
      await onReminder(link.id, "email");
      onClose();
    } finally {
      setSending(null);
    }
  }

  async function handleFormLink() {
    if (!link || !isPaid || !selectedFormId) return;
    setSending("form");
    try {
      const result = await sendPaidFormLink(link.id, selectedFormId);
      toast({
        title: "Form link sent",
        description: `${result.form_name} was emailed to ${result.to}.`,
      });
      onClose();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Form email failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSending(null);
    }
  }

  return (
    <Dialog open={!!link} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send customer email
          </DialogTitle>
          <DialogDescription>
            {link?.customer?.email
              ? `Recipient: ${link.customer.email}`
              : "This payment link has no customer email."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <section className={`rounded-xl border p-4 ${canRemind ? "bg-white" : "bg-gray-50 opacity-70"}`}>
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 h-5 w-5 text-blue-600" />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-gray-900">Razorpay reminder</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Send the Razorpay payment link and outstanding amount.
                </p>
                {!canRemind && (
                  <p className="mt-2 text-xs font-medium text-amber-700">
                    Available only while payment is pending.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void handleReminder()}
                  disabled={!canRemind || sending !== null || !link?.customer?.email}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending === "reminder" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send reminder
                </button>
              </div>
            </div>
          </section>

          <section className={`rounded-xl border p-4 ${isPaid ? "bg-white" : "bg-gray-50 opacity-70"}`}>
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-gray-900">Form link mail</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Select an available form and email its public link.
                </p>
                {!isPaid ? (
                  <p className="mt-2 text-xs font-medium text-amber-700">
                    Available only after payment is fully paid.
                  </p>
                ) : loadingForms ? (
                  <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading forms…
                  </div>
                ) : (
                  <>
                    <select
                      value={selectedFormId}
                      onChange={(event) => setSelectedFormId(event.target.value)}
                      className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                      aria-label="Select form"
                    >
                      <option value="">Select a form</option>
                      {forms.map((form) => (
                        <option key={form.id} value={form.id}>
                          {form.name}
                        </option>
                      ))}
                    </select>
                    {forms.length === 0 && (
                      <p className="mt-2 text-xs text-gray-500">No active forms are available.</p>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleFormLink()}
                      disabled={!selectedFormId || sending !== null || !link?.customer?.email}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sending === "form" && <Loader2 className="h-4 w-4 animate-spin" />}
                      Send form link
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
