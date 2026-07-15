import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessageSquare, Send, UserPlus, Users } from "lucide-react";
import { communicationsApi } from "@/services/communications";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

function formatWhen(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function roleLabel(role?: string) {
  const r = String(role || "").toLowerCase();
  if (r === "sales_representative" || r === "sales_rep") return "Sales";
  if (r.startsWith("marketing")) return "Marketing";
  return role || "Member";
}

export default function WhatsAppChatInbox({ connected }: { connected: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [reply, setReply] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: convRes, isLoading: convLoading } = useQuery({
    queryKey: ["comm", "conversations"],
    queryFn: () => communicationsApi.conversations(80),
    enabled: connected,
    refetchInterval: connected ? 15000 : false,
  });

  const canAssign = Boolean(convRes?.can_assign);
  const scope = convRes?.scope || "mine";
  const conversations = convRes?.data ?? [];

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId],
  );

  useEffect(() => {
    if (conversations.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !conversations.some((c) => c.id === selectedId)) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations, selectedId]);

  const { data: membersRes } = useQuery({
    queryKey: ["comm", "assignable-members"],
    queryFn: () => communicationsApi.assignableMembers(),
    enabled: connected && canAssign,
  });
  const members = membersRes?.data ?? [];

  const { data: threadRes, isLoading: threadLoading } = useQuery({
    queryKey: ["comm", "messages", selectedId],
    queryFn: () => communicationsApi.messages(100, selectedId!),
    enabled: connected && !!selectedId,
    refetchInterval: selectedId ? 10000 : false,
  });
  const thread = threadRes?.data ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.length, selectedId]);

  const assignMutation = useMutation({
    mutationFn: ({ conversationId, assignedTo }: { conversationId: string; assignedTo: string | null }) =>
      communicationsApi.assignConversation(conversationId, assignedTo),
    onSuccess: () => {
      toast({ title: "Chat assignment updated" });
      qc.invalidateQueries({ queryKey: ["comm", "conversations"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message || "Assign failed" }),
  });

  const replyMutation = useMutation({
    mutationFn: () =>
      communicationsApi.sendWhatsappReply({
        recipient_phone: selected!.contact_phone,
        recipient_name: selected?.contact_name || undefined,
        message: reply.trim(),
        lead_id: selected?.lead_id || undefined,
      }),
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["comm", "messages", selectedId] });
      qc.invalidateQueries({ queryKey: ["comm", "conversations"] });
    },
    onError: (e: Error) => {
      // Meta may have accepted the message even when CRM save/response fails — refresh the thread.
      qc.invalidateQueries({ queryKey: ["comm", "messages", selectedId] });
      qc.invalidateQueries({ queryKey: ["comm", "conversations"] });
      toast({ variant: "destructive", title: e.message || "Reply failed" });
    },
  });

  const openChat = (id: string) => {
    setSelectedId(id);
    setMobileShowChat(true);
  };

  if (!connected) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Connect WhatsApp for your organization to use the shared inbox.
      </div>
    );
  }

  const showList = !isMobile || !mobileShowChat;
  const showPane = !isMobile || mobileShowChat;

  return (
    <CardShell>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-b shrink-0">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary shrink-0" />
            WhatsApp inbox
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {scope === "org"
              ? "Managers see every chat on the org number. Assign threads to sales or marketing."
              : "You only see chats you started or that a manager assigned to you."}
          </p>
        </div>
        <Badge variant="secondary" className="w-fit shrink-0">
          {conversations.length} chat{conversations.length === 1 ? "" : "s"}
        </Badge>
      </div>

      {/* Height clears hub bottom nav + keyboard chrome on mobile */}
      <div className="flex w-full min-w-0 h-[calc(100dvh-11.5rem)] max-h-[640px] md:h-[min(70dvh,560px)]">
        {/* Conversation list */}
        {showList ? (
          <aside
            className={cn(
              "flex flex-col min-h-0 border-border/60 bg-muted/30",
              isMobile ? "w-full" : "w-[280px] shrink-0 border-r",
            )}
          >
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {convLoading ? (
                <p className="p-4 text-sm text-muted-foreground">Loading chats…</p>
              ) : conversations.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No chats yet
                </div>
              ) : (
                conversations.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => openChat(c.id)}
                    className={cn(
                      "w-full text-left px-3 py-3 border-b border-border/40 transition-colors",
                      selectedId === c.id
                        ? "bg-background border-l-[3px] border-l-primary shadow-sm"
                        : "hover:bg-background/70 border-l-[3px] border-l-transparent",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium truncate">
                        {c.contact_name || c.contact_phone}
                      </p>
                      {(c.unread_count || 0) > 0 ? (
                        <Badge className="h-5 min-w-5 px-1.5 text-[10px] shrink-0">{c.unread_count}</Badge>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">{c.contact_phone}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
                      {c.last_message_preview || "—"}
                    </p>
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {c.assigned_to_name ? (
                        <Badge variant="outline" className="text-[10px]">→ {c.assigned_to_name}</Badge>
                      ) : c.started_by_name ? (
                        <Badge variant="secondary" className="text-[10px]">by {c.started_by_name}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-200">
                          Unassigned
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {formatWhen(c.last_message_at)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>
        ) : null}

        {/* Thread pane */}
        {showPane ? (
          <section className="flex flex-col min-h-0 min-w-0 flex-1 bg-background">
            {!selected ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-6">
                Select a chat from the list
              </div>
            ) : (
              <>
                <div className="px-3 py-2.5 border-b shrink-0 space-y-2">
                  <div className="flex items-start gap-2">
                    {isMobile ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        onClick={() => setMobileShowChat(false)}
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">
                        {selected.contact_name || selected.contact_phone}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{selected.contact_phone}</p>
                    </div>
                  </div>
                  {canAssign ? (
                    <div className="flex items-center gap-2">
                      <UserPlus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <Select
                        value={selected.assigned_to || "none"}
                        onValueChange={(v) =>
                          assignMutation.mutate({
                            conversationId: selected.id,
                            assignedTo: v === "none" ? null : v,
                          })
                        }
                        disabled={assignMutation.isPending}
                      >
                        <SelectTrigger className="h-9 w-full max-w-xs">
                          <SelectValue placeholder="Assign to…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Unassigned</SelectItem>
                          {members.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.full_name} · {roleLabel(m.role)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-2 bg-muted/15">
                  {threadLoading ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Loading messages…</p>
                  ) : thread.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No messages in this thread</p>
                  ) : (
                    thread.map((m) => {
                      const inbound = m.direction === "inbound";
                      const failed = !inbound && String(m.status || "").toLowerCase() === "failed";
                      return (
                        <div
                          key={m.id}
                          className={cn("flex w-full", inbound ? "justify-start" : "justify-end")}
                        >
                          <div
                            className={cn(
                              "max-w-[min(85%,420px)] rounded-2xl px-3 py-2 text-sm shadow-sm",
                              inbound
                                ? "bg-card border rounded-tl-sm"
                                : failed
                                  ? "bg-destructive/10 border border-destructive/30 text-foreground rounded-tr-sm"
                                  : "bg-primary text-primary-foreground rounded-tr-sm",
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words">{m.message_body || "—"}</p>
                            {failed && m.error_message ? (
                              <p className="text-[11px] text-destructive mt-1.5 leading-snug">
                                {m.error_message}
                              </p>
                            ) : null}
                            <p
                              className={cn(
                                "text-[10px] mt-1",
                                inbound || failed ? "text-muted-foreground" : "text-primary-foreground/70",
                              )}
                            >
                              {!inbound && m.sender_name ? `${m.sender_name} · ` : ""}
                              {formatWhen(m.meta_timestamp || m.sent_at || m.created_at)}
                              {!inbound && m.status ? ` · ${m.status}` : ""}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>

                <p className="px-3 py-1.5 text-[11px] text-muted-foreground leading-snug border-t bg-muted/10 shrink-0">
                  Free text works only after the customer messages you (Meta 24h window).
                </p>

                <div className="sticky bottom-0 z-10 p-3 border-t flex gap-2 shrink-0 bg-background supports-[backdrop-filter]:bg-background/95 backdrop-blur">
                  <Input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Type a reply…"
                    className="h-11 min-w-0 flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && reply.trim()) {
                        e.preventDefault();
                        replyMutation.mutate();
                      }
                    }}
                  />
                  <Button
                    className="h-11 shrink-0 gap-1.5"
                    disabled={!reply.trim() || replyMutation.isPending}
                    onClick={() => replyMutation.mutate()}
                  >
                    <Send className="h-4 w-4" />
                    Send
                  </Button>
                </div>
              </>
            )}
          </section>
        ) : null}
      </div>
    </CardShell>
  );
}

function CardShell({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-none w-full min-w-0">
      {children}
    </div>
  );
}
