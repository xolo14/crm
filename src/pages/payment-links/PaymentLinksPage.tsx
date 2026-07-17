import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import type {
  PaymentLinkStats as Stats,
  RazorpayPaymentLink,
} from "@/types/paymentLinks";
import {
  cancelPaymentLink as apiCancel,
  getAllPaymentLinks,
  sendReminder as apiRemind,
} from "@/utils/paymentLinksApi";
import { normalizePaymentLink } from "@/utils/normalizePaymentLink";
import {
  filterLinksByPeriod,
  type PaymentLinkPeriod,
} from "@/utils/paymentLinkPeriod";
import PaymentLinkStats from "@/components/paymentLinks/PaymentLinkStats";
import PaymentLinksTable, {
  type TableFilters,
} from "@/components/paymentLinks/PaymentLinksTable";
import CreatePaymentLinkModal from "@/components/payments/CreatePaymentLinkModal";
import PaymentLinkSuccess from "@/components/payments/PaymentLinkSuccess";
import LinkDetailModal from "@/components/paymentLinks/LinkDetailModal";
import PaymentMailDialog from "@/components/paymentLinks/PaymentMailDialog";

const initialFilters: TableFilters = {
  status: "",
  paymentType: "",
  from: "",
  to: "",
  search: "",
  assignee: "",
};

const POLL_INTERVAL_MS = 20_000;

