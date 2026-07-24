import { CheckCircle2, Circle, Loader2, RefreshCw, Settings2, ShieldCheck, Wifi } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type WaSetupStatus = {
  connected: boolean;
  businessPhone?: string | null;
  connectionStatus?: string | null;
  approvedTemplates: number;
  pendingTemplates?: number;
};

type Props = {
  status: WaSetupStatus;
  testing?: boolean;
  syncing?: boolean;
  canManageCredentials?: boolean;
  onTestConnection: () => void;
  onSyncTemplates: () => void;
  onOpenCredentialsSetup: () => void;
  onSendCampaign: () => void;
  onCreateDraft: () => void;
};

function StepIcon({ done }: { done: boolean }) {
  return done ? (
    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
  ) : (
    <Circle className="h-5 w-5 text-muted-foreground shrink-0" />
  );
}

export function WhatsAppCampaignSetupPanel({
  status,
  testing,
  syncing,
  canManageCredentials,
  onTestConnection,
  onSyncTemplates,
  onOpenCredentialsSetup,
  onSendCampaign,
  onCreateDraft,
}: Props) {
  const step1 = status.connected;
  const step2 = status.approvedTemplates > 0;
  const step3 = step1; // can send session drafts once connected; templates unlock cold outreach

  return (
    <Card className="border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 to-white dark:from-emerald-950/20 dark:to-background">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          WhatsApp campaign setup
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Complete these three steps so Meta template campaigns and 24-hour session drafts both work.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          {/* Step 1 */}
          <div className={cn("rounded-xl border p-3 space-y-2", step1 ? "border-emerald-300 bg-white/80" : "bg-white/50")}>
            <div className="flex items-start gap-2">
              <StepIcon done={step1} />
              <div>
                <p className="text-sm font-semibold">1. Connect WhatsApp</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Link your org Meta Cloud API number.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={step1 ? "border-emerald-400 text-emerald-700" : ""}>
                {step1 ? "Connected" : status.connectionStatus || "Not connected"}
              </Badge>
              {status.businessPhone ? (
                <span className="text-[11px] text-muted-foreground">{status.businessPhone}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {canManageCredentials ? (
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onOpenCredentialsSetup}>
                  <Settings2 className="h-3 w-3" />
                  Open setup
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onOpenCredentialsSetup}>
                  <Settings2 className="h-3 w-3" />
                  View setup guide
                </Button>
              )}
              <Button size="sm" className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={onTestConnection} disabled={testing}>
                {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
                Test connection
              </Button>
            </div>
          </div>

          {/* Step 2 */}
          <div className={cn("rounded-xl border p-3 space-y-2", step2 ? "border-emerald-300 bg-white/80" : "bg-white/50")}>
            <div className="flex items-start gap-2">
              <StepIcon done={step2} />
              <div>
                <p className="text-sm font-semibold">2. Sync &amp; approve templates</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Pull Meta-approved templates for cold outreach campaigns.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{status.approvedTemplates} approved</Badge>
              {typeof status.pendingTemplates === "number" && status.pendingTemplates > 0 ? (
                <Badge variant="secondary">{status.pendingTemplates} pending</Badge>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={onSyncTemplates}
              disabled={!step1 || syncing}
              title={!step1 ? "Connect WhatsApp first" : undefined}
            >
              {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Sync from Meta
            </Button>
          </div>

          {/* Step 3 */}
          <div className={cn("rounded-xl border p-3 space-y-2", step3 ? "border-emerald-300 bg-white/80" : "bg-white/50")}>
            <div className="flex items-start gap-2">
              <StepIcon done={step3} />
              <div>
                <p className="text-sm font-semibold">3. Send campaigns</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Meta templates (cold) or free-text drafts (24h window).
                </p>
              </div>
            </div>
            <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
              <li>
                <span className="font-medium text-foreground">Template campaign</span> — any lead/member (recommended)
              </li>
              <li>
                <span className="font-medium text-foreground">Session draft</span> — only if they messaged you in the last 24h
              </li>
            </ul>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Button
                size="sm"
                className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                onClick={onSendCampaign}
                disabled={!step1}
              >
                Send campaign
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCreateDraft} disabled={!step1}>
                New session draft
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
