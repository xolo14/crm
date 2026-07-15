import { useEffect, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ChevronDown, ExternalLink, Facebook, MessageCircle, X } from "lucide-react";

import { communicationsApi } from "@/services/communications";

import { launchMetaEmbeddedSignup } from "@/lib/metaEmbeddedSignup";

import { Button } from "@/components/ui/button";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { Input } from "@/components/ui/input";

import { PasswordInput } from "@/components/ui/password-input";

import { Label } from "@/components/ui/label";

import { useToast } from "@/hooks/use-toast";

import type { OrgWhatsappConfig } from "@/types/communications";

import { privacyPolicyUrl, termsOfServiceUrl } from "@/lib/siteLegal";

import { cn } from "@/lib/utils";



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

  const [manualOpen, setManualOpen] = useState(false);

  const [connecting, setConnecting] = useState(false);

  const [waForm, setWaForm] = useState({

    provider: "meta" as const,

    api_key: "",

    app_secret: "",

    business_phone: "",

    phone_number_id: "",

    waba_id: "",

    webhook_verify_token: "",

    graph_api_version: "v21.0",

    is_active: true,

  });



  const { data: launchRes, isLoading: launchLoading } = useQuery({

    queryKey: ["comm", "embedded-signup-launch"],

    queryFn: () => communicationsApi.embeddedSignupLaunch(),

    enabled: open,

    staleTime: 60_000,

  });



  const launch = launchRes?.data;

  const embeddedReady = Boolean(launchRes?.ready && launch?.meta_app_id && launch?.embedded_signup_config_id);



  useEffect(() => {

    if (!open) return;

    if (existingConfig) {

      setWaForm((p) => ({

        ...p,

        provider: "meta",

        business_phone: existingConfig.business_phone || "",

        phone_number_id: existingConfig.phone_number_id || "",

        waba_id: existingConfig.waba_id || "",

        graph_api_version: existingConfig.graph_api_version || "v21.0",

        is_active: Boolean(existingConfig.is_active),

      }));

    }

  }, [open, orgId, existingConfig]);



  const saveMut = useMutation({

    mutationFn: () =>

      communicationsApi.saveOrgConfig({

        ...waForm,

        provider: "meta",

        org_id: orgId,

      }),

    onSuccess: () => {

      qc.invalidateQueries({ queryKey: ["comm"] });

    },

    onError: (e: Error) => toast({ variant: "destructive", title: "Save failed", description: e.message }),

  });



  const testMut = useMutation({

    mutationFn: (opts?: { api_key?: string }) =>

      communicationsApi.testWhatsappConnection({

        orgId,

        provider: "meta",

        api_key: opts?.api_key,

        app_secret: waForm.app_secret.trim() || undefined,

        phone_number_id: waForm.phone_number_id.trim() || undefined,

        waba_id: waForm.waba_id.trim() || undefined,

      }),

    onSuccess: (d) => {
      const phone = d.data?.display_phone_number?.trim();
      const name = d.data?.verified_name?.trim();
      const detail = phone
        ? name && name.toLowerCase() !== phone.toLowerCase()
          ? `${phone} · ${name}`
          : phone
        : name || d.message || "WhatsApp provider connected";
      toast({ title: "WhatsApp connected", description: detail });
      onConnected?.();
      onOpenChange(false);
    },

    onError: (e: Error) => toast({ variant: "destructive", title: "Connection failed", description: e.message }),

  });



  const completeMut = useMutation({

    mutationFn: (body: { code: string; phone_number_id: string; waba_id: string }) =>

      communicationsApi.completeEmbeddedSignup({ ...body, org_id: orgId }),

    onSuccess: (d) => {
      const phone = d.data?.display_phone_number?.trim();
      const name = d.data?.verified_name?.trim();
      const detail = phone
        ? name && name.toLowerCase() !== phone.toLowerCase()
          ? `${phone} · ${name}`
          : phone
        : name || d.message;
      toast({ title: "WhatsApp connected", description: detail });
      qc.invalidateQueries({ queryKey: ["comm"] });
      onConnected?.();
      onOpenChange(false);
    },

    onError: (e: Error) => toast({ variant: "destructive", title: "Connection failed", description: e.message }),

  });



  async function handleEmbeddedConnect() {

    if (!launch || !embeddedReady) {

      toast({

        variant: "destructive",

        title: "Embedded Signup not configured",

        description: "Your platform admin must set Meta App ID, Configuration ID, and App Secret in Meta Partner settings.",

      });

      setManualOpen(true);

      return;

    }

    setConnecting(true);

    try {

      const payload = await launchMetaEmbeddedSignup(launch);

      await completeMut.mutateAsync(payload);

    } catch (e: unknown) {

      const message = e instanceof Error ? e.message : "Meta login failed";

      toast({ variant: "destructive", title: "Could not connect", description: message });

    } finally {

      setConnecting(false);

    }

  }



  function openMetaOnboardInNewTab() {

    const url = launch?.embedded_signup_url?.trim();

    if (!url) {

      toast({ variant: "destructive", title: "Onboarding URL not available" });

      return;

    }

    window.open(url, "_blank", "noopener,noreferrer");

  }



  async function handleManualConnect() {

    if (!waForm.phone_number_id.trim() || !waForm.waba_id.trim()) {

      toast({ variant: "destructive", title: "Phone Number ID and WABA ID are required" });

      return;

    }

    if (!waForm.api_key.trim() && !existingConfig?.api_key_set) {

      toast({ variant: "destructive", title: "Meta permanent access token is required" });

      return;

    }

    try {

      await saveMut.mutateAsync();

      await testMut.mutateAsync({

        api_key: waForm.api_key.trim() || undefined,

      });

    } catch {

      /* toast from mutations */

    }

  }



  const busy = connecting || saveMut.isPending || testMut.isPending || completeMut.isPending;



  return (

    <Dialog open={open} onOpenChange={onOpenChange}>

      <DialogContent className="max-w-3xl max-h-[min(92dvh,100%)] overflow-y-auto p-0 gap-0">

        <DialogTitle className="sr-only">Connect Meta WhatsApp API</DialogTitle>

        <DialogDescription className="sr-only">

          Log in with Facebook or WhatsApp Business to connect your number.

        </DialogDescription>

        <div className="sticky top-0 z-10 border-b bg-background px-6 py-4">

          <div className="flex items-center justify-between gap-3">

            <div className="min-w-0">

              <p className="text-xs text-muted-foreground">WhatsApp Setup</p>

              <div className="mt-1 h-1.5 w-40 rounded-full bg-muted overflow-hidden">

                <div className="h-full w-full bg-emerald-600" />

              </div>

            </div>

            <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)}>

              <X className="h-4 w-4" />

            </Button>

          </div>

          <div className="mt-3 flex justify-center">

            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-xs font-medium text-emerald-800">

              Meta WhatsApp Business API

            </span>

          </div>

        </div>



        <div className="px-6 py-5 space-y-5">

          <div className="space-y-1 text-center">

            <h2 className="text-xl font-semibold">Log in to Business Tools from Meta</h2>

            <p className="text-sm text-muted-foreground max-w-lg mx-auto">

              Connect {orgName || "your organization"}&apos;s WhatsApp number via Meta Embedded Signup v4.
              Sign in with Facebook or WhatsApp Business — Meta returns your token, phone number ID, and WABA ID automatically.

            </p>

          </div>

          <div className="rounded-lg border border-sky-100 bg-sky-50/80 px-4 py-3 text-xs text-sky-900 space-y-1">
            <p className="font-medium text-sm">After connecting</p>
            <ul className="list-disc pl-4 space-y-0.5 text-sky-800/90">
              <li>Tech providers: add a payment method to your WhatsApp Business account in Meta before sending messages.</li>
              <li>App needs <strong>whatsapp_business_messaging</strong> and <strong>whatsapp_business_management</strong> approved via App Review.</li>
              <li>Paste the webhook callback URL below into your Meta App Dashboard.</li>
            </ul>
          </div>



          <div className="mx-auto max-w-sm space-y-3">

            <Button

              type="button"

              variant="outline"

              className="w-full h-12 justify-center gap-3 rounded-full border-2 text-base font-medium"

              disabled={busy || launchLoading}

              onClick={() => void handleEmbeddedConnect()}

            >

              <Facebook className="h-5 w-5 text-[#1877F2]" />

              {connecting ? "Connecting…" : "Continue with Facebook"}

            </Button>

            <Button

              type="button"

              variant="outline"

              className="w-full h-12 justify-center gap-3 rounded-full border-2 text-base font-medium"

              disabled={busy || launchLoading}

              onClick={() => void handleEmbeddedConnect()}

            >

              <MessageCircle className="h-5 w-5 text-[#25D366]" />

              {connecting ? "Connecting…" : "Continue with WhatsApp Business"}

            </Button>

          </div>



          {!launchLoading && !embeddedReady ? (

            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">

              <p className="font-medium">Direct login needs platform setup</p>

              <p className="mt-1 text-amber-800/90">

                Create a <strong>v4</strong> config in Meta App Dashboard → WhatsApp → Embedded Signup Builder, then save App ID, Config ID, and App Secret in Meta Partner settings

                {launch?.missing?.length ? ` — missing: ${launch.missing.join(", ")}` : ""}.

                You can still connect manually below.

              </p>

            </div>

          ) : null}



          {embeddedReady && launch?.embedded_signup_url ? (

            <p className="text-center text-xs text-muted-foreground">

              Popup blocked?{" "}

              <button type="button" className="underline hover:text-foreground inline-flex items-center gap-1" onClick={openMetaOnboardInNewTab}>

                Open Meta onboarding in a new tab <ExternalLink className="h-3 w-3" />

              </button>

            </p>

          ) : null}



          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground space-y-2">

            <p className="font-medium text-foreground text-sm">After connecting, paste these in Meta App Dashboard</p>

            <div>

              <span className="font-medium">Callback URL:</span>{" "}

              <code className="break-all">{existingConfig?.webhook_url_suggested || "https://your-domain.com/api/whatsapp/webhook"}</code>

            </div>

            <div>

              <span className="font-medium">Privacy Policy:</span> <code>{privacyPolicyUrl()}</code>

            </div>

            <div>

              <span className="font-medium">Terms:</span> <code>{termsOfServiceUrl()}</code>

            </div>

          </div>



          <div className="border-t pt-4">

            <button

              type="button"

              className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground"

              onClick={() => setManualOpen((v) => !v)}

            >

              Advanced: enter API credentials manually

              <ChevronDown className={cn("h-4 w-4 transition-transform", manualOpen && "rotate-180")} />

            </button>



            {manualOpen ? (

              <div className="mt-4 grid gap-4 sm:grid-cols-2">

                <div className="space-y-1.5 sm:col-span-2">

                  <Label>Permanent access token</Label>

                  <PasswordInput

                    placeholder={existingConfig?.api_key_set ? "Leave blank to keep current token" : "EAAxxxx…"}

                    onChange={(e) => setWaForm((p) => ({ ...p, api_key: e.target.value }))}

                    autoComplete="off"

                  />

                </div>

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

                  <Label>App secret</Label>

                  <PasswordInput

                    placeholder="For webhook signature validation"

                    onChange={(e) => setWaForm((p) => ({ ...p, app_secret: e.target.value }))}

                    autoComplete="off"

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

                <div className="sm:col-span-2 flex justify-end">

                  <Button type="button" variant="secondary" disabled={busy} onClick={() => void handleManualConnect()}>

                    {saveMut.isPending || testMut.isPending ? "Saving…" : "Save & Connect manually"}

                  </Button>

                </div>

              </div>

            ) : null}

          </div>



          <div className="flex justify-end pt-2 border-t">

            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>

              Cancel

            </Button>

          </div>

        </div>

      </DialogContent>

    </Dialog>

  );

}


