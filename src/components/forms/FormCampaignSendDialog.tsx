import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { communicationsApi } from "@/services/communications";
import { useToast } from "@/hooks/use-toast";
import type { FormCampaignTemplate } from "@/components/forms/formCampaignTypes";
import { Button } from "@/components/ui/button";
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
import { Loader2, Mail, MessageSquare } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formId: string;
  channel: "email" | "whatsapp";
  submissionCount: number;
  onSent?: () => void;
};

export function FormCampaignSendDialog({
  open,
  onOpenChange,
  formId,
  channel,
  submissionCount,
  onSent,
}: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState<FormCampaignTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateSource, setTemplateSource] = useState<"marketing" | "communications">("marketing");

  useEffect(() => {
    if (!open || !formId) return;
    setLoading(true);
    setTemplateId("");
    api.forms
      .campaignTemplates(formId)
      .then(async (res) => {
        const data = res?.data || res;
        let list: FormCampaignTemplate[] = channel === "email" ? data?.email : data?.whatsapp;
        list = Array.isArray(list) ? list : [];

        if (channel === "whatsapp" && !list.some((t) => t.source === "communications")) {
          try {
            const commRes = await communicationsApi.templates({ status: "approved" });
            const commRows = commRes?.data || [];
            const commTemplates: FormCampaignTemplate[] = commRows.map((t) => ({
              id: t.id,
              name: t.org_name ? `${t.name} (${t.org_name})` : t.name,
              source: "communications",
              channel: "whatsapp",
              language: t.language,
            }));
            const seen = new Set(list.map((t) => t.id));
            for (const row of commTemplates) {
              if (!seen.has(row.id)) list.push(row);
            }
          } catch {
            /* backend campaign_templates is primary */
          }
        }

        setTemplates(list);
      })
      .catch((e: Error) => {
        toast({ variant: "destructive", title: "Failed to load templates", description: e.message });
      })
      .finally(() => setLoading(false));
  }, [open, formId, channel, toast]);

  const marketingTemplates = templates.filter((t) => t.source === "marketing");
  const commTemplates = templates.filter((t) => t.source === "communications");

  async function handleSend() {
    if (!templateId) {
      toast({ variant: "destructive", title: "Select a template" });
      return;
    }
    setSending(true);
    try {
      const res = await api.forms.sendCampaign({
        form_id: formId,
        channel,
        template_source: templateSource,
        template_id: templateId,
      });
      const sent = res?.data?.sent ?? 0;
      const failed = res?.data?.failed ?? 0;
      toast({
        title: channel === "email" ? "Email campaign sent" : "WhatsApp campaign sent",
        description: `${sent} sent${failed ? `, ${failed} failed` : ""}`,
      });
      onSent?.();
      onOpenChange(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Try again.";
      toast({ variant: "destructive", title: "Campaign failed", description: message });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {channel === "email" ? <Mail className="h-4 w-4" /> : <MessageSquare className="h-4 w-4 text-emerald-600" />}
            {channel === "email" ? "Email Campaign" : "WhatsApp Campaign"}
          </DialogTitle>
          <DialogDescription>
            Send to all {submissionCount} submission{submissionCount === 1 ? "" : "s"} for this form.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No templates found. Create drafts in Marketing or approve WhatsApp templates in Communications.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Template</Label>
              <Select
                value={templateId ? `${templateSource}:${templateId}` : ""}
                onValueChange={(v) => {
                  const [src, id] = v.split(":");
                  setTemplateSource(src === "communications" ? "communications" : "marketing");
                  setTemplateId(id);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose template" />
                </SelectTrigger>
                <SelectContent>
                  {marketingTemplates.length > 0 ? (
                    <SelectGroup>
                      <SelectLabel>Marketing</SelectLabel>
                      {marketingTemplates.map((t) => (
                        <SelectItem key={`marketing:${t.id}`} value={`marketing:${t.id}`}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                  {commTemplates.length > 0 ? (
                    <SelectGroup>
                      <SelectLabel>Communications</SelectLabel>
                      {commTemplates.map((t) => (
                        <SelectItem key={`communications:${t.id}`} value={`communications:${t.id}`}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={sending || loading || !templateId || submissionCount === 0}
            onClick={() => void handleSend()}
            className={channel === "whatsapp" ? "bg-emerald-700 hover:bg-emerald-800" : undefined}
          >
            {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Send to all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
