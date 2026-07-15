import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, Plus, RefreshCw, Upload } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { communicationsApi } from "@/services/communications";
import WhatsAppSetupHome from "@/components/communications/WhatsAppSetupHome";
import WhatsAppSetupWizard from "@/components/communications/WhatsAppSetupWizard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { WhatsappTemplate } from "@/types/communications";
import { privacyPolicyUrl } from "@/lib/siteLegal";

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

  const [tplForm, setTplForm] = useState({ name: "", body: "", category: "utility", language: "en" });
  const [tplOpen, setTplOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const { data: configRes } = useQuery({
    queryKey: ["comm", "org-config"],
    queryFn: () => communicationsApi.orgConfig(),
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
  const waConnected = Boolean(config?.is_active) && config?.connection_status === "connected";

  useEffect(() => {
    if (waConnected || !isOrgAdmin) return;
    const key = `wa_setup_prompt_${organization?.id || "default"}`;
    if (sessionStorage.getItem(key)) return;
    setWizardOpen(true);
    sessionStorage.setItem(key, "1");
  }, [waConnected, isOrgAdmin, organization?.id]);

  const syncMut = useMutation({
    mutationFn: communicationsApi.syncMetaTemplates,
    onSuccess: (d) => {
      toast({ title: "Synced from Meta", description: `${d.imported} new, ${d.updated} updated` });
      qc.invalidateQueries({ queryKey: ["comm", "org-templates"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Sync failed", description: e.message }),
  });

  const createTplMut = useMutation({
    mutationFn: () => communicationsApi.createTemplate({ ...tplForm }),
    onSuccess: () => {
      toast({
        title: "Template saved",
        description: "Click Submit to Meta for official approval.",
      });
      setTplOpen(false);
      setTplForm({ name: "", body: "", category: "utility", language: "en" });
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
            {organization?.name || "Your organization"} — Meta WhatsApp Cloud API
          </p>
        </div>
      </div>

      <WhatsAppSetupHome
        userName={user?.full_name}
        connected={waConnected}
        businessPhone={config?.business_phone}
        onConnect={() => setWizardOpen(true)}
        onManage={() => setWizardOpen(true)}
      />

      {waConnected && config ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connection details</CardTitle>
            <CardDescription>
              Provider: <Badge variant="outline" className="text-xs">Meta</Badge>
              {" · "}Phone Number ID: <code className="text-xs">{config.phone_number_id || "—"}</code>
              {" · "}WABA ID: <code className="text-xs">{config.waba_id || "—"}</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Callback URL: <code className="text-xs break-all">{webhookUrl}</code></p>
            <p>Privacy Policy: <code className="text-xs break-all">{privacyPolicyUrl()}</code></p>
            <Button variant="outline" size="sm" onClick={() => setWizardOpen(true)}>
              Update API credentials
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <WhatsAppSetupWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        orgId={organization?.id}
        orgName={organization?.name}
        existingConfig={config}
        onConnected={() => qc.invalidateQueries({ queryKey: ["comm"] })}
      />

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Connect directly to Meta WhatsApp Cloud API. Use the Official Template Library for Meta-aligned templates.
          </span>
          <Button variant="secondary" size="sm" className="gap-1.5 shrink-0" asChild>
            <Link to="/communications/template-library"><BookOpen className="h-4 w-4" /> Template Library</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Official Meta templates</CardTitle>
            <CardDescription>Create templates and submit to Meta for approval</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => syncMut.mutate(undefined)} disabled={syncMut.isPending}>
              <RefreshCw className="h-4 w-4" /> Sync
            </Button>
            <Dialog open={tplOpen} onOpenChange={setTplOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> New</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New WhatsApp template</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Template name</Label>
                    <Input
                      value={tplForm.name}
                      onChange={(e) => setTplForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. welcome_lead_101"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Use lowercase letters, numbers, and underscores only (Meta requirement).
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Body ({'{{1}}'}, {'{{2}}'} for variables)</Label>
                    <Textarea rows={5} value={tplForm.body} onChange={(e) => setTplForm((p) => ({ ...p, body: e.target.value }))} />
                    <p className="text-[11px] text-muted-foreground">
                      Variables like {'{{1}}'} need sample values (added automatically on Submit). Do not start or end the body with a variable.
                    </p>
                  </div>
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
                      {(t.status === "draft" || (t.status === "pending_approval" && !t.meta_template_id)) ? (
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
