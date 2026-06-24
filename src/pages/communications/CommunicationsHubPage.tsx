import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Hash, MessageSquare, Phone, PhoneCall, Search, Send, Settings, Smartphone, Users,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { communicationsApi } from "@/services/communications";
import DialerPad from "@/components/communications/DialerPad";
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
  const { user } = useAuth();
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
  const [waTemplateId, setWaTemplateId] = useState("");
  const [waVars, setWaVars] = useState("");

  const { data: summary } = useQuery({ queryKey: ["comm", "summary"], queryFn: communicationsApi.hubSummary });
  const { data: assignmentsRes } = useQuery({ queryKey: ["comm", "my-numbers"], queryFn: communicationsApi.myNumberAssignments });
  const { data: contactsRes, isLoading: contactsLoading } = useQuery({
    queryKey: ["comm", "contacts", contactSearch],
    queryFn: () => communicationsApi.dialerContacts(contactSearch),
  });
  const { data: templatesRes } = useQuery({
    queryKey: ["comm", "templates-approved"],
    queryFn: () => communicationsApi.templates({ status: "approved" }),
  });
  const { data: messagesRes } = useQuery({ queryKey: ["comm", "messages"], queryFn: () => communicationsApi.messages(20) });

  const assignments = assignmentsRes?.data ?? [];
  const contacts = contactsRes?.data ?? [];
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
  const isOrgAdmin = ["admin", "org", "super_admin"].includes(user?.role || "");
  const waConnected = orgWa?.is_active && orgWa?.connection_status === "connected";

  const sendMutation = useMutation({
    mutationFn: communicationsApi.sendWhatsapp,
    onSuccess: () => {
      toast({ title: "WhatsApp sent", description: "Message sent via your organization's Meta API." });
      setWaPhone("");
      setWaName("");
      setWaVars("");
      qc.invalidateQueries({ queryKey: ["comm", "messages"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Send failed", description: e.message }),
  });

  const handleCall = () => {
    const phone = normalizePhone(dialNumber);
    if (!phone) return;
    window.location.href = `tel:${phone}`;
    setSelectedContact(null);
    setLogCallOpen(true);
  };

  const pickContact = (c: DialerContact) => {
    setDialNumber(c.phone);
    setWaPhone(c.phone);
    setWaName(c.full_name);
    setSelectedContact(c);
  };

  const tabTriggerClass = "flex-1 gap-1.5 data-[state=active]:shadow-sm text-xs sm:text-sm";

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-24 md:pb-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Communications Hub</h1>
          <p className="text-sm text-muted-foreground">
            Your org&apos;s Meta WhatsApp & assigned virtual numbers — {user?.full_name || "your team"}
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

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                    "flex flex-col items-center gap-0.5 rounded-lg py-2 text-[10px] font-medium transition-colors",
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
                    ? `Calling via ${activeNumber.label} (${activeNumber.phone_number})`
                    : "Use your device dialer — assign a virtual number in admin"}
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
        <TabsContent value="whatsapp" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Send WhatsApp</CardTitle>
                <CardDescription>Uses your organization&apos;s Meta API — Meta-approved templates only</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!waConnected ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-sm">
                    WhatsApp is not connected for your organization.
                    {isOrgAdmin ? (
                      <> <Link to="/communications/whatsapp-setup" className="font-medium underline">Set up Meta API</Link></>
                    ) : (
                      " Ask your admin to connect Meta WhatsApp."
                    )}
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label>Recipient phone</Label>
                  <Input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="+91..." />
                </div>
                <div className="space-y-1.5">
                  <Label>Name (optional)</Label>
                  <Input value={waName} onChange={(e) => setWaName(e.target.value)} />
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
                      recipient_name: waName || undefined,
                      template_id: waTemplateId,
                      variables: waVars ? waVars.split(",").map((v) => v.trim()) : [],
                      virtual_number_id: activeNumber?.virtual_number_id,
                      lead_id: selectedContact?.id,
                    })
                  }
                >
                  <Send className="h-4 w-4" />
                  {sendMutation.isPending ? "Sending..." : "Send WhatsApp"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-lg">Recent messages</CardTitle></CardHeader>
              <CardContent className="space-y-2 max-h-[480px] overflow-y-auto">
                {messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No messages yet</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">{m.recipient_name || m.recipient_phone}</span>
                        <Badge variant={m.status === "sent" ? "default" : "secondary"} className="text-[10px]">{m.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.message_body}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── NUMBERS ── */}
        <TabsContent value="numbers" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">My virtual numbers</CardTitle>
              <CardDescription>Numbers assigned to you by your organization admin</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No virtual numbers assigned yet. Ask your admin to assign one.</p>
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
        </TabsContent>
      </Tabs>

      <LogCallDialog open={logCallOpen} onOpenChange={setLogCallOpen} />
    </div>
  );
}
