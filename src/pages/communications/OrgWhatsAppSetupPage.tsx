import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, MessageSquare, Plus, RefreshCw, Upload, Wifi } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { communicationsApi } from "@/services/communications";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { WhatsappTemplate } from "@/types/communications";

const STATUS_COLORS: Record<string, string> = {
  draft: "secondary",
  pending_approval: "outline",
  approved: "default",
  rejected: "destructive",
};

export default function OrgWhatsAppSetupPage() {
  const { user, organization } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isOrgAdmin = ["admin", "org", "super_admin"].includes(user?.role || "");

  const [waForm, setWaForm] = useState({
    api_key: "",
    app_secret: "",
    business_phone: "",
    phone_number_id: "",
    waba_id: "",
    webhook_verify_token: "",
    graph_api_version: "v21.0",
    is_active: true,
  });
  const [tplForm, setTplForm] = useState({ name: "", body: "", category: "marketing", language: "en" });
  const [tplOpen, setTplOpen] = useState(false);

  const { data: configRes } = useQuery({
    queryKey: ["comm", "org-config"],
    queryFn: communicationsApi.orgConfig,
    enabled: isOrgAdmin,
  });
  const { data: templatesRes } = useQuery({
    queryKey: ["comm", "org-templates"],
    queryFn: () => communicationsApi.templates(),
    enabled: isOrgAdmin,
  });

  const config = configRes?.data;
  const webhookUrl = config?.webhook_url_suggested || configRes?.webhook_url_suggested || "";
  const templates = templatesRes?.data ?? [];

  useEffect(() => {
    if (!config) return;
    setWaForm((p) => ({
      ...p,
      business_phone: config.business_phone || "",
      phone_number_id: config.phone_number_id || "",
      waba_id: config.waba_id || "",
      graph_api_version: config.graph_api_version || "v21.0",
      is_active: Boolean(config.is_active),
    }));
  }, [config]);

  const saveMut = useMutation({
    mutationFn: () => communicationsApi.saveOrgConfig(waForm),
    onSuccess: () => {
      toast({ title: "Meta WhatsApp saved for your organization" });
      qc.invalidateQueries({ queryKey: ["comm"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Save failed", description: e.message }),
  });

  const testMut = useMutation({
    mutationFn: communicationsApi.testMetaConnection,
    onSuccess: (d) => toast({ title: "Connected", description: d.data?.verified_name || d.message }),
    onError: (e: Error) => toast({ variant: "destructive", title: "Failed", description: e.message }),
  });

  const syncMut = useMutation({
    mutationFn: communicationsApi.syncMetaTemplates,
    onSuccess: (d) => {
      toast({ title: "Synced from Meta", description: `${d.imported} new, ${d.updated} updated` });
      qc.invalidateQueries({ queryKey: ["comm", "org-templates"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Sync failed", description: e.message }),
  });

  const createTplMut = useMutation({
    mutationFn: () => communicationsApi.createTemplate(tplForm),
    onSuccess: () => {
      toast({ title: "Template saved", description: "Click Submit to Meta for official approval." });
      setTplOpen(false);
      setTplForm({ name: "", body: "", category: "marketing", language: "en" });
      qc.invalidateQueries({ queryKey: ["comm", "org-templates"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Failed", description: e.message }),
  });

  const submitMetaMut = useMutation({
    mutationFn: communicationsApi.submitTemplateToMeta,
    onSuccess: () => {
      toast({ title: "Submitted to Meta", description: "Meta will review (usually 24–48 hours)." });
      qc.invalidateQueries({ queryKey: ["comm", "org-templates"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Submit failed", description: e.message }),
  });

  if (!isOrgAdmin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-muted-foreground">Only organization admins can connect Meta WhatsApp.</p>
        <Button className="mt-4" asChild><Link to="/communications">Back to Communications</Link></Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/communications"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">WhatsApp Setup</h1>
          <p className="text-sm text-muted-foreground">
            {organization?.name || "Your organization"} — connect your own Meta Business API
          </p>
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Each organization uses its own Meta WhatsApp account. Use the <strong>Official Template Library</strong> for Meta-aligned templates with faster approval.
          </span>
          <Button variant="secondary" size="sm" className="gap-1.5 shrink-0" asChild>
            <Link to="/communications/template-library"><BookOpen className="h-4 w-4" /> Template Library</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" /> Meta API connection</CardTitle>
          <CardDescription>
            From Meta Business Suite → WhatsApp → API Setup. Status:{" "}
            <Badge variant={config?.connection_status === "connected" ? "default" : "secondary"}>
              {config?.connection_status || "not connected"}
            </Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Permanent access token</Label>
            <Input type="password" placeholder={config?.api_key_set ? "Leave blank to keep" : "EAAxxxx…"} onChange={(e) => setWaForm((p) => ({ ...p, api_key: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone Number ID</Label>
            <Input value={waForm.phone_number_id} onChange={(e) => setWaForm((p) => ({ ...p, phone_number_id: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>WABA ID</Label>
            <Input value={waForm.waba_id} onChange={(e) => setWaForm((p) => ({ ...p, waba_id: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Business phone</Label>
            <Input value={waForm.business_phone} onChange={(e) => setWaForm((p) => ({ ...p, business_phone: e.target.value }))} placeholder="+91…" />
          </div>
          <div className="space-y-1.5">
            <Label>App secret</Label>
            <Input type="password" placeholder="For webhook security" onChange={(e) => setWaForm((p) => ({ ...p, app_secret: e.target.value }))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Webhook verify token</Label>
            <Input value={waForm.webhook_verify_token} onChange={(e) => setWaForm((p) => ({ ...p, webhook_verify_token: e.target.value }))} placeholder="Match in Meta dashboard" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Webhook URL (paste in Meta App)</Label>
            <Input readOnly value={webhookUrl} className="font-mono text-xs bg-muted/50" />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch checked={waForm.is_active} onCheckedChange={(v) => setWaForm((p) => ({ ...p, is_active: v }))} />
            <Label>WhatsApp active for {organization?.name || "this org"}</Label>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>Save connection</Button>
            <Button variant="outline" className="gap-1.5" onClick={() => testMut.mutate()} disabled={testMut.isPending}>
              <Wifi className="h-4 w-4" /> Test
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Official Meta templates</CardTitle>
            <CardDescription>Create templates and submit to Meta for approval</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
              <RefreshCw className="h-4 w-4" /> Sync
            </Button>
            <Dialog open={tplOpen} onOpenChange={setTplOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> New</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New WhatsApp template</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5"><Label>Name</Label><Input value={tplForm.name} onChange={(e) => setTplForm((p) => ({ ...p, name: e.target.value }))} /></div>
                  <div className="space-y-1.5"><Label>Body ({"{{1}}"}, {"{{2}}"} for variables)</Label><Textarea rows={5} value={tplForm.body} onChange={(e) => setTplForm((p) => ({ ...p, body: e.target.value }))} /></div>
                </div>
                <DialogFooter>
                  <Button onClick={() => createTplMut.mutate()} disabled={createTplMut.isPending}>Save draft</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>CRM status</TableHead>
                <TableHead>Meta status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No templates yet</TableCell></TableRow>
              ) : (
                templates.map((t: WhatsappTemplate) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell><Badge variant={STATUS_COLORS[t.status] as "default"}>{t.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.meta_status || "—"}</TableCell>
                    <TableCell>
                      {t.status === "draft" || (t.status === "pending_approval" && !t.meta_template_id) ? (
                        <Button size="sm" variant="outline" className="gap-1 h-8" onClick={() => submitMetaMut.mutate(t.id)} disabled={submitMetaMut.isPending}>
                          <Upload className="h-3 w-3" /> Submit to Meta
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
