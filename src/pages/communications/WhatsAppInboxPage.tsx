import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Settings } from "lucide-react";
import { communicationsApi } from "@/services/communications";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import WhatsAppInbox from "@/components/WhatsApp/WhatsAppInbox";

const ALLOWED = new Set(["super_admin", "admin", "org", "manager", "sales_representative", "sales_rep", "marketing"]);

export default function WhatsAppInboxPage() {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const allowed = ALLOWED.has(role) || role.startsWith("marketing");

  const { data: summary } = useQuery({
    queryKey: ["comm", "summary"],
    queryFn: communicationsApi.hubSummary,
    enabled: allowed,
  });
  const wa = summary?.org_whatsapp;
  const connected = Boolean(wa?.is_active && wa?.connection_status === "connected");
  const isOrgAdmin = ["admin", "org", "super_admin"].includes(role);

  if (!allowed) {
    return (
      <div className="rounded-xl border p-8 text-center space-y-3">
        <p className="font-medium">WhatsApp Inbox is not available for your role.</p>
        <Button asChild variant="outline">
          <Link to="/communications">Back to Communications</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 h-[calc(100dvh-7.25rem)] md:h-[calc(100dvh-5.25rem)] min-h-[420px] min-w-0">
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" asChild>
            <Link to="/communications">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight">WhatsApp Inbox</h1>
            <p className="text-xs text-muted-foreground truncate">WhatsApp Web–style messaging inside CRM</p>
          </div>
        </div>
        {isOrgAdmin ? (
          <Button variant="outline" size="sm" className="gap-1.5" asChild>
            <Link to="/communications/whatsapp-setup">
              <Settings className="h-3.5 w-3.5" /> Setup
            </Link>
          </Button>
        ) : null}
      </div>
      <div className="flex-1 min-h-0">
        <WhatsAppInbox connected={connected} />
      </div>
    </div>
  );
}
