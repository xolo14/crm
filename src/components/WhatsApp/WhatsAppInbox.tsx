import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { communicationsApi } from "@/services/communications";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import type { CommWhatsappMessage, DialerContact, WaAssignableMember, WaConversation, WhatsappTemplate } from "@/types/communications";
import ConversationList from "./ConversationList";
import ChatWindow from "./ChatWindow";
import TemplateModal from "./TemplateModal";
import NewChatModal from "./NewChatModal";
import { isWindowOpen } from "./waUtils";
import { cn } from "@/lib/utils";
import "./WhatsAppInbox.css";

const PAGE_SIZE = 80;
const POLL_MS = 5000;

export default function WhatsAppInbox({
  connected = true,
  embedded = false,
}: {
  connected?: boolean;
  embedded?: boolean;
}) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const role = String(user?.role || "").toLowerCase();
  const readOnlyFreeText = role === "marketing" || role.startsWith("marketing");

  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<WaConversation | null>(null);
  const [messages, setMessages] = useState<CommWhatsappMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [templates, setTemplates] = useState<WhatsappTemplate[]>([]);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [pollFails, setPollFails] = useState(0);
  const [tick, setTick] = useState(0);
  const [leadHint, setLeadHint] = useState<DialerContact | null>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [canAssign, setCanAssign] = useState(false);
  const [assignableMembers, setAssignableMembers] = useState<WaAssignableMember[]>([]);
  const [assigning, setAssigning] = useState(false);
  const knownMsgIds = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | null>(null);

  activeIdRef.current = activeConversation?.id ?? null;

  const loadConversations = useCallback(async (silent = false) => {
    try {
      const res = await communicationsApi.conversations(PAGE_SIZE, { search: searchQuery.trim() || undefined });
      const rows = res.data ?? res.conversations ?? [];
      setConversations(rows);
      setCanAssign(Boolean(res.can_assign));
      setPollFails(0);
      setActiveConversation((prev) => {
        if (!prev) return prev;
        const fresh = rows.find((r) => r.id === prev.id);
        return fresh || prev;
      });
    } catch {
      setPollFails((n) => n + 1);
      if (!silent) {
        toast({ variant: "destructive", title: "Could not load chats" });
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [searchQuery, toast]);

  const loadMessages = useCallback(async (conversationId: string, silent = false) => {
    if (!silent) setMsgsLoading(true);
    try {
      const res = await communicationsApi.messages(100, conversationId);
      const rows = res.data ?? [];
      if (silent && rows.length) {
        const newestInbound = [...rows].reverse().find((m) => m.direction === "inbound");
        if (newestInbound && !knownMsgIds.current.has(newestInbound.id) && document.hidden) {
          try {
            if (Notification.permission === "granted") {
              new Notification("New WhatsApp message", {
                body: newestInbound.message_body?.slice(0, 80) || "New message",
              });
            }
          } catch {
            /* ignore */
          }
        }
      }
      rows.forEach((m) => knownMsgIds.current.add(m.id));
      setMessages(rows);
      if (res.conversation) {
        setActiveConversation((prev) => (prev && prev.id === conversationId ? { ...prev, ...res.conversation } : prev));
      }
      await communicationsApi.markRead(conversationId).catch(() => undefined);
    } catch (e) {
      if (!silent) {
        toast({
          variant: "destructive",
          title: e instanceof Error ? e.message : "Could not load messages",
        });
      }
    } finally {
      if (!silent) setMsgsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!connected) return;
    setIsLoading(true);
    void loadConversations();
  }, [connected, loadConversations]);

  useEffect(() => {
    if (!connected) return;
    communicationsApi.templates({ status: "approved" }).then((r) => setTemplates(r.data ?? [])).catch(() => undefined);
  }, [connected]);

  useEffect(() => {
    if (!connected || !canAssign) {
      setAssignableMembers([]);
      return;
    }
    communicationsApi
      .assignableMembers()
      .then((r) => setAssignableMembers(r.data ?? []))
      .catch(() => setAssignableMembers([]));
  }, [connected, canAssign]);

  useEffect(() => {
    if (!connected) return;
    const id = window.setInterval(() => {
      void loadConversations(true);
      if (activeIdRef.current) void loadMessages(activeIdRef.current, true);
      setTick((t) => t + 1);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [connected, loadConversations, loadMessages]);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.visualViewport === "undefined") return;

    const viewport = window.visualViewport;
    const updateKeyboardOffset = () => {
      const offset = Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop));
      setKeyboardOffset(offset > 80 ? offset : 0);
    };

    updateKeyboardOffset();
    viewport.addEventListener("resize", updateKeyboardOffset);
    viewport.addEventListener("scroll", updateKeyboardOffset);
    window.addEventListener("orientationchange", updateKeyboardOffset);
    return () => {
      viewport.removeEventListener("resize", updateKeyboardOffset);
      viewport.removeEventListener("scroll", updateKeyboardOffset);
      window.removeEventListener("orientationchange", updateKeyboardOffset);
    };
  }, []);

  const selectConversation = (c: WaConversation) => {
    setActiveConversation(c);
    setMessageInput("");
    setMobileShowChat(true);
    void loadMessages(c.id);
  };

  const handleSendText = async () => {
    if (!activeConversation || !messageInput.trim() || isSending) return;
    if (!isWindowOpen(activeConversation)) {
      setShowTemplateModal(true);
      return;
    }
    setIsSending(true);
    const text = messageInput.trim();
    try {
      await communicationsApi.sendWhatsappReply({
        recipient_phone: activeConversation.contact_phone,
        recipient_name: activeConversation.contact_name || undefined,
        message: text,
        lead_id: activeConversation.lead_id || undefined,
      });
      setMessageInput("");
      await loadMessages(activeConversation.id, true);
      await loadConversations(true);
    } catch (e) {
      toast({
        variant: "destructive",
        title: e instanceof Error ? e.message : "Send failed",
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleSendTemplate = async (payload: {
    template_id: string;
    variables: string[];
    recipient_phone: string;
    recipient_name?: string;
    lead_id?: string;
  }) => {
    setIsSending(true);
    try {
      await communicationsApi.sendWhatsapp(payload);
      setShowTemplateModal(false);
      toast({ title: "Template sent" });
      await loadConversations(true);
      const phoneDigits = payload.recipient_phone.replace(/\D/g, "");
      const match = (await communicationsApi.conversations(PAGE_SIZE)).data?.find((c) =>
        c.contact_phone.replace(/\D/g, "").endsWith(phoneDigits.slice(-10)),
      );
      if (match) {
        setActiveConversation(match);
        await loadMessages(match.id, true);
      } else if (activeConversation && !activeConversation.id.startsWith("draft-")) {
        await loadMessages(activeConversation.id, true);
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: e instanceof Error ? e.message : "Template send failed",
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleNewChat = (opts: { phone: string; name?: string; leadId?: string }) => {
    const phone = opts.phone.replace(/\s+/g, "");
    const existing = conversations.find(
      (c) => c.contact_phone.replace(/\D/g, "").endsWith(phone.replace(/\D/g, "").slice(-10)),
    );
    if (existing) {
      selectConversation(existing);
      return;
    }
    const draft: WaConversation = {
      id: `draft-${phone}`,
      org_id: "",
      contact_phone: phone,
      contact_name: opts.name || null,
      lead_id: opts.leadId || null,
      unread_count: 0,
      window_open: 0,
      last_message_preview: "New conversation — send a template to start",
    };
    setActiveConversation(draft);
    setMessages([]);
    setMobileShowChat(true);
    setShowTemplateModal(true);
    if (opts.leadId) {
      setLeadHint({ id: opts.leadId, full_name: opts.name || "", phone });
    } else {
      setLeadHint(null);
    }
  };

  const handleRetry = (m: CommWhatsappMessage) => {
    if (!activeConversation || !m.message_body) return;
    setMessageInput(m.message_body);
  };

  const handleAssign = async (assignedTo: string | null) => {
    if (!activeConversation || activeConversation.id.startsWith("draft-") || assigning) return;
    setAssigning(true);
    try {
      const res = await communicationsApi.assignConversation(activeConversation.id, assignedTo);
      const updated = res.data;
      if (updated) {
        setActiveConversation((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
        setConversations((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
      }
      toast({ title: assignedTo ? "Chat assigned" : "Chat unassigned" });
      await loadConversations(true);
    } catch (e) {
      toast({
        variant: "destructive",
        title: e instanceof Error ? e.message : "Assign failed",
      });
    } finally {
      setAssigning(false);
    }
  };

  const showList = !isMobile || !mobileShowChat;
  const showChat = !isMobile || mobileShowChat;

  const sorted = useMemo(
    () =>
      [...conversations].sort((a, b) => {
        const ta = new Date(a.last_message_at || 0).getTime();
        const tb = new Date(b.last_message_at || 0).getTime();
        return tb - ta;
      }),
    [conversations],
  );

  if (!connected) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        Connect WhatsApp for your organization to use the inbox.
      </div>
    );
  }

  const soloChat = showChat && !showList;

  return (
    <div
      className={cn(
        "wa-inbox",
        embedded ? "wa-inbox--embedded" : "wa-inbox--fullscreen",
        soloChat && "wa-inbox--solo-chat",
      )}
    >
      {showList ? (
        <ConversationList
          conversations={sorted}
          activeId={activeConversation?.id || null}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelect={selectConversation}
          onNewChat={() => setShowNewChatModal(true)}
          connecting={pollFails >= 3}
          loading={isLoading}
        />
      ) : null}
      {showChat ? (
        <ChatWindow
          conversation={activeConversation}
          messages={messages}
          loading={msgsLoading}
          messageInput={messageInput}
          onMessageInputChange={setMessageInput}
          onSend={handleSendText}
          sending={isSending}
          onBack={isMobile ? () => setMobileShowChat(false) : undefined}
          onOpenTemplates={() => setShowTemplateModal(true)}
          onRetry={handleRetry}
          readOnlyFreeText={readOnlyFreeText}
          tick={tick}
          keyboardOffset={keyboardOffset}
          canAssign={canAssign}
          assignableMembers={assignableMembers}
          assigning={assigning}
          onAssign={handleAssign}
        />
      ) : null}

      <TemplateModal
        open={showTemplateModal}
        onOpenChange={setShowTemplateModal}
        templates={templates}
        conversation={activeConversation}
        leadHint={leadHint}
        sending={isSending}
        onSend={handleSendTemplate}
      />
      <NewChatModal open={showNewChatModal} onOpenChange={setShowNewChatModal} onStart={handleNewChat} />
    </div>
  );
}
