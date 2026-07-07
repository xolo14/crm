import { Link2, Plus, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { canAccessPaymentRecords } from "@/lib/orgAccess";
import type { RazorpayPaymentLink } from "@/types/paymentLinks";
import PaymentLinkCard from "./PaymentLinkCard";

interface Props {
  links: RazorpayPaymentLink[];
  loading: boolean;
  onViewDetail: (link: RazorpayPaymentLink) => void;
  onCancel: (id: string) => void;
  onRemind: (id: string, medium: "sms" | "email") => void;
  onRefresh: () => void;
  onCopyShortUrl: (url: string) => void;
  onCreate: () => void;
}

const RECENT_LIMIT = 10;

function SkeletonCard() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 rounded bg-gray-100" />
          <div className="h-3 w-44 rounded bg-gray-100" />
        </div>
        <div className="h-6 w-16 rounded-full bg-gray-100" />
      </div>
      <div className="h-6 w-28 rounded bg-gray-100 mt-3" />
      <div className="h-3 w-40 rounded bg-gray-100 mt-2" />
    </div>
  );
}

export default function PaymentLinksOverview({
  links,
  loading,
  onViewDetail,
  onCancel,
  onRemind,
  onRefresh,
  onCopyShortUrl,
  onCreate,
}: Props) {
  const { user } = useAuth();
  const showRecordsLink = canAccessPaymentRecords(user?.role ?? null);
  const recent = links.slice(0, RECENT_LIMIT);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-900">Recent Links</h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="p-2 rounded-lg text-gray-500 hover:bg-white border border-transparent hover:border-gray-200 transition-all disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : recent.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-2xl px-6 py-16 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
            <Link2 size={22} />
          </div>
          <p className="text-base font-semibold text-gray-900 mt-3">
            No payment links yet
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Create your first payment link to share with a customer.
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="mt-5 inline-flex items-center gap-2 bg-[#2ed573] text-[#0f2318] font-semibold px-4 py-2 rounded-xl text-sm hover:bg-[#22c265] transition-colors shadow-sm"
          >
            <Plus size={16} />
            Create Payment Link
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recent.map((link) => (
              <PaymentLinkCard
                key={link.id}
                link={link}
                onViewDetail={onViewDetail}
                onCancel={onCancel}
                onRemind={onRemind}
                onCopyShortUrl={onCopyShortUrl}
              />
            ))}
          </div>
          {links.length > RECENT_LIMIT && showRecordsLink && (
            <div className="mt-4 text-right">
              <Link
                to="/payments/records"
                className="text-sm font-semibold text-[#0f2318] hover:underline"
              >
                View all in Payment Records →
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
