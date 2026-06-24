import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft, BadgeCheck, BookOpen, Building2, Plus, RefreshCw, Shield, Upload,
} from "lucide-react";
import { communicationsApi } from "@/services/communications";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { PlatformTemplateLibraryItem } from "@/types/communications";

const PARTNER_STEPS = [
  { key: "business_verification", label: "Meta Business Verification", desc: "Verify Syncpedia business in Meta Business Manager" },
  { key: "tech_provider", label: "Apply as Tech Provider", desc: "Submit at developers.facebook.com → WhatsApp → Become a Partner" },
  { key: "master_waba", label: "Master WABA templates", desc: "Publish official library templates to partner WABA first" },
  { key: "embedded_signup", label: "Embedded Signup for orgs", desc: "Orgs connect WhatsApp via your partner onboarding link" },
];

export default function MetaPartnerPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    partner_status: "pending",
    business_verification: "not_started",
    meta_app_id: "",
    meta_partner_business_id: "",
    master_waba_id: "",
    system_user_token: "",
    embedded_signup_config_id: "",
    solution_name: "Syncpedia CRM",
    partner_contact_email: "",
    onboarding_notes: "",
    is_active: false,
  });

  const [libOpen, setLibOpen] = useState(false);
  const [libForm, setLibForm] = useState({
    name: "", slug: "", body: "", category: "utility", description: "", use_case: "",
    meta_partner_preapproved: true,
  });

  const { data: configRes } = useQuery({ queryKey: ["comm", "meta-partner"], queryFn: communicationsApi.metaPartnerConfig });
  const { data: libraryRes } = useQuery({ queryKey: ["comm", "template-library"], queryFn: () => communicationsApi.templateLibrary() });

  const config = configRes?.data;
  const library = libraryRes?.data ?? [];

  useEffect(() => {
    if (!config) return;
    setForm((p) => ({
      ...p,
      partner_status: config.partner_status || "pending",
      business_verification: config.business_verification || "not_started",
      meta_app_id: config.meta_app_id || "",
      meta_partner_business_id: config.meta_partner_business_id || "",
      master_waba_id: config.master_waba_id || "",
      embedded_signup_config_id: config.embedded_signup_config_id || "",
      solution_name: config.solution_name || "Syncpedia CRM",
      partner_contact_email: config.partner_contact_email || "",
      onboarding_notes: config.onboarding_notes || "",
      is_active: Boolean(config.is_active),
    }));
  }, [config]);

  const saveMut = useMutation({
    mutationFn: () => communicationsApi.saveMetaPartnerConfig(form),
    onSuccess: () => {
      toast({ title: "Meta Partner config saved" });
      qc.invalidateQueries({ queryKey: ["comm"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Save failed", description: e.message }),
  });

  const createLibMut = useMutation({
    mutationFn: () => communicationsApi.createLibraryTemplate(libForm),
    onSuccess: () => {
      toast({ title: "Template added to official library" });
      setLibOpen(false);
      setLibForm({ name: "", slug: "", body: "", category: "utility", description: "", use_case: "", meta_partner_preapproved: true });
      qc.invalidateQueries({ queryKey: ["comm", "template-library"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Failed", description: e.message }),
  });

  const publishMut = useMutation({
    mutationFn: communicationsApi.publishPartnerTemplate,
    onSuccess: () => toast({ title: "Published to partner master WABA" }),
    onError: (e: Error) => toast({ variant: "destructive", title: "Publish failed", description: e.message }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/communications/admin"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" /> Meta Official Partner
          </h1>
          <p className="text-sm text-muted-foreground">
            Partner program + official template library for faster org approvals
          </p>
        </div>
      </div>

      <Card className="border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20">
        <CardContent className="pt-6 text-sm">
          <strong>Goal:</strong> Become a Meta WhatsApp Tech Provider so organizations onboard through Syncpedia and utility templates approve faster.
          Orgs customize official templates and apply to their own WABA — Meta reviews per org, but partner-aligned templates have higher approval rates.
        </CardContent>
      </Card>

      <Tabs defaultValue="partner">
        <TabsList>
          <TabsTrigger value="partner" className="gap-1.5"><Building2 className="h-4 w-4" /> Partner setup</TabsTrigger>
          <TabsTrigger value="library" className="gap-1.5"><BookOpen className="h-4 w-4" /> Official library ({library.length})</TabsTrigger>
          <TabsTrigger value="checklist" className="gap-1.5"><BadgeCheck className="h-4 w-4" /> Checklist</TabsTrigger>
        </TabsList>

        <TabsContent value="partner" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Partner credentials</CardTitle>
              <CardDescription>
                Status: <Badge>{form.partner_status}</Badge>{" "}
                {config?.is_active ? <Badge variant="default">Partner active</Badge> : <Badge variant="secondary">Not active</Badge>}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Partner status</Label>
                <Select value={form.partner_status} onValueChange={(v) => setForm((p) => ({ ...p, partner_status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_review">In review</SelectItem>
                    <SelectItem value="verified">Verified</SelectItem>
                    <SelectItem value="official">Official partner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Business verification</Label>
                <Select value={form.business_verification} onValueChange={(v) => setForm((p) => ({ ...p, business_verification: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_started">Not started</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="verified">Verified</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Meta App ID</Label>
                <Input value={form.meta_app_id} onChange={(e) => setForm((p) => ({ ...p, meta_app_id: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Partner Business ID</Label>
                <Input value={form.meta_partner_business_id} onChange={(e) => setForm((p) => ({ ...p, meta_partner_business_id: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Master WABA ID (partner templates)</Label>
                <Input value={form.master_waba_id} onChange={(e) => setForm((p) => ({ ...p, master_waba_id: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Embedded Signup Config ID</Label>
                <Input value={form.embedded_signup_config_id} onChange={(e) => setForm((p) => ({ ...p, embedded_signup_config_id: e.target.value }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>System user token</Label>
                <Input type="password" placeholder={config?.system_user_token_set ? "Leave blank to keep" : "From Meta Business Settings"} onChange={(e) => setForm((p) => ({ ...p, system_user_token: e.target.value }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Org onboarding URL (share with organizations)</Label>
                <Input readOnly value={config?.embedded_signup_url || ""} className="font-mono text-xs bg-muted/50" />
              </div>
              <div className="space-y-1.5">
                <Label>Solution name</Label>
                <Input value={form.solution_name} onChange={(e) => setForm((p) => ({ ...p, solution_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Partner contact email</Label>
                <Input value={form.partner_contact_email} onChange={(e) => setForm((p) => ({ ...p, partner_contact_email: e.target.value }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Onboarding notes (internal)</Label>
                <Textarea rows={3} value={form.onboarding_notes} onChange={(e) => setForm((p) => ({ ...p, onboarding_notes: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm((p) => ({ ...p, is_active: v }))} />
                <Label>Partner program active (unlock full template library for orgs)</Label>
              </div>
              <div className="sm:col-span-2">
                <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>Save partner config</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="library" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              Pre-built Meta-aligned templates. Utility types marked for faster partner approval.
            </p>
            <Dialog open={libOpen} onOpenChange={setLibOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1"><Plus className="h-4 w-4" /> Add template</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>New official template</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5"><Label>Name</Label><Input value={libForm.name} onChange={(e) => setLibForm((p) => ({ ...p, name: e.target.value }))} /></div>
                  <div className="space-y-1.5"><Label>Slug (optional)</Label><Input value={libForm.slug} onChange={(e) => setLibForm((p) => ({ ...p, slug: e.target.value }))} /></div>
                  <div className="space-y-1.5">
                    <Label>Category</Label>
                    <Select value={libForm.category} onValueChange={(v) => setLibForm((p) => ({ ...p, category: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="utility">Utility (fast approval)</SelectItem>
                        <SelectItem value="marketing">Marketing</SelectItem>
                        <SelectItem value="authentication">Authentication</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label>Body ({"{{1}}"}, {"{{2}}"}…)</Label><Textarea rows={4} value={libForm.body} onChange={(e) => setLibForm((p) => ({ ...p, body: e.target.value }))} /></div>
                </div>
                <DialogFooter>
                  <Button onClick={() => createLibMut.mutate()} disabled={createLibMut.isPending}>Add to library</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Partner fast-track</TableHead>
                    <TableHead>Body preview</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {library.map((t: PlatformTemplateLibraryItem) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="font-medium">{t.name}</div>
                        <div className="text-xs text-muted-foreground">{t.use_case}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{t.category}</Badge></TableCell>
                      <TableCell>
                        {t.meta_partner_preapproved ? (
                          <Badge className="gap-1"><BadgeCheck className="h-3 w-3" /> Yes</Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{t.body}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" className="gap-1 h-8" onClick={() => publishMut.mutate(t.id)} disabled={publishMut.isPending || !form.is_active}>
                          <Upload className="h-3 w-3" /> Publish WABA
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="checklist" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            {PARTNER_STEPS.map((step, i) => (
              <Card key={step.key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold">{i + 1}</span>
                    {step.label}
                  </CardTitle>
                  <CardDescription>{step.desc}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base">Apply at Meta</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2 text-muted-foreground">
              <p>1. Go to <a href="https://developers.facebook.com/docs/whatsapp/solution-providers/get-started" target="_blank" rel="noreferrer" className="text-primary underline">Meta WhatsApp Solution Providers</a></p>
              <p>2. Complete business verification in Meta Business Manager</p>
              <p>3. Create a Meta App with WhatsApp product and request Tech Provider access</p>
              <p>4. Set up Embedded Signup — orgs connect their WABA through Syncpedia</p>
              <p>5. Publish utility templates from this library to your master WABA first</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
