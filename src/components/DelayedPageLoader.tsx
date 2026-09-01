import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** Wait this long before showing the loader (avoids flash on fast loads). */
  delayMs?: number;
  /** Full viewport height vs fill parent content area. */
  fullScreen?: boolean;
  className?: string;
  label?: string;
};

/**
 * Shows a circular spinner + "Loading…" only after `delayMs` (default 2s).
 * Used as Suspense / route fallbacks across the CRM.
 */
export default function DelayedPageLoader({
  delayMs = 2000,
  fullScreen = false,
  className,
  label = "Loading…",
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), Math.max(0, delayMs));
    return () => window.clearTimeout(t);
  }, [delayMs]);

  if (!visible) {
    return (
      <div
        className={cn(fullScreen ? "min-h-dvh" : "min-h-[12rem]", "w-full", className)}
        aria-hidden
      />
    );
  }

  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3 text-muted-foreground",
        fullScreen ? "min-h-dvh" : "min-h-[12rem] py-16",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="h-9 w-9 animate-spin text-primary" aria-hidden />
      <p className="text-sm font-medium tracking-wide">{label}</p>
    </div>
  );
}
