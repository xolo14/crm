import { Check, CheckCheck, FileText, XCircle } from "lucide-react";
import type { CommWhatsappMessage } from "@/types/communications";
import { cn } from "@/lib/utils";
import { formatMsgTime } from "./waUtils";

export default function MessageBubble({
  message,
  onRetry,
}: {
  message: CommWhatsappMessage;
  onRetry?: (m: CommWhatsappMessage) => void;
}) {
  const inbound = message.direction === "inbound";
  const status = String(message.status || "").toLowerCase();
  const failed = !inbound && status === "failed";
  const isTemplate =
    String(message.message_type || "").toLowerCase() === "template" || !!message.template_id;

  return (
    <div className={cn("flex w-full px-3 md:px-6", inbound ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "relative max-w-[min(85%,28rem)] rounded-lg px-2.5 py-1.5 text-[14.2px] leading-5 shadow-sm",
          inbound ? "bg-[var(--wa-in)] rounded-tl-none" : failed ? "bg-red-50 border border-red-200 rounded-tr-none" : "bg-[var(--wa-out)] rounded-tr-none",
        )}
      >
        {isTemplate ? (
          <span className="inline-block text-[10px] font-semibold uppercase tracking-wide text-[var(--wa-header)] mb-0.5">
            Template
          </span>
        ) : null}
        <p className="whitespace-pre-wrap break-words text-[#111b21]">{message.message_body || "—"}</p>
        {message.media_url ? (
          <a
            href={message.media_url}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--wa-header)] underline"
          >
            <FileText className="h-3.5 w-3.5" />
            Download media
          </a>
        ) : null}
        {failed && message.error_message ? (
          <p className="text-[11px] text-red-600 mt-1">{message.error_message}</p>
        ) : null}
        <div className="flex items-center justify-end gap-1 mt-0.5 min-h-[16px]">
          <span className="text-[10px] text-[var(--wa-muted)]">
            {formatMsgTime(message.meta_timestamp || message.sent_at || message.created_at)}
          </span>
          {!inbound ? <StatusTicks status={status} /> : null}
          {failed && onRetry ? (
            <button
              type="button"
              className="text-[10px] text-red-600 underline ml-1"
              onClick={() => onRetry(message)}
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatusTicks({ status }: { status: string }) {
  if (status === "failed") {
    return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  }
  if (status === "read") {
    return <CheckCheck className="h-3.5 w-3.5 text-[var(--wa-tick-read)]" />;
  }
  if (status === "delivered") {
    return <CheckCheck className="h-3.5 w-3.5 text-[var(--wa-tick)]" />;
  }
  return <Check className="h-3.5 w-3.5 text-[var(--wa-tick)]" />;
}
