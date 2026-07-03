import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { getApiBase } from "@/lib/apiBase";

type SetupState = "checking" | "ok" | "needs_config" | "db_error" | "unreachable";

export function HostingerSetupBanner() {
  const [state, setState] = useState<SetupState>("checking");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `${getApiBase()}/ping.php`;
        const res = await fetch(url, { cache: "no-store" });
        const raw = await res.text();
        let data: Record<string, unknown> | null = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = null;
        }
        if (cancelled) return;
        if (!data) {
          setState("unreachable");
          const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 160);
          setDetail(
            snippet
              ? `PHP did not return JSON (HTTP ${res.status}). Response starts with: “${snippet}…” — usually missing api/db.php, wrong upload path, or PHP error. Open ${url} in the browser.`
              : `PHP returned an empty response (HTTP ${res.status}). Upload api/db.php, api/ping.php, and .htaccess from dist/.`,
          );
          return;
        }
        if (data.status === "ok" && data.database === "connected") {
          setState("ok");
          return;
        }
        if (data.status === "setup_required") {
          setState("needs_config");
          setDetail(String(data.message || "Copy api/config.example.php to api/config.php on Hostinger."));
          return;
        }
        setState("db_error");
        setDetail(String(data.message || "Check MySQL credentials in api/config.php and import database.mysql.sql in phpMyAdmin."));
      } catch {
        if (!cancelled) {
          setState("unreachable");
          setDetail(`Cannot reach ${getApiBase()}/ping.php. Ensure api/ and .htaccess are uploaded to public_html.`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "checking" || state === "ok") return null;

  return (
    <Alert variant="destructive" className="mb-4 border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>
        {state === "needs_config" ? "Server not configured" : state === "db_error" ? "Database not connected" : "API not reachable"}
      </AlertTitle>
      <AlertDescription className="text-sm space-y-1">
        <p>{detail}</p>
        <p className="text-xs opacity-90">
          Hostinger: hPanel → Databases → copy MySQL details into <code className="font-mono">api/config.php</code>, upload{" "}
          <code className="font-mono">api/db.php</code>, then test{" "}
          <code className="font-mono">/api/ping.php</code> in your browser (must show JSON).
        </p>
      </AlertDescription>
    </Alert>
  );
}
