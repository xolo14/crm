import { Smartphone } from "lucide-react";
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
          <div className="flex gap-3 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              <Smartphone className="h-5 w-5 text-emerald-700" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold">Connect to Number</p>
                {connected ? (
                  <Badge className="text-[10px] bg-emerald-700 hover:bg-emerald-700">Connected</Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground max-w-md">
                {connected
                  ? businessPhone || "WhatsApp Business number is connected."
                  : "Connect your WhatsApp Business number to start messaging from the CRM."}
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant={connected ? "outline" : "default"}
            className={cn("shrink-0", !connected && "bg-emerald-800 hover:bg-emerald-900")}
            onClick={connected ? onManage : onConnect}
          >
            {connected ? "Manage" : "Connect"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