export default function PaymentLinksPage() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const referralCode = profile?.referral_code?.trim() ?? "";
  const pollInFlight = useRef(false);

  const [links, setLinks] = useState<RazorpayPaymentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PaymentLinkPeriod>("all");
  const [filters, setFilters] = useState<TableFilters>(initialFilters);
  const [createOpen, setCreateOpen] = useState(false);
  const [successLink, setSuccessLink] = useState<RazorpayPaymentLink | null>(
    null,
  );
  const [detailLink, setDetailLink] = useState<RazorpayPaymentLink | null>(
    null,
  );
  const [mailLink, setMailLink] = useState<RazorpayPaymentLink | null>(null);

  const loadLinks = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await getAllPaymentLinks({ period });
        setLinks(res.items ?? []);
        if (!silent) {
          setError(null);
        }
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : "Failed to load links");
          setLinks([]);
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [period],
  );

  const refreshLinksQuiet = useCallback(() => {
    if (pollInFlight.current) return;
    pollInFlight.current = true;
    void loadLinks({ silent: true }).finally(() => {
      pollInFlight.current = false;
    });
  }, [loadLinks]);

  useEffect(() => {
    void loadLinks();
  }, [loadLinks]);

  useEffect(() => {
    if (searchParams.get("status") !== "paid") return;
    void loadLinks();
    const next = new URLSearchParams(searchParams);
    next.delete("status");
    setSearchParams(next, { replace: true });
  }, [loadLinks, searchParams, setSearchParams]);

  const hasPendingLinks = useMemo(
    () =>
      links.some(
        (l) => l.status === "created" || l.status === "partially_paid",
      ),
    [links],
  );

  useEffect(() => {
    if (!hasPendingLinks) return;
    const timer = window.setInterval(() => {
      refreshLinksQuiet();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasPendingLinks, refreshLinksQuiet]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshLinksQuiet();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshLinksQuiet]);

  const periodLinks = useMemo(
    () => filterLinksByPeriod(links, period),
    [links, period],
  );

  const stats: Stats = useMemo(
    () => ({
      totalLinks: periodLinks.length,
      totalCollected: periodLinks
        .filter((l) => l.status === "paid" || l.status === "partially_paid")
        .reduce((s, l) => s + l.amount_paid / 100, 0),
      pending: periodLinks.filter((l) => l.status === "created" || l.status === "partially_paid").length,
      paid: periodLinks.filter((l) => l.status === "paid").length,
      cancelled: periodLinks.filter((l) => l.status === "cancelled").length,
      expired: periodLinks.filter((l) => l.status === "expired").length,
    }),
    [periodLinks],
  );

  const copyShortUrl = useCallback(
    (url: string) => {
      if (!url) return;
      navigator.clipboard
        .writeText(url)
        .then(() =>
          toast({
            title: "Copied",
            description: "Payment link URL copied to clipboard",
          }),
        )
        .catch(() =>
          toast({
            variant: "destructive",
            title: "Copy failed",
            description: "Clipboard access was blocked by your browser.",
          }),
        );
    },
    [toast],
  );

  const handleCreateSuccess = useCallback(
    (link: RazorpayPaymentLink) => {
      const normalized = normalizePaymentLink(link);
      setLinks((prev) => {
        const without = prev.filter((l) => l.id !== normalized.id);
        return [normalized, ...without];
      });
      setCreateOpen(false);
      setSuccessLink(normalized);
      if (normalized.short_url) {
        navigator.clipboard.writeText(normalized.short_url).catch(() => {});
      }
    },
    [],
  );

  const handleSuccessClose = useCallback(() => {
    setSuccessLink(null);
    void loadLinks();
  }, [loadLinks]);

  const handleCancel = useCallback(
    async (id: string) => {
      if (!window.confirm("Cancel this payment link?")) return;
      try {
        await apiCancel(id);
        setLinks((prev) =>
          prev.map((l) =>
            l.id === id ? { ...l, status: "cancelled" as const } : l,
          ),
        );
        toast({ title: "Payment link cancelled" });
        setDetailLink((d) =>
          d && d.id === id ? { ...d, status: "cancelled" as const } : d,
        );
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Cancel failed",
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [toast],
  );

  const handleRemind = useCallback(
    async (id: string, medium: "sms" | "email") => {
      try {
        const res = await apiRemind(id, medium);
        const data = res as { from?: string; type?: string; to?: string };
        if (medium === "email") {
          toast({
            title: "Email reminder sent",
            description:
              data.type === "partial_balance"
                ? `Balance-due reminder sent from ${data.from ?? "support@syncpedia.in"} to ${data.to ?? "customer"}.`
                : `Reminder sent from ${data.from ?? "support@syncpedia.in"} to ${data.to ?? "customer"}.`,
          });
        } else {
          toast({
            title: "SMS reminder sent",
            description: "Razorpay SMS reminder dispatched to the customer phone.",
          });
        }
      } catch (err) {
        toast({
          variant: "destructive",
          title: "Reminder failed",
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [toast],
  );

  return (
    <div className="p-6 bg-[#f9fafb] min-h-full">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payment Links</h1>
          <p className="text-sm text-gray-500 mt-1">
            Razorpay payment links
            {referralCode ? (
              <>
                {" "}
                · Referral code:{" "}
                <span className="font-semibold text-[#2ed573] font-mono">
                  {referralCode}
                </span>
              </>
            ) : (
              <span className="text-amber-600">
                {" "}
                · No referral code on your profile
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 bg-[#2563EB] text-white font-semibold px-5 py-2.5 rounded-xl text-sm hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus size={16} />
            Create Payment Link
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5 text-sm text-red-700">
          <strong>Error:</strong> {error}
          <button
            type="button"
            onClick={() => void loadLinks()}
            className="ml-3 underline text-red-600 font-medium"
          >
            Retry
          </button>
        </div>
      )}

      <PaymentLinkStats stats={stats} loading={loading} />

      <PaymentLinksTable
        links={links}
        loading={loading}
        period={period}
        onPeriodChange={setPeriod}
        filters={filters}
        onFilterChange={setFilters}
        onViewDetail={setDetailLink}
        onCancel={handleCancel}
        onEmail={setMailLink}
        onRefresh={() => void loadLinks()}
        onCopyShortUrl={copyShortUrl}
        onCreate={() => setCreateOpen(true)}
      />

      <CreatePaymentLinkModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={handleCreateSuccess}
      />

      <PaymentLinkSuccess
        open={!!successLink}
        link={successLink}
        onClose={handleSuccessClose}
      />

      <PaymentMailDialog
        link={mailLink}
        onClose={() => setMailLink(null)}
        onReminder={handleRemind}
      />

      {detailLink && (
        <LinkDetailModal
          link={detailLink}
          onClose={() => setDetailLink(null)}
          onCancel={handleCancel}
          onRemind={handleRemind}
          onCopyShortUrl={copyShortUrl}
        />
      )}
    </div>
  );
}
