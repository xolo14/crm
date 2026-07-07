import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Upload,
  X,
} from "lucide-react";
import { communicationsApi } from "@/services/communications";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { OrgWhatsappConfig } from "@/types/communications";

export type WhatsAppNumberSetupType = "wa_business_app" | "new_number";
export type WhatsAppVerificationMethod = "gst" | "website" | "none";

export interface WhatsAppSetupDraft {
  numberType: WhatsAppNumberSetupType | null;
  businessCountry: string;
  metaAlreadyVerified: boolean;
  verificationMethod: WhatsAppVerificationMethod;
  gstFileName?: string;
}

const DEFAULT_DRAFT: WhatsAppSetupDraft = {
  numberType: null,
  businessCountry: "IN",
  metaAlreadyVerified: false,
  verificationMethod: "gst",
};

function draftStorageKey(orgId?: string) {
  return `wa_setup_draft_${orgId || "default"}`;
}

export function loadWhatsAppSetupDraft(orgId?: string): WhatsAppSetupDraft {
  try {
    const raw = localStorage.getItem(draftStorageKey(orgId));
    if (!raw) return { ...DEFAULT_DRAFT };
    return { ...DEFAULT_DRAFT, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_DRAFT };
  }
}

export function saveWhatsAppSetupDraft(orgId: string | undefined, draft: WhatsAppSetupDraft) {
  localStorage.setItem(draftStorageKey(orgId), JSON.stringify(draft));
}

type WizardStep = 1 | 2 | 3;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId?: string;
  orgName?: string;
  existingConfig?: OrgWhatsappConfig | null;
  onConnected?: () => void;
}

