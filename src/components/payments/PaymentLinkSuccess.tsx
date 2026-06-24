import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, Mail, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { sendPaymentLinkEmail } from "@/api/payment-links/sendEmail";
import type { RazorpayPaymentLink } from "@/types/paymentLinks";

interface Props {
  open: boolean;
  link: RazorpayPaymentLink | null;
  onClose: () => void;
}

export default function PaymentLinkSuccess({ open, link, onClose }: Props) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    if (open && link) {
      setEmailSent(false);
      setCopied(false);
      setSending(false);
    }
  }, [open, link?.id]);

  if (!open || !link) return null;

  const url = link.short_url || "";
  const customerEmail = link.customer?.email?.trim() ?? "";
  const canSendEmail = customerEmail.length > 0 && !!url;

  function copyLink() {
    if (!url) return;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  async function sendEmail() {
    if (!canSendEmail || sending) return;
    setSending(true);
    try {
      const result = await sendPaymentLinkEmail(link);
      setEmailSent(true);
      toast({
        title: "Email sent",
        description: `Payment link sent to ${result.to} from ${result.from}`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Email failed",
        description: err instanceof Error ? err.message : "Could not send email",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[440px] p-6 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 p-1 text-gray-400 hover:text-gray-600 rounded-lg"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div className="flex flex-col items-center text-center pt-2">
          <div className="h-14 w-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
            <CheckCircle2 size={32} className="text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Link Created!</h2>
          <p className="text-sm text-gray-500 mt-1 mb-5">
            Share this payment link with your customer
          </p>

          <div className="w-full rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 mb-5">
            <p className="text-xs text-gray-500 mb-1">Payment link URL</p>
            <p className="text-sm font-mono text-gray-900 break-all leading-relaxed">
              {url || "—"}
            </p>
          </div>

          {customerEmail ? (
            <p className="text-xs text-gray-500 -mt-3 mb-4 w-full text-left">
              Lead email: <span className="font-medium text-gray-700">{customerEmail}</span>
            </p>
          ) : (
            <p className="text-xs text-amber-600 -mt-3 mb-4 w-full text-left">
              No customer email on this link — add email when creating the link to use Send Email.
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-2 w-full">
            <button
              type="button"
              onClick={copyLink}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              <Copy size={16} />
              {copied ? "Copied!" : "Copy Link"}
            </button>
            <button
              type="button"
              onClick={() => void sendEmail()}
              disabled={!canSendEmail || sending || emailSent}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#0f2318] text-white text-sm font-medium hover:bg-[#1a3528] disabled:opacity-50"
            >
              {sending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Mail size={16} />
              )}
              {emailSent ? "Email Sent" : sending ? "Sending…" : "Send Email"}
            </button>
          </div>

          <p className="text-[11px] text-gray-400 mt-3 w-full">
            Email is sent from support@syncpedia.com with your Razorpay payment link.
          </p>

          <button
            type="button"
            onClick={onClose}
            className="mt-4 w-full py-2.5 rounded-lg bg-[#2563EB] text-white text-sm font-semibold hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
