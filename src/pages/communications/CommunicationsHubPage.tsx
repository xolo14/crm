import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Hash, MessageSquare, Phone, PhoneCall, Search, Send, Settings, Smartphone, Users,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { communicationsApi } from "@/services/communications";
import { api } from "@/lib/api";
import DialerPad from "@/components/communications/DialerPad";
import WhatsAppSetupHome from "@/components/communications/WhatsAppSetupHome";
import WhatsAppSetupWizard from "@/components/communications/WhatsAppSetupWizard";
import WhatsAppInbox from "@/components/WhatsApp/WhatsAppInbox";
import LogCallDialog from "@/components/sales/LogCallDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { DialerContact, NumberAssignment, WhatsappTemplate } from "@/types/communications";

type HubTab = "dialer" | "whatsapp" | "numbers";

function normalizePhone(p: string) {
  return p.replace(/\s+/g, "").replace(/[^\d+]/g, "");
}

export default function CommunicationsHubPage({ adminLink }: { adminLink?: string }) {
  const { user, organization } = useAuth();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<HubTab>("dialer");
  const [dialNumber, setDialNumber] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [logCallOpen, setLogCallOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<DialerContact | null>(null);
  const [selectedNumberId, setSelectedNumberId] = useState<string>("");
  const [waPhone, setWaPhone] = useState("");
  const [waName, setWaName] = useState("");
  const [waLeadId, setWaLeadId] = useState<string | null>(null);
  const [waLeadPickerOpen, setWaLeadPickerOpen] = useState(false);
  const [waLeadSearchDebounced, setWaLeadSearchDebounced] = useState("");
  const waLeadPickerRef = useRef<HTMLDivElement>(null);
  const [waTemplateId, setWaTemplateId] = useState("");
  const [waVars, setWaVars] = useState("");
  const [setupWizardOpen, setSetupWizardOpen] = useState(false);

  const isOrgAdmin = ["admin", "org", "super_admin"].includes(user?.role || "");
  const canAssignNumbers = ["admin", "org", "super_admin", "manager"].includes(user?.role || "");
  const [assignVnId, setAssignVnId] = useState("");
  const [assignUserId, setAssignUserId] = useState("");

  const { data: summary } = useQuery({ queryKey: ["comm", "summary"], queryFn: communicationsApi.hubSummary });
  const { data: assignmentsRes } = useQuery({ queryKey: ["comm", "my-numbers"], queryFn: communicationsApi.myNumberAssignments });
  const { data: contactsRes, isLoading: contactsLoading } = useQuery({
    queryKey: ["comm", "contacts", contactSearch],
    queryFn: () => communicationsApi.dialerContacts(contactSearch),
  });
  useEffect(() => {
    const t = window.setTimeout(() => setWaLeadSearchDebounced(waName.trim()), 250);
    return () => window.clearTimeout(t);
  }, [waName]);
  const { data: waLeadsRes, isFetching: waLeadsLoading } = useQuery({
    queryKey: ["comm", "wa-lead-search", waLeadSearchDebounced],
    queryFn: () => communicationsApi.dialerContacts(waLeadSearchDebounced),
    enabled: waLeadPickerOpen && waLeadSearchDebounced.length >= 1,
  });
  useEffect(() => {
    if (!waLeadPickerOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (waLeadPickerRef.current && !waLeadPickerRef.current.contains(e.target as Node)) {
        setWaLeadPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [waLeadPickerOpen]);
  const { data: templatesRes } = useQuery({
    queryKey: ["comm", "templates-approved"],
    queryFn: () => communicationsApi.templates({ status: "approved" }),
  });
  const { data: orgConfigRes } = useQuery({
    queryKey: ["comm", "org-config"],
    queryFn: () => communicationsApi.orgConfig(),
    enabled: isOrgAdmin,
  });
  const { data: messagesRes } = useQuery({ queryKey: ["comm", "messages"], queryFn: () => communicationsApi.messages(20) });
  const { data: orgNumbersRes } = useQuery({
    queryKey: ["comm", "org-numbers"],
    queryFn: () => communicationsApi.virtualNumbers(),
    enabled: canAssignNumbers,
  });
  const { data: teamRes } = useQuery({
    queryKey: ["team"],
    queryFn: () => api.team.list(),
    enabled: canAssignNumbers,
  });

  const assignNumberMut = useMutation({
    mutationFn: () => communicationsApi.assignNumber(assignVnId, assignUserId),
    onSuccess: () => {
      toast({ title: "Number assigned", description: "Team member can now use this virtual number." });
      setAssignVnId("");
      setAssignUserId("");
      qc.invalidateQueries({ queryKey: ["comm"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Assign failed", description: e.message }),
  });

  const assignments = assignmentsRes?.data ?? [];
  const orgNumbers = orgNumbersRes?.data ?? [];
  const team = Array.isArray(teamRes) ? teamRes : teamRes?.data ?? [];
  const contacts = contactsRes?.data ?? [];
  const waLeadResults = waLeadsRes?.data ?? [];
  const templates = templatesRes?.data ?? [];
  const messages = messagesRes?.data ?? [];

  const activeNumber = useMemo(() => {
    if (selectedNumberId) return assignments.find((a) => a.virtual_number_id === selectedNumberId);
    return assignments[0] as NumberAssignment | undefined;
  }, [assignments, selectedNumberId]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === waTemplateId),
    [templates, waTemplateId],
  );

  const previewBody = useMemo(() => {
    if (!selectedTemplate) return "";
    const vars = waVars.split(",").map((v) => v.trim());
    let body = selectedTemplate.body;
    vars.forEach((v, i) => {
      body = body.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, "g"), v);
    });
    return body;
  }, [selectedTemplate, waVars]);

  const orgWa = summary?.org_whatsapp;
  const waProvider = "Meta";
  const waConnected = orgWa?.is_active && orgWa?.connection_status === "connected";
  const orgConfig = orgConfigRes?.data ?? null;

  const sendMutation = useMutation({
    mutationFn: communicationsApi.sendWhatsapp,
    onSuccess: () => {
      toast({ title: "WhatsApp sent", description: `Message sent via ${waProvider}.` });
      setWaPhone("");
      setWaName("");
      setWaLeadId(null);
      setWaVars("");
      setWaLeadPickerOpen(false);
      setSelectedContact(null);
      qc.invalidateQueries({ queryKey: ["comm", "messages"] });
      qc.invalidateQueries({ queryKey: ["comm", "conversations"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Send failed", description: e.message }),
  });

  const handleCall = () => {
    const phone = normalizePhone(dialNumber);
    if (!phone) return;
    window.location.href = `tel:${phone}`;
    // Keep selected contact so Log Call pre-fills the dialed lead.
    setLogCallOpen(true);
  };

  const pickContact = (c: DialerContact) => {
    setDialNumber(c.phone);
    setWaPhone(c.phone);
    setWaName(c.full_name);
    setWaLeadId(c.id);
    setSelectedContact(c);
  };

  const handleWaNameChange = (value: string) => {
    setWaName(value);
    setWaLeadPickerOpen(true);
    if (waLeadId && selectedContact) {
      const same =
        value.trim().toLowerCase() === (selectedContact.full_name || "").trim().toLowerCase();
      if (!same) {
        setWaLeadId(null);
        setSelectedContact(null);
      }
    } else if (waLeadId) {
      setWaLeadId(null);
    }
  };

  const selectWaLead = (c: DialerContact) => {
    setWaName(c.full_name || "");
    setWaPhone(c.phone || "");
    setWaLeadId(c.id);
    setSelectedContact(c);
    setWaLeadPickerOpen(false);
  };

  const handleWaPhoneChange = (value: string) => {
    setWaPhone(value);
    if (waLeadId && selectedContact) {
      const same =
        normalizePhone(value) === normalizePhone(selectedContact.phone || "");
      if (!same) {
        setWaLeadId(null);
        setSelectedContact(null);
      }
    }
  };

  const tabTriggerClass = "flex-1 gap-1.5 data-[state=active]:shadow-sm text-xs sm:text-sm";

  return (
    <div className={cn("mx-auto max-w-5xl space-y-4", isMobile ? "pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]" : "pb-6")}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Communications Hub</h1>
          <p className="text-sm text-muted-foreground line-clamp-2">
            Your org&apos;s {waProvider} WhatsApp & assigned virtual numbers — {user?.full_name || "your team"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isOrgAdmin ? (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" asChild>
                <Link to="/communications/whatsapp-setup"><Settings className="h-3.5 w-3.5" /> WhatsApp Setup</Link>
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" asChild>
                <Link to="/communications/template-library">Official Templates</Link>
              </Button>
            </>
          ) : null}
          {adminLink ? (
            <Button variant="outline" size="sm" asChild>
              <a href={adminLink}>Admin settings</a>
            </Button>
          ) : user?.role === "super_admin" ? (
            <Button variant="outline" size="sm" asChild>
              <Link to="/communications/admin">Assign numbers</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Summary — compact on WhatsApp mobile so inbox stays primary */}
      <div className={cn("grid grid-cols-2 md:grid-cols-4 gap-3", tab === "whatsapp" && isMobile && "hidden")}>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Org WhatsApp</div>
          <div className="font-semibold text-sm mt-1 truncate">
            {orgWa?.business_phone || "Not connected"}
          </div>
          <Badge variant={waConnected ? "default" : "secondary"} className="mt-1 text-[10px]">
            {waConnected ? "Connected" : orgWa?.connection_status || "Setup required"}
          </Badge>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">My numbers</div>
          <div className="text-2xl font-bold">{summary?.my_assigned_numbers ?? 0}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">WA templates</div>
          <div className="text-2xl font-bold">{summary?.approved_templates ?? 0}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Official templates</div>
          <div className="text-2xl font-bold">{summary?.official_templates_available ?? 0}</div>
          {summary?.meta_partner_active ? (
            <Badge variant="default" className="mt-1 text-[10px]">Partner active</Badge>
          ) : null}
        </Card>
      </div>
      {tab === "whatsapp" && isMobile ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
          <span className="text-muted-foreground truncate">
            {waConnected ? orgWa?.business_phone || "WhatsApp connected" : "WhatsApp not connected"}
          </span>
          <Badge variant={waConnected ? "default" : "secondary"} className="shrink-0 text-[10px]">
            {waConnected ? "Live" : "Setup"}
          </Badge>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as HubTab)}>
        <TabsList className={cn("grid w-full grid-cols-3 h-auto p-1", isMobile && "hidden")}>
          <TabsTrigger value="dialer" className={tabTriggerClass}><PhoneCall className="h-4 w-4" /> Dialer</TabsTrigger>
          <TabsTrigger value="whatsapp" className={tabTriggerClass}><MessageSquare className="h-4 w-4" /> WhatsApp</TabsTrigger>
          <TabsTrigger value="numbers" className={tabTriggerClass}><Hash className="h-4 w-4" /> My Numbers</TabsTrigger>
        </TabsList>

        {/* Mobile bottom nav */}
        {isMobile ? (
          <div className="fixed bottom-0 inset-x-0 z-40 border-t bg-background/95 backdrop-blur pb-safe">
            <div className="grid grid-cols-3 gap-1 p-2">
              {([
                ["dialer", PhoneCall, "Dialer"],
                ["whatsapp", MessageSquare, "WhatsApp"],
                ["numbers", Hash, "Numbers"],
              ] as const).map(([id, Icon, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg py-2 text-[10px] font-medium transition-colors",
                    tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── DIALER ── */}
        <TabsContent value="dialer" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2"><Smartphone className="h-5 w-5" /> Phone dialer</CardTitle>
                <CardDescription>
                  {activeNumber
                    ? `Opens your phone dialer (tel:) — caller ID label ${activeNumber.label} (${activeNumber.phone_number}). Virtual numbers are metadata only; calls are not routed through Exotel or the CRM.`
                    : "Opens your device dialer (tel:) — assign a virtual number in admin for caller ID labels only. No cloud telephony integration."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {assignments.length > 1 ? (
                  <Select value={selectedNumberId || assignments[0]?.virtual_number_id} onValueChange={setSelectedNumberId}>
                    <SelectTrigger className="mb-4"><SelectValue placeholder="Caller ID number" /></SelectTrigger>
                    <SelectContent>
                      {assignments.map((a) => (
                        <SelectItem key={a.virtual_number_id} value={a.virtual_number_id}>
                          {a.label} — {a.phone_number}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <DialerPad value={dialNumber} onChange={setDialNumber} onCall={handleCall} />
                <Button variant="outline" className="w-full mt-3" onClick={() => setLogCallOpen(true)}>
                  Log call manually
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2"><Users className="h-5 w-5" /> Contacts</CardTitle>
                <div className="relative mt-2">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search leads..."
                    className="pl-9"
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent className="max-h-[420px] overflow-y-auto space-y-1 p-0 sm:p-6 sm:pt-0">
                {contactsLoading ? (
                  <p className="text-sm text-muted-foreground p-4">Loading...</p>
                ) : contacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4">No contacts with phone numbers</p>
                ) : (
                  contacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickContact(c)}
                      className="flex w-full items-center justify-between rounded-lg px-4 py-3 text-left hover:bg-muted/60 transition-colors"
                    >
                      <div>
                        <div className="font-medium text-sm">{c.full_name}</div>
                        <div className="text-xs text-muted-foreground">{c.phone}</div>
                      </div>
                      <Phone className="h-4 w-4 text-emerald-600 shrink-0" />
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── WHATSAPP ── */}
        <TabsContent value="whatsapp" className="mt-4 space-y-4 min-w-0 w-full">
          {isOrgAdmin && !waConnected ? (
            <WhatsAppSetupHome
              userName={user?.full_name}
              connected={waConnected}
              businessPhone={orgWa?.business_phone}
              onConnect={() => setSetupWizardOpen(true)}
              onManage={() => setSetupWizardOpen(true)}
            />
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Full WhatsApp Web–style inbox</p>
            <Button variant="outline" size="sm" asChild>
              <Link to="/communications/whatsapp-inbox">Open fullscreen</Link>
            </Button>
          </div>
          <div className="min-h-0 w-full overflow-hidden rounded-xl">
            <WhatsAppInbox connected={waConnected} embedded />
          </div>

          <details className={cn("rounded-xl border group", isOrgAdmin && !waConnected && "opacity-60")}>
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
              <span>Template send &amp; recent outbound</span>
              <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
              <span className="text-xs text-muted-foreground hidden group-open:inline">Hide</span>
            </summary>
            <div className={cn("grid gap-4 p-4 pt-0 lg:grid-cols-2", isOrgAdmin && !waConnected && "pointer-events-none")}>
              <Card className="border-0 shadow-none">
                <CardHeader className="px-0 pt-0">
                  <CardTitle className="text-base">Send WhatsApp</CardTitle>
                  <CardDescription>Approved templates only — uses org {waProvider}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 px-0 pb-0">
                  {!waConnected ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-sm">
                      WhatsApp is not connected for your organization.
                      {isOrgAdmin ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="font-medium underline"
                            onClick={() => setSetupWizardOpen(true)}
                          >
                            Start setup wizard
                          </button>
                        </>
                      ) : (
                        " Ask your admin to connect WhatsApp via Meta Cloud API."
                      )}
                    </div>
                  ) : null}
                  <div className="space-y-1.5" ref={waLeadPickerRef}>
                    <Label htmlFor="wa-name">Name (optional)</Label>
                    <div className="relative">
                      <Input
                        id="wa-name"
                        value={waName}
                        onChange={(e) => handleWaNameChange(e.target.value)}
                        onFocus={() => setWaLeadPickerOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setWaLeadPickerOpen(false);
                        }}
                        placeholder="Type to search leads…"
                        role="combobox"
                        aria-expanded={waLeadPickerOpen}
                        aria-autocomplete="list"
                        aria-controls="wa-lead-listbox"
                        autoComplete="off"
                      />
                      {waLeadPickerOpen && waName.trim().length >= 1 ? (
                        <ul
                          id="wa-lead-listbox"
                          role="listbox"
                          className="absolute z-20 left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md py-1"
                        >
                          {waLeadsLoading ? (
                            <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>
                          ) : waLeadResults.length === 0 ? (
                            <li className="px-3 py-2 text-xs text-muted-foreground">
                              No leads found — name stays optional
                            </li>
                          ) : (
                            waLeadResults.map((c) => (
                              <li key={c.id} role="option" aria-selected={waLeadId === c.id}>
                                <button
                                  type="button"
                                  className={cn(
                                    "w-full text-left px-3 py-2 text-sm hover:bg-accent",
                                    waLeadId === c.id && "bg-accent",
                                  )}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => selectWaLead(c)}
                                >
                                  <span className="font-medium block truncate">{c.full_name}</span>
                                  <span className="text-[11px] text-muted-foreground block truncate">
                                    {[c.phone, c.email].filter(Boolean).join(" · ")}
                                  </span>
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wa-phone">Recipient phone</Label>
                    <Input
                      id="wa-phone"
                      value={waPhone}
                      onChange={(e) => handleWaPhoneChange(e.target.value)}
                      placeholder="+91..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Approved template</Label>
                    <Select value={waTemplateId} onValueChange={setWaTemplateId}>
                      <SelectTrigger><SelectValue placeholder={templates.length ? "Select template" : "No approved templates"} /></SelectTrigger>
                      <SelectContent>
                        {templates.map((t: WhatsappTemplate) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Variables (comma-separated)</Label>
                    <Input value={waVars} onChange={(e) => setWaVars(e.target.value)} placeholder="Name, Course, Date..." />
                  </div>
                  {previewBody ? (
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap">{previewBody}</div>
                  ) : null}
                  <Button
                    className="w-full gap-2"
                    disabled={!waConnected || !waPhone || !waTemplateId || sendMutation.isPending}
                    onClick={() =>
                      sendMutation.mutate({
                        recipient_phone: waPhone,
                        recipient_name: waName.trim() || undefined,
                        template_id: waTemplateId,
                        variables: waVars ? waVars.split(",").map((v) => v.trim()) : [],
                        virtual_number_id: activeNumber?.virtual_number_id,
                        lead_id: waLeadId || undefined,
                      })
                    }
                  >
                    <Send className="h-4 w-4" />
                    {sendMutation.isPending ? "Sending..." : "Send WhatsApp"}
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-none">
                <CardHeader className="px-0 pt-0"><CardTitle className="text-base">Recent messages</CardTitle></CardHeader>
                <CardContent className="space-y-2 max-h-[320px] overflow-y-auto px-0 pb-0">
                  {messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No messages yet</p>
                  ) : (
                    messages.map((m) => (
                      <div key={m.id} className="rounded-lg border p-3 text-sm">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{m.recipient_name || m.recipient_phone}</span>
                          <Badge
                            variant={m.status === "sent" ? "default" : m.status === "failed" ? "destructive" : "secondary"}
                            className="text-[10px]"
                          >
                            {m.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.message_body}</p>
                        {m.status === "failed" && m.error_message ? (
                          <p className="text-xs text-destructive mt-1.5">{m.error_message}</p>
                        ) : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </details>
        </TabsContent>

        {/* ── NUMBERS ── */}
        <TabsContent value="numbers" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">My virtual numbers</CardTitle>
              <CardDescription>
                {isOrgAdmin
                  ? "All virtual numbers provisioned for your organization appear here automatically."
                  : "Numbers assigned to you by your organization admin"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {isOrgAdmin
                    ? "No virtual numbers for your organization yet. Ask Syncpedia platform admin to assign one."
                    : "No virtual numbers assigned yet. Ask your admin to assign one."}
                </p>
              ) : (
                assignments.map((a) => (
                  <div key={a.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border p-4">
                    <div>
                      <div className="font-semibold">{a.label || "Virtual Number"}</div>
                      <div className="text-lg font-mono tracking-wide">{a.phone_number}</div>
                      <div className="text-xs text-muted-foreground">{a.org_name}</div>
                    </div>
                    <div className="flex gap-2">
                      {a.calls_enabled ? <Badge variant="outline" className="gap-1"><Phone className="h-3 w-3" /> Calls</Badge> : null}
                      {a.whatsapp_enabled ? <Badge variant="outline" className="gap-1"><MessageSquare className="h-3 w-3" /> WhatsApp</Badge> : null}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {canAssignNumbers && orgNumbers.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Assign number to team member</CardTitle>
                <CardDescription>
                  Give sales reps or managers access to a virtual number for dialer and WhatsApp
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col sm:flex-row gap-3">
                <Select value={assignVnId} onValueChange={setAssignVnId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Virtual number" /></SelectTrigger>
                  <SelectContent>
                    {orgNumbers.map((n) => (
                      <SelectItem key={n.id} value={n.id}>{n.label} — {n.phone_number}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={assignUserId} onValueChange={setAssignUserId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Team member" /></SelectTrigger>
                  <SelectContent>
                    {team.map((u: { id: string; full_name: string; email: string }) => (
                      <SelectItem key={u.id} value={u.id}>{u.full_name} ({u.email})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => assignNumberMut.mutate()}
                  disabled={!assignVnId || !assignUserId || assignNumberMut.isPending}
                >
                  Assign
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
      </Tabs>

      <LogCallDialog
        open={logCallOpen}
        onOpenChange={(o) => {
          setLogCallOpen(o);
          if (!o) setSelectedContact(null);
        }}
        initialLeadId={selectedContact?.id || null}
      />

      {isOrgAdmin ? (
        <WhatsAppSetupWizard
          open={setupWizardOpen}
          onOpenChange={setSetupWizardOpen}
          orgId={organization?.id || summary?.org_id}
          orgName={organization?.name}
          existingConfig={orgConfig}
          onConnected={() => qc.invalidateQueries({ queryKey: ["comm"] })}
        />
      ) : null}
    </div>
  );
}