export default function WhatsAppSetupWizard({
  open,
  onOpenChange,
  orgId,
  orgName,
  existingConfig,
  onConnected,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState<WizardStep>(1);
  const [draft, setDraft] = useState<WhatsAppSetupDraft>(() => loadWhatsAppSetupDraft(orgId));
  const [waForm, setWaForm] = useState({
    provider: "interakt" as "interakt" | "meta",
    api_key: "",
    app_secret: "",
    business_phone: "",
    phone_number_id: "",
    waba_id: "",
    webhook_verify_token: "",
    graph_api_version: "v21.0",
    is_active: true,
  });

  const isInterakt = waForm.provider === "interakt";

  useEffect(() => {
    if (!open) return;
    setDraft(loadWhatsAppSetupDraft(orgId));
    if (existingConfig) {
      const provider = existingConfig.provider === "meta" ? "meta" : "interakt";
      setWaForm((p) => ({
        ...p,
        provider,
        business_phone: existingConfig.business_phone || "",
        phone_number_id: existingConfig.phone_number_id || "",
        waba_id: existingConfig.waba_id || "",
        graph_api_version: existingConfig.graph_api_version || "v21.0",
        is_active: Boolean(existingConfig.is_active),
      }));
    }
    setStep(1);
  }, [open, orgId, existingConfig]);

  const patchDraft = (patch: Partial<WhatsAppSetupDraft>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      saveWhatsAppSetupDraft(orgId, next);
      return next;
    });
  };

  const saveMut = useMutation({
    mutationFn: () =>
      communicationsApi.saveOrgConfig({
        ...waForm,
        provider: waForm.provider,
        org_id: orgId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["comm"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Save failed", description: e.message }),
  });

  const testMut = useMutation({
    mutationFn: () => communicationsApi.testWhatsappConnection(orgId),
    onSuccess: (d) => {
      const detail =
        d.data?.verified_name ||
        d.data?.display_phone_number ||
        d.message ||
        "WhatsApp provider connected";
      toast({ title: "WhatsApp connected", description: detail });
      onConnected?.();
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Connection failed", description: e.message }),
  });

  const handleConnect = async () => {
    if (isInterakt) {
      if (!waForm.api_key.trim() && !existingConfig?.api_key_set) {
        toast({ variant: "destructive", title: "Interakt API key is required" });
        return;
      }
    } else if (!waForm.phone_number_id.trim() || !waForm.waba_id.trim()) {
      toast({ variant: "destructive", title: "Phone Number ID and WABA ID are required" });
      return;
    }
    try {
      await saveMut.mutateAsync();
      await testMut.mutateAsync();
    } catch {
      /* toast from mutations */
    }
  };

  const startInteraktSetup = () => {
    setWaForm((p) => ({ ...p, provider: "interakt" }));
    setStep(3);
  };

  const startMetaSetup = () => {
    setWaForm((p) => ({ ...p, provider: "meta" }));
    setStep(2);
  };

  const progressPct = step === 1 ? 50 : 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        <div className="sticky top-0 z-10 border-b bg-background px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {step > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => setStep((s) => (s === 3 ? 2 : 1) as WizardStep)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              ) : null}
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  Step {step} of {step === 3 ? 3 : 2}
                </p>
                <div className="mt-1 h-1.5 w-40 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 transition-all"
                    style={{ width: `${step === 3 ? 100 : progressPct}%` }}
                  />
                </div>
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 flex justify-center">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-xs font-medium text-emerald-800">
              {isInterakt ? "Interakt WhatsApp API" : "Meta WhatsApp Business API"}
            </span>
          </div>
        </div>

        {step === 1 ? (
          <div className="px-6 py-5 space-y-5">
            <div className="text-center space-y-1">
              <h2 className="text-xl font-semibold">Connect WhatsApp</h2>
              <p className="text-sm text-muted-foreground">
                Use Interakt (recommended) or connect Meta Cloud API directly.
              </p>
            </div>

            <Card className="border-emerald-200 bg-emerald-50/40">
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-emerald-900">Interakt</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Connect with your Interakt API key from Developer Settings. Templates are managed in Interakt dashboard.
                  </p>
                </div>
                <Button className="bg-emerald-800 hover:bg-emerald-900 shrink-0" onClick={startInteraktSetup}>
                  Connect Interakt
                </Button>
              </CardContent>
            </Card>

            <p className="text-xs text-center text-muted-foreground uppercase tracking-wide">Or connect Meta directly</p>

            <div className="grid md:grid-cols-2 gap-0 border rounded-xl overflow-hidden">
              <SetupOptionCard
                title="WA Business App Number"
                titleClass="text-violet-700 bg-violet-50"
                selected={draft.numberType === "wa_business_app"}
                onSelect={() => patchDraft({ numberType: "wa_business_app" })}
                requirements={[
                  "A number registered on WhatsApp Business App version 2.24.4+",
                  "GST Certificate or Active Website needed for verification",
                ]}
                rows={[
                  { label: "Number", value: "No new number needed. Use your existing WhatsApp Business App number." },
                  { label: "App Usage", value: "Continue using WhatsApp Business App alongside Syncpedia CRM." },
                ]}
                actionLabel="Proceed with WA business"
                onProceed={() => {
                  patchDraft({ numberType: "wa_business_app" });
                  startMetaSetup();
                }}
              />
              <SetupOptionCard
                title="New Number"
                titleClass="text-sky-700 bg-sky-50"
                selected={draft.numberType === "new_number"}
                onSelect={() => patchDraft({ numberType: "new_number" })}
                requirements={[
                  "Fresh number not on WA Personal/Business",
                  "Must be able to receive OTP via call or SMS",
                  "GST Certificate or Active Website needed for verification",
                ]}
                rows={[
                  { label: "Number", value: "Requires a fresh phone number. Cannot be already registered on WhatsApp." },
                  { label: "App Usage", value: "Cannot use WhatsApp Business/Personal app. Fully API-based — manage everything inside CRM." },
                ]}
                actionLabel="Proceed with New Number"
                onProceed={() => {
                  patchDraft({ numberType: "new_number" });
                  startMetaSetup();
                }}
                borderedLeft
              />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="px-6 py-5 space-y-5">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold">Verify Your Business</h2>
                <span className="rounded-md bg-emerald-800 px-2 py-0.5 text-[10px] font-semibold text-white uppercase">
                  Recommended
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Verification helps increase your messaging limits and improves trust.
              </p>
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-4 py-3 flex gap-2 text-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-emerald-900">Why Verification is Important</p>
                <p className="text-emerald-800">Messaging limit increases from 250 → 1,000 customers per day.</p>
              </div>
            </div>

            <div className="space-y-1.5 max-w-xs">
              <Label className="text-xs uppercase text-muted-foreground">Business country</Label>
              <Select
                value={draft.businessCountry}
                onValueChange={(v) => patchDraft({ businessCountry: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN">India</SelectItem>
                  <SelectItem value="US">United States</SelectItem>
                  <SelectItem value="AE">United Arab Emirates</SelectItem>
                  <SelectItem value="SG">Singapore</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <label
              className={cn(
                "flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer",
                draft.metaAlreadyVerified ? "border-sky-300 bg-sky-50/60" : "border-border",
              )}
            >
              <Checkbox
                checked={draft.metaAlreadyVerified}
                onCheckedChange={(c) => patchDraft({ metaAlreadyVerified: c === true })}
                className="mt-0.5"
              />
              <div>
                <p className="font-medium text-sm">My business is already verified by Meta</p>
                <p className="text-xs text-muted-foreground">
                  Select this if you have already completed Meta Business Verification.
                </p>
              </div>
            </label>

            <div className={cn("space-y-2", draft.metaAlreadyVerified && "opacity-50 pointer-events-none")}>
              <p className="text-sm font-medium">Verification method</p>
              <div className="grid md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => patchDraft({ verificationMethod: "gst" })}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-colors",
                    draft.verificationMethod === "gst" ? "border-emerald-600 ring-1 ring-emerald-600" : "hover:border-muted-foreground/30",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">Verify using GST Certificate</span>
                    <span className="rounded bg-emerald-800 px-1.5 py-0.5 text-[10px] text-white font-medium">Fastest</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Takes a few minutes to a few hours
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                    <FileText className="h-3 w-3" /> PDF, JPEG, JPG & PNG (no screenshots)
                  </p>
                  <div className="mt-3 border border-dashed rounded-lg py-6 flex flex-col items-center gap-1 text-xs text-muted-foreground">
                    <Upload className="h-4 w-4" />
                    {draft.gstFileName || "Upload GST Certificate"}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      id="gst-upload"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) patchDraft({ gstFileName: f.name, verificationMethod: "gst" });
                      }}
                    />
                    <label htmlFor="gst-upload" className="text-emerald-700 font-medium cursor-pointer">
                      Choose file
                    </label>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => patchDraft({ verificationMethod: "website" })}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-colors",
                    draft.verificationMethod === "website" ? "border-emerald-600 ring-1 ring-emerald-600" : "hover:border-muted-foreground/30",
                  )}
                >
                  <span className="font-semibold text-sm">Verify using Website Domain</span>
                  <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Takes 3–5 working days
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" /> Requires a verifiable website with additional details
                  </p>
                  <Button type="button" variant="outline" size="sm" className="mt-4 w-full" disabled>
                    Watch how to verify
                  </Button>
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  patchDraft({ verificationMethod: "none" });
                  setStep(3);
                }}
              >
                Connect without Verification
              </button>
              <Button
                className="bg-emerald-800 hover:bg-emerald-900 min-w-[160px]"
                onClick={() => setStep(3)}
              >
                Connect Number
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="px-6 py-5 space-y-5">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">
                {isInterakt ? "Connect Interakt" : "Connect WhatsApp API"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {isInterakt
                  ? `Paste your Interakt credentials for ${orgName || "your organization"}. API key: app.interakt.ai → Settings → Developer Settings.`
                  : `Paste your Meta credentials for ${orgName || "your organization"}. Find these in Meta Business Suite → WhatsApp → API Setup.`}
              </p>
            </div>

            <div className="space-y-1.5 max-w-xs">
              <Label>Provider</Label>
              <Select
                value={waForm.provider}
                onValueChange={(v: "interakt" | "meta") => setWaForm((p) => ({ ...p, provider: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="interakt">Interakt</SelectItem>
                  <SelectItem value="meta">Meta Cloud API</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!isInterakt ? (
            <div className="rounded-lg bg-muted/40 border px-3 py-2 text-xs text-muted-foreground">
              Setup path:{" "}
              <strong>{draft.numberType === "new_number" ? "New Number" : "WA Business App"}</strong>
              {" · "}
              {draft.metaAlreadyVerified
                ? "Meta verified"
                : draft.verificationMethod === "gst"
                  ? "GST verification"
                  : draft.verificationMethod === "website"
                    ? "Website verification"
                    : "Skipped verification"}
            </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{isInterakt ? "Interakt API key (Secret Key)" : "Permanent access token"}</Label>
                <Input
                  type="password"
                  placeholder={existingConfig?.api_key_set ? "Leave blank to keep current key" : isInterakt ? "From Interakt Developer Settings" : "EAAxxxx…"}
                  onChange={(e) => setWaForm((p) => ({ ...p, api_key: e.target.value }))}
                />
              </div>
              {isInterakt ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Business phone (display)</Label>
                    <Input
                      value={waForm.business_phone}
                      onChange={(e) => setWaForm((p) => ({ ...p, business_phone: e.target.value }))}
                      placeholder="+91…"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Webhook secret (recommended)</Label>
                    <Input
                      type="password"
                      placeholder="From Interakt Developer Settings"
                      onChange={(e) => setWaForm((p) => ({ ...p, app_secret: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Webhook URL (paste in Interakt)</Label>
                    <Input
                      readOnly
                      value={existingConfig?.webhook_url_suggested || "https://your-domain.com/api/whatsapp_webhook.php"}
                      className="text-xs font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Enable message_api_sent, message_api_delivered, message_api_read, message_api_failed webhooks in Interakt.
                    </p>
                  </div>
                </>
              ) : (
                <>
              <div className="space-y-1.5">
                <Label>Phone Number ID</Label>
                <Input
                  value={waForm.phone_number_id}
                  onChange={(e) => setWaForm((p) => ({ ...p, phone_number_id: e.target.value }))}
                  placeholder="From Meta API setup"
                />
              </div>
              <div className="space-y-1.5">
                <Label>WABA ID</Label>
                <Input
                  value={waForm.waba_id}
                  onChange={(e) => setWaForm((p) => ({ ...p, waba_id: e.target.value }))}
                  placeholder="WhatsApp Business Account ID"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Business phone</Label>
                <Input
                  value={waForm.business_phone}
                  onChange={(e) => setWaForm((p) => ({ ...p, business_phone: e.target.value }))}
                  placeholder="+91…"
                />
              </div>
              <div className="space-y-1.5">
                <Label>App secret (optional)</Label>
                <Input
                  type="password"
                  placeholder="For webhook security"
                  onChange={(e) => setWaForm((p) => ({ ...p, app_secret: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Webhook verify token</Label>
                <Input
                  value={waForm.webhook_verify_token}
                  onChange={(e) => setWaForm((p) => ({ ...p, webhook_verify_token: e.target.value }))}
                  placeholder="Match in Meta App dashboard"
                />
              </div>
                </>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={() => setStep(isInterakt ? 1 : 2)}>
                Back
              </Button>
              <Button
                className="bg-emerald-800 hover:bg-emerald-900 min-w-[180px]"
                disabled={saveMut.isPending || testMut.isPending}
                onClick={() => void handleConnect()}
              >
                {saveMut.isPending || testMut.isPending ? "Connecting…" : "Save & Connect"}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SetupOptionCard({
  title,
  titleClass,
  selected,
  onSelect,
  requirements,
  rows,
  actionLabel,
  onProceed,
  borderedLeft,
}: {
  title: string;
  titleClass: string;
  selected: boolean;
  onSelect: () => void;
  requirements: string[];
  rows: { label: string; value: string }[];
  actionLabel: string;
  onProceed: () => void;
  borderedLeft?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col p-5 bg-background",
        borderedLeft && "md:border-l",
        selected && "ring-2 ring-inset ring-emerald-500/50",
      )}
      onClick={onSelect}
      onKeyDown={() => {}}
      role="button"
      tabIndex={0}
    >
      <div className={cn("rounded-md px-3 py-2 text-center text-sm font-semibold mb-4", titleClass)}>
        {title}
      </div>
      <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Requirements before connecting</p>
      <ul className="text-sm space-y-1.5 mb-4 list-disc pl-4 text-muted-foreground">
        {requirements.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {rows.map((row) => (
        <div key={row.label} className="mb-3">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">{row.label}</p>
          <p className="text-sm mt-0.5">{row.value}</p>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="mt-auto border-emerald-200 text-emerald-800 hover:bg-emerald-50"
        onClick={(e) => {
          e.stopPropagation();
          onProceed();
        }}
      >
        {actionLabel}
      </Button>
    </div>
  );
}
