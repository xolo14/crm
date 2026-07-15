import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { communicationsApi } from "@/services/communications";
import { useToast } from "@/hooks/use-toast";
import {
  EMPTY_FORM_CAMPAIGN,
  type FormCampaignConfig,
  type FormCampaignTemplate,
} from "@/components/forms/formCampaignTypes";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formId: string | null;
  initial?: FormCampaignConfig;
  onConfirm: (campaign: FormCampaignConfig) => Promise<void>;
};

export function FormPublishCampaignDialog({
  open,
  onOpenChange,
  formId,
  initial,
  onConfirm,
}: Props) {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<FormCampaignConfig>({ ...EMPTY_FORM_CAMPAIGN, ...initial });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState<FormCampaignTemplate[]>([]);
  const [waTemplates, setWaTemplates] = useState<FormCampaignTemplate[]>([]);

  useEffect(() => {
    if (!open) return;
    setCfg({ ...EMPTY_FORM_CAMPAIGN, ...initial });
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const load = formId
      ? api.forms.campaignTemplates(formId).then(async (res) => {
          const data = res?.data || res;
          const email = Array.isArray(data?.email) ? data.email : [];
          let whatsapp = Array.isArray(data?.whatsapp) ? data.whatsapp : [];
          if (!whatsapp.some((t: FormCampaignTemplate) => t.source === "communications")) {
            try {
              const commRes = await communicationsApi.templates({ status: "approved" });
              const commRows = commRes?.data || [];
              const seen = new Set(whatsapp.map((t: FormCampaignTemplate) => t.id));
              for (const t of commRows) {
                if (seen.has(t.id)) continue;
                whatsapp.push({
                  id: t.id,
                  name: t.org_name ? `${t.name} (${t.org_name})` : t.name,
                  source: "communications",
                  channel: "whatsapp",
                });
              }
            } catch {
              /* ignore */
            }
          }
          return { email, whatsapp };
        })
      : Promise.all([
          api.marketing.emailDrafts({ mine: true }),
          api.marketing.whatsappDrafts({ mine: true }),
          communicationsApi.templates({ status: "approved" }),
        ]).then(([emailRes, waRes, commRes]) => ({
          email: (emailRes?.data || []).map((d: { id: string; name?: string; subject?: string }) => ({
            id: d.id,
            name: d.name || d.subject || "Draft",
            source: "marketing",
            channel: "email",
          })),
          whatsapp: [
            ...(waRes?.data || []).map((d: { id: string; name?: string; subject?: string }) => ({
              id: d.id,
              name: d.name || d.subject || "Draft",
              source: "marketing",
              channel: "whatsapp",
            })),
            ...(commRes?.data || []).map((t: { id: string; name: string }) => ({
              id: t.id,
              name: t.name,
              source: "communications",
              channel: "whatsapp",
            })),
          ],
        }));
    load
      .then((data) => {
        setEmailTemplates(Array.isArray(data?.email) ? data.email : []);
        setWaTemplates(Array.isArray(data?.whatsapp) ? data.whatsapp : []);
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : "Could not load templates";
        toast({ variant: "destructive", title: "Failed to load templates", description: message });
        setEmailTemplates([]);
        setWaTemplates([]);
      })
      .finally(() => setLoading(false));
  }, [open, formId]);

  const marketingEmail = emailTemplates.filter((t) => t.source === "marketing");
  const marketingWa = waTemplates.filter((t) => t.source === "marketing");
  const commWa = waTemplates.filter((t) => t.source === "communications");

  async function handlePublish() {
    if (cfg.assign_email && !cfg.email_template_id) {
      toast({ variant: "destructive", title: "Select an email template" });
      return;
    }
    if (cfg.assign_whatsapp && !cfg.whatsapp_template_id) {
      toast({ variant: "destructive", title: "Select a WhatsApp template" });
      return;
    }
    setSaving(true);
    try {
      await onConfirm(cfg);
      onOpenChange(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Publish failed";
      toast({ variant: "destructive", title: "Publish failed", description: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[min(90dvh,calc(100dvh-2rem))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Campaign setup on publish</DialogTitle>
          <DialogDescription>
            Optionally assign campaigns and send to all existing submissions when you publish.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-3 rounded-lg border p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={Boolean(cfg.assign_email)}
                  onCheckedChange={(c) => setCfg((p) => ({ ...p, assign_email: c === true }))}
                  className="mt-0.5"
                />
                <div className="space-y-2 flex-1">
                  <p className="text-sm font-medium">Auto-assign email campaign</p>
                  <p className="text-xs text-muted-foreground">Send to all existing leads when published.</p>
                  {cfg.assign_email ? (
                    <Select
                      value={cfg.email_template_id ? `marketing:${cfg.email_template_id}` : ""}
                      onValueChange={(v) => {
                        const id = v.split(":")[1] || "";
                        setCfg((p) => ({ ...p, email_source: "marketing", email_template_id: id }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Email template (Marketing)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>Marketing</SelectLabel>
                          {marketingEmail.map((t) => (
                            <SelectItem key={t.id} value={`marketing:${t.id}`}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              </label>
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={Boolean(cfg.assign_whatsapp)}
                  onCheckedChange={(c) => setCfg((p) => ({ ...p, assign_whatsapp: c === true }))}
                  className="mt-0.5"
                />
                <div className="space-y-2 flex-1">
                  <p className="text-sm font-medium">Auto-assign WhatsApp campaign</p>
                  <p className="text-xs text-muted-foreground">Send to all existing leads when published.</p>
                  {cfg.assign_whatsapp ? (
                    <Select
                      value={
                        cfg.whatsapp_template_id
                          ? `${cfg.whatsapp_source || "marketing"}:${cfg.whatsapp_template_id}`
                          : ""
                      }
                      onValueChange={(v) => {
                        const [src, id] = v.split(":");
                        setCfg((p) => ({
                          ...p,
                          whatsapp_source: src === "communications" ? "communications" : "marketing",
                          whatsapp_template_id: id,
                        }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="WhatsApp template" />
                      </SelectTrigger>
                      <SelectContent>
                        {marketingWa.length > 0 ? (
                          <SelectGroup>
                            <SelectLabel>Marketing</SelectLabel>
                            {marketingWa.map((t) => (
                              <SelectItem key={`m:${t.id}`} value={`marketing:${t.id}`}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ) : null}
                        {commWa.length > 0 ? (
                          <SelectGroup>
                            <SelectLabel>Communications</SelectLabel>
                            {commWa.map((t) => (
                              <SelectItem key={`c:${t.id}`} value={`communications:${t.id}`}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ) : null}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              </label>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              void onConfirm({ ...EMPTY_FORM_CAMPAIGN });
            }}
          >
            Publish without campaigns
          </Button>
          <Button disabled={saving} onClick={() => void handlePublish()}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Publish & assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
