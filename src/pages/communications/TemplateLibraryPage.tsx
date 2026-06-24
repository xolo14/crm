import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft, BadgeCheck, BookOpen, CheckCircle2, Clock, FileText, Send, Sparkles,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { communicationsApi } from "@/services/communications";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { PlatformTemplateLibraryItem, WhatsappTemplate } from "@/types/communications";

const CATEGORY_LABELS: Record<string, string> = {
  utility: "Utility",
  marketing: "Marketing",
  authentication: "Authentication",
};

const STATUS_COLORS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  pending_approval: "outline",
  approved: "default",
  rejected: "destructive",
};

export default function TemplateLibraryPage() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>("all");
  const [selected, setSelected] = useState<PlatformTemplateLibraryItem | null>(null);
  const [custom, setCustom] = useState({ name: "", body: "", footer: "", header_text: "" });
  const [submitNow, setSubmitNow] = useState(true);

  const { data: libraryRes } = useQuery({
    queryKey: ["comm", "template-library", category],
    queryFn: () => communicationsApi.templateLibrary(category === "all" ? undefined : category),
  });
  const { data: myTemplatesRes } = useQuery({
    queryKey: ["comm", "my-applied-templates"],
    queryFn: () => communicationsApi.templates(),
  });

  const library = libraryRes?.data ?? [];
  const partnerActive = libraryRes?.partner_active ?? false;
  const myTemplates = (myTemplatesRes?.data ?? []).filter(
    (t: WhatsappTemplate) => t.application_source === "official_library" || t.platform_template_id,
  );

  const filtered = useMemo(() => {
    if (category === "all") return library;
    return library.filter((t) => t.category === category);
  }, [library, category]);

  const openCustomize = (t: PlatformTemplateLibraryItem) => {
    setSelected(t);
    setCustom({
      name: t.name,
      body: t.body,
      footer: t.footer || "",
      header_text: t.header_text || "",
    });
    setSubmitNow(true);
  };

  const applyMut = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("No template selected");
      return communicationsApi.applyLibraryTemplate({
        platform_template_id: selected.id,
        customization: {
          name: custom.name !== selected.name ? custom.name : undefined,
          body: custom.body !== selected.body ? custom.body : undefined,
          footer: custom.footer !== (selected.footer || "") ? custom.footer : undefined,
          header_text: custom.header_text !== (selected.header_text || "") ? custom.header_text : undefined,
        },
        submit_to_meta: submitNow,
      });
    },
    onSuccess: (data) => {
      if (data.submit_error) {
        toast({ variant: "destructive", title: "Saved but Meta submit failed", description: data.submit_error });
      } else {
        toast({
          title: data.status === "pending_approval" ? "Submitted to Meta" : "Template applied",
          description: data.message,
        });
      }
      setSelected(null);
      qc.invalidateQueries({ queryKey: ["comm"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Apply failed", description: e.message }),
  });

  const submitMut = useMutation({
    mutationFn: communicationsApi.submitTemplateToMeta,
    onSuccess: () => {
      toast({ title: "Submitted to Meta for approval" });
      qc.invalidateQueries({ queryKey: ["comm"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Submit failed", description: e.message }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/communications/whatsapp-setup"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" /> Official Template Library
          </h1>
          <p className="text-sm text-muted-foreground">
            {organization?.name || "Your org"} — Meta-aligned templates, customize and apply
          </p>
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6 flex flex-col sm:flex-row sm:items-center gap-3 text-sm">
          <Sparkles className="h-5 w-5 text-primary shrink-0" />
          <div>
            {partnerActive ? (
              <span><strong>Syncpedia Meta Partner active.</strong> Utility templates are pre-aligned for faster Meta approval. Customize placeholders, then apply to your WABA.</span>
            ) : (
              <span>Utility templates are pre-aligned with Meta guidelines. Connect WhatsApp in Setup, then apply templates for official Meta review.</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="browse">
        <TabsList>
          <TabsTrigger value="browse">Browse ({filtered.length})</TabsTrigger>
          <TabsTrigger value="applications">My applications ({myTemplates.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {["all", "utility", "marketing", "authentication"].map((c) => (
              <Button key={c} size="sm" variant={category === c ? "default" : "outline"} onClick={() => setCategory(c)}>
                {c === "all" ? "All" : CATEGORY_LABELS[c]}
              </Button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {filtered.length === 0 ? (
              <p className="text-muted-foreground col-span-2 text-center py-8">No templates in this category</p>
            ) : (
              filtered.map((t) => (
                <Card key={t.id} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{t.name}</CardTitle>
                      <div className="flex gap-1 shrink-0">
                        <Badge variant="outline">{CATEGORY_LABELS[t.category] || t.category}</Badge>
                        {t.meta_partner_preapproved ? (
                          <Badge className="gap-0.5 text-[10px]"><BadgeCheck className="h-3 w-3" /> Fast</Badge>
                        ) : null}
                      </div>
                    </div>
                    <CardDescription>{t.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col gap-3">
                    <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap flex-1">{t.body}</div>
                    {t.variables && t.variables.length > 0 ? (
                      <div className="text-xs text-muted-foreground">
                        Variables: {t.variables.map((v) => v.label).join(", ")}
                      </div>
                    ) : null}
                    <Button className="w-full gap-1.5" onClick={() => openCustomize(t)}>
                      <FileText className="h-4 w-4" /> Customize &amp; Apply
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="applications" className="mt-4 space-y-3">
          {myTemplates.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">No applications yet — browse official templates above</CardContent></Card>
          ) : (
            myTemplates.map((t: WhatsappTemplate) => (
              <Card key={t.id}>
                <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {t.name}
                      <Badge variant={STATUS_COLORS[t.status]}>{t.status}</Badge>
                      {t.meta_status ? <span className="text-xs text-muted-foreground">Meta: {t.meta_status}</span> : null}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{t.body}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {t.status === "draft" ? (
                      <Button size="sm" className="gap-1" onClick={() => submitMut.mutate(t.id)} disabled={submitMut.isPending}>
                        <Send className="h-3.5 w-3.5" /> Submit to Meta
                      </Button>
                    ) : t.status === "pending_approval" ? (
                      <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> Awaiting Meta</Badge>
                    ) : t.status === "approved" ? (
                      <Badge className="gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Ready to send</Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Customize: {selected?.name}</DialogTitle>
          </DialogHeader>
          {selected ? (
            <div className="space-y-3">
              {selected.meta_partner_preapproved ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 p-2 text-xs text-muted-foreground flex gap-2">
                  <BadgeCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                  Partner fast-track template — utility category, typically approved within hours by Meta.
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label>Display name</Label>
                <Input value={custom.name} onChange={(e) => setCustom((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Message body (keep {"{{1}}"}, {"{{2}}"} placeholders)</Label>
                <Textarea rows={5} value={custom.body} onChange={(e) => setCustom((p) => ({ ...p, body: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Footer (optional)</Label>
                <Input value={custom.footer} onChange={(e) => setCustom((p) => ({ ...p, footer: e.target.value }))} />
              </div>
              {selected.variables && selected.variables.length > 0 ? (
                <div className="rounded-lg border p-3 space-y-2">
                  <Label className="text-xs text-muted-foreground">Variable guide</Label>
                  {selected.variables.map((v) => (
                    <div key={v.key} className="text-sm flex justify-between gap-2">
                      <span>{"{{"}{v.key}{"}}"} — {v.label}</span>
                      <span className="text-muted-foreground text-xs">e.g. {v.example}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <Switch checked={submitNow} onCheckedChange={setSubmitNow} />
                <Label>Submit to Meta immediately after apply</Label>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button className="gap-1.5" onClick={() => applyMut.mutate()} disabled={applyMut.isPending}>
              <Send className="h-4 w-4" />
              {submitNow ? "Apply & Submit to Meta" : "Save draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
