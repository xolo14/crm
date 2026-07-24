import type { WaConversation } from "@/types/communications";
import { cn } from "@/lib/utils";
import { convDisplayName, formatMsgTime, isWindowOpen, previewText } from "./waUtils";

export default function ConversationCard({
  conversation,
  active,
  onClick,
}: {
  conversation: WaConversation;
  active: boolean;
  onClick: () => void;
}) {
  const unread = Number(conversation.unread_count || 0);
  const open = isWindowOpen(conversation);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-3 flex gap-3 border-b border-[var(--wa-border)] transition-colors",
        active ? "bg-[var(--wa-active)]" : "hover:bg-[#f5f6f6]",
      )}
    >
      <div className="relative h-12 w-12 rounded-full bg-[#dfe5e7] flex items-center justify-center shrink-0 text-[var(--wa-header)] font-semibold">
        {convDisplayName(conversation).slice(0, 1).toUpperCase()}
        <span
          className={cn(
            "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white",
            open ? "bg-[var(--wa-send)]" : "bg-[var(--wa-tick)]",
          )}
          title={open ? "24h window open" : "Window closed"}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium text-[15px] text-[#111b21] truncate">{convDisplayName(conversation)}</p>
          <span className="text-[11px] text-[var(--wa-muted)] shrink-0">
            {formatMsgTime(conversation.last_message_at)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-[13px] text-[var(--wa-muted)] truncate">{previewText(conversation)}</p>
          {unread > 0 ? (
            <span className="min-w-5 h-5 px-1.5 rounded-full bg-[var(--wa-send)] text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </div>
        {conversation.assigned_to_name ? (
          <p className="text-[11px] text-[var(--wa-header)] mt-0.5 truncate">→ {conversation.assigned_to_name}</p>
        ) : conversation.started_by_name ? (
          <p className="text-[11px] text-[var(--wa-muted)] mt-0.5 truncate">by {conversation.started_by_name}</p>
        ) : (
          <p className="text-[11px] text-amber-700 mt-0.5 truncate">Unassigned</p>
        )}
      </div>
    </button>
  );
}
