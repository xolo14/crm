import { useCallback, useEffect, useState } from "react";
import { CreditCard, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SaveButton } from "@/components/settings/ui/SaveButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type RazorpayStatus = {
  configured?: boolean;
  key_id?: string;
  key_id_masked?: string;
  key_secret_set?: boolean;
  webhook_secret_set?: boolean;
  mode?: string;
  is_active?: boolean;
  updated_at?: string | null;
};

type RazorpaySetupPayload = {
  organization?: { id?: string; name?: string };
  razorpay?: RazorpayStatus;
  platform_fallback_available?: boolean;
  webhook_url_hint?: string;
};

export function RazorpaySetup() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [status, setStatus] = useState<RazorpayStatus>({});
  const [platformFallback, setPlatformFallback] = useState(false);
  const [webhookHint, setWebhookHint] = useState("");
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [mode, setMode] = useState<"live" | "test">("live");

  const applyPayload = useCallback((data: RazorpaySetupPayload) => {
    setOrgName(data.organization?.name ?? "");
    const rz = data.razorpay ?? {};
    setStatus(rz);
    setKeyId(rz.key_id ?? "");
    setKeySecret("");
    setWebhookSecret("");
    setMode(rz.mode === "test" ? "test" : "live");
    setPlatformFallback(Boolean(data.platform_fallback_available));
    setWebhookHint(data.webhook_url_hint ?? "");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await api.settings.razorpaySetup()) as { data?: RazorpaySetupPayload };
      applyPayload(res?.data ?? {});
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not load Razorpay setup",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [applyPayload, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = async () => {
    setSaving(true);
    try {
      const payload: {
        key_id: string;
        key_secret?: string;
        webhook_secret?: string;
        mode: string;
      } = {
        key_id: keyId.trim(),
        mode,
      };
      if (keySecret.trim()) payload.key_secret = keySecret.trim();
      if (webhookSecret.trim()) payload.webhook_secret = webhookSecret.trim();
      const res = (await api.settings.saveRazorpaySetup(payload)) as { data?: RazorpaySetupPayload };
      applyPayload(res?.data ?? {});
      toast({ title: "Razorpay credentials saved" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const onClear = async () => {
    if (!window.confirm("Remove Razorpay credentials for this organization?")) return;
    setClearing(true);
    try {
      const res = (await api.settings.clearRazorpaySetup()) as { data?: RazorpaySetupPayload };
      applyPayload(res?.data ?? {});
      toast({ title: "Razorpay credentials cleared" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Clear failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setClearing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Razorpay setup…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Razorpay Setup"
        description={
          orgName
            ? `Payment credentials for ${orgName}. Each organization uses its own Razorpay account.`
            : "Payment credentials for your organization. Each organization uses its own Razorpay account."
        }
      >
        <SettingsRow label="Status" description="Whether this org can create payment links.">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={
                status.configured
                  ? "inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 text-emerald-700 px-2.5 py-1 text-xs font-medium"
                  : "inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 text-amber-800 px-2.5 py-1 text-xs font-medium"
              }
            >
              <CreditCard className="h-3.5 w-3.5" />
              {status.configured ? "Configured" : "Not configured"}
            </span>
            {platformFallback && !status.configured && (
              <span className="text-xs text-muted-foreground">
                Platform fallback keys are available until you save org credentials.
              </span>
            )}
          </div>
        </SettingsRow>

        <SettingsRow label="Mode">
          <Select value={mode} onValueChange={(v) => setMode(v === "test" ? "test" : "live")}>
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="test">Test</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          label="Key ID"
          description="From Razorpay Dashboard → Account & Settings → API Keys (starts with rzp_)."
        >
          <Input
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
            placeholder="rzp_live_…"
            className="max-w-md font-mono text-sm"
            autoComplete="off"
          />
        </SettingsRow>

        <SettingsRow
          label="Key Secret"
          description={
            status.key_secret_set
              ? "Secret is set. Leave blank to keep the current value, or paste a new secret to rotate."
              : "Required on first save. Never shown again after saving."
          }
        >
          <Input
            type="password"
            value={keySecret}
            onChange={(e) => setKeySecret(e.target.value)}
            placeholder={status.key_secret_set ? "•••••••• (unchanged)" : "Enter Key Secret"}
            className="max-w-md font-mono text-sm"
            autoComplete="new-password"
          />
        </SettingsRow>

        <SettingsRow
          label="Webhook Secret"
          description={
            status.webhook_secret_set
              ? "Webhook secret is set. Leave blank to keep, or paste a new secret to rotate."
              : "From Razorpay webhook settings (HMAC). Recommended so paid events update this org only."
          }
          border={false}
        >
          <Input
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={status.webhook_secret_set ? "•••••••• (unchanged)" : "whsec_…"}
            className="max-w-md font-mono text-sm"
            autoComplete="new-password"
          />
        </SettingsRow>
      </SettingsSection>

      {webhookHint ? (
        <SettingsSection
          title="Webhook URL"
          description="Point your Razorpay webhook (payment_link.paid / partially_paid) to this CRM endpoint."
        >
          <SettingsRow label="Callback URL" border={false}>
            <div className="flex flex-col gap-2 max-w-xl">
              <code className="text-xs break-all rounded-md bg-muted px-3 py-2">{webhookHint}</code>
              <a
                href="https://dashboard.razorpay.com/app/webhooks"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline w-fit"
              >
                Open Razorpay Webhooks
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </SettingsRow>
        </SettingsSection>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {(status.configured || status.key_secret_set) && (
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            disabled={clearing || saving}
            onClick={() => void onClear()}
          >
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Clear credentials
          </Button>
        )}
        <SaveButton onClick={() => void onSave()} loading={saving} label="Save Razorpay Settings" />
      </div>
    </div>
  );
}
