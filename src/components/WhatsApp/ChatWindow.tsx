import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, LayoutTemplate, UserPlus } from "lucide-react";
import type { CommWhatsappMessage, WaAssignableMember, WaConversation } from "@/types/communications";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import MessageBubble from "./MessageBubble";
import MessageInput from "./MessageInput";
import { assignableRoleLabel, convDisplayName, formatWindowCountdown, isWindowOpen } from "./waUtils";

export default function ChatWindow({
  conversation,
  messages,
  loading,
  messageInput,
  onMessageInputChange,
  onSend,
  sending,
  onBack,
  onOpenTemplates,
  onRetry,
  readOnlyFreeText,
  tick,
  keyboardOffset = 0,
  canAssign = false,
  assignableMembers = [],
  assigning = false,
  onAssign,
}: {
  conversation: WaConversation | null;
  messages: CommWhatsappMessage[];
  loading?: boolean;
  messageInput: string;
  onMessageInputChange: (v: string) => void;
  onSend: () => void;
  sending?: boolean;
  onBack?: () => void;
  onOpenTemplates: () => void;
  onRetry?: (m: CommWhatsappMessage) => void;
  readOnlyFreeText?: boolean;
  /** Re-render countdown */
  tick?: number;
  keyboardOffset?: number;
  canAssign?: boolean;
  assignableMembers?: WaAssignableMember[];
  assigning?: boolean;
  onAssign?: (assignedTo: string | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const open = isWindowOpen(conversation);
  const countdown = formatWindowCountdown(conversation?.window_expires_at);
  void tick;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, conversation?.id]);

  if (!conversation) {
    return (
      <section className="wa-chat-pane hidden md:flex flex-1 w-full min-w-0 min-h-0 items-center justify-center wa-inbox-chat-bg text-[var(--wa-muted)] text-sm">
        Select a chat to start messaging
      </section>
    );
  }

  const leadId = conversation.lead_id || null;
  const isDraft = conversation.id.startsWith("draft-");
  const showAssign = canAssign && !isDraft && typeof onAssign === "function";

  return (
    <section className="wa-chat-pane flex flex-col flex-1 w-full min-w-0 min-h-0 h-full bg-[var(--wa-panel)]">
      <header className="shrink-0 px-3 py-2.5 bg-[var(--wa-header)] text-white flex items-center gap-2">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white hover:bg-white/15 shrink-0 md:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate leading-tight">{convDisplayName(conversation)}</p>
          <p className="text-xs text-white/80 truncate">{conversation.contact_phone}</p>
          <p className="text-[11px] mt-0.5 text-white/90">
            {open && countdown && countdown !== "expired"
              ? `✅ Window open — expires in ${countdown}`
              : "⚠️ Window closed — use template"}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 self-center">
          {showAssign ? (
            <Select
              value={conversation.assigned_to || "none"}
              onValueChange={(v) => onAssign(v === "none" ? null : v)}
              disabled={assigning}
            >
              <SelectTrigger
                className="h-8 w-[7.5rem] sm:w-[9.5rem] bg-white/10 border-white/25 text-white text-xs gap-1 px-2 [&>svg]:text-white/80 [&>span]:truncate"
                aria-label="Assign chat"
              >
                <UserPlus className="h-3.5 w-3.5 shrink-0 opacity-90" />
                <SelectValue placeholder="Assign" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="none">Unassigned</SelectItem>
                {assignableMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name} · {assignableRoleLabel(m.role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2 md:px-2 text-white hover:bg-white/15 gap-1"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Templates</span>
          </Button>
          {leadId ? (
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 md:px-2 text-white hover:bg-white/15 gap-1" asChild>
              <Link to={`/leads-management?lead=${encodeURIComponent(leadId)}`}>
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">View Lead</span>
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <div ref={scrollRef} className="wa-msg-scroll wa-inbox-chat-bg py-3 space-y-1.5">
        {loading ? (
          <p className="text-center text-sm text-[var(--wa-muted)] py-10">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-[var(--wa-muted)] py-10">No messages yet</p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} onRetry={onRetry} />)
        )}
      </div>

      <MessageInput
        value={messageInput}
        onChange={onMessageInputChange}
        onSend={onSend}
        sending={sending}
        windowClosed={!open}
        readOnlyFreeText={readOnlyFreeText}
        onOpenTemplates={onOpenTemplates}
        keyboardOffset={keyboardOffset}
      />
    </section>
  );
}
