import { Plus, Search } from "lucide-react";
import type { WaConversation } from "@/types/communications";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import ConversationCard from "./ConversationCard";

export default function ConversationList({
  conversations,
  activeId,
  searchQuery,
  onSearchChange,
  onSelect,
  onNewChat,
  connecting,
  loading,
}: {
  conversations: WaConversation[];
  activeId: string | null;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onSelect: (c: WaConversation) => void;
  onNewChat: () => void;
  connecting?: boolean;
  loading?: boolean;
}) {
  return (
    <aside className="wa-list-pane flex flex-col shrink-0 h-full w-full md:w-[32%] md:min-w-[240px] md:max-w-[360px] lg:w-[30%] lg:min-w-[280px] lg:max-w-[380px] border-r border-[var(--wa-border)] bg-[var(--wa-panel)] min-h-0">
      <div className="px-3 py-3 bg-[var(--wa-header)] text-white shrink-0">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="font-semibold text-base">Chats</h2>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1 bg-white/15 hover:bg-white/25 text-white border-0"
            onClick={onNewChat}
          >
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--wa-muted)]" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search name or number"
            className="pl-9 h-10 bg-white border-0 text-[#111b21]"
          />
        </div>
        {connecting ? <p className="text-[11px] text-amber-200 mt-2">Connecting…</p> : null}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {loading ? (
          <p className="p-4 text-sm text-[var(--wa-muted)]">Loading chats…</p>
        ) : conversations.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--wa-muted)]">
            No conversations yet.
            <br />
            Click + New Chat to start.
          </div>
        ) : (
          conversations.map((c) => (
            <ConversationCard
              key={c.id}
              conversation={c}
              active={activeId === c.id}
              onClick={() => onSelect(c)}
            />
          ))
        )}
      </div>
    </aside>
  );
}
