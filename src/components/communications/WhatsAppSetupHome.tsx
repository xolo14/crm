import { Bot, Heart, MessageCircle, Smartphone, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  userName?: string;
  connected: boolean;
  businessPhone?: string;
  onConnect: () => void;
  onManage?: () => void;
  className?: string;
}

export default function WhatsAppSetupHome({
  userName,
  connected,
  businessPhone,
  onConnect,
  onManage,
  className,
}: Props) {
  const firstName = userName?.split(" ")[0] || "there";

  return (
    <div className={cn("space-y-6", className)}>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Welcome to Communications, {firstName}!
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Connect WhatsApp Business API to message leads and run campaigns from your CRM.
        </p>
      </div>

      <Card className="overflow-hidden border-emerald-100 bg-gradient-to-r from-emerald-50/80 to-background">
        <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              <Bot className="h-5 w-5 text-emerald-700" />
            </div>
            <div>
              <p className="font-semibold">Build Your AI Agent</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Handle conversations, answer questions, qualify leads, and assist customers automatically.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" disabled className="shrink-0">
            Create Agent
          </Button>
        </CardContent>
      </Card>

      <div className="grid sm:grid-cols-3 gap-3">
        <SetupTile
          icon={<Smartphone className="h-5 w-5 text-emerald-600" />}
          title="Connect Number"
          subtitle={connected ? businessPhone || "Connected" : "Not Verified"}
          badge={connected ? "Connected" : "Rs. 400"}
          badgeVariant={connected ? "default" : "secondary"}
          actionLabel={connected ? "Manage" : "Connect"}
          actionPrimary={!connected}
          onAction={connected ? onManage : onConnect}
        />
        <SetupTile
          icon={<Heart className="h-5 w-5 text-rose-500" />}
          title="Greeting Flow"
          subtitle="Activated"
          meta="AI-generated"
          actionLabel="Edit Flow"
          disabled
        />
        <SetupTile
          icon={<MessageCircle className="h-5 w-5 text-sky-600" />}
          title="FAQ Auto-replies"
          subtitle="Activated"
          meta="AI-generated"
          actionLabel="Edit"
          disabled
        />
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Objectives</p>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              title: "Generate High-intent Leads",
              desc: "Via Click to WhatsApp Ads",
              icon: Sparkles,
            },
            {
              title: "Re-target Qualified Leads in Bulk",
              desc: "Via WhatsApp Bulk Campaigns",
              icon: MessageCircle,
            },
            {
              title: "Increase Instagram Followers",
              desc: "Via Insta Giveaway Automation",
              icon: Heart,
            },
          ].map((item) => (
            <Card key={item.title} className="overflow-hidden">
              <CardContent className="p-4 flex flex-col h-full min-h-[140px]">
                <item.icon className="h-8 w-8 text-muted-foreground/40 mb-3" />
                <p className="font-semibold text-sm leading-snug">{item.title}</p>
                <p className="text-xs text-muted-foreground mt-1 flex-1">{item.desc}</p>
                <Button variant="outline" size="sm" className="mt-3 w-fit" disabled={!connected}>
                  Setup
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function SetupTile({
  icon,
  title,
  subtitle,
  meta,
  badge,
  badgeVariant = "secondary",
  actionLabel,
  actionPrimary,
  onAction,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  meta?: string;
  badge?: string;
  badgeVariant?: "default" | "secondary";
  actionLabel: string;
  actionPrimary?: boolean;
  onAction?: () => void;
  disabled?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex flex-col h-full">
        <div className="flex items-start justify-between gap-2">
          {icon}
          {badge ? (
            <Badge variant={badgeVariant} className="text-[10px] shrink-0">
              {badge}
            </Badge>
          ) : null}
        </div>
        <p className="font-semibold mt-3">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        {meta ? <p className="text-[10px] text-muted-foreground mt-0.5">{meta}</p> : null}
        <Button
          type="button"
          size="sm"
          variant={actionPrimary ? "default" : "outline"}
          className={cn("mt-4 w-full", actionPrimary && "bg-emerald-800 hover:bg-emerald-900")}
          disabled={disabled}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
