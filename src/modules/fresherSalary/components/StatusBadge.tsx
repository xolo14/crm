import { cn } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  const ok = ["passed", "fixed_eligible", "confirmed", "full_fixed", "fixed_eligible_month3"].some((k) =>
    status.includes(k),
  );
  const bad = ["failed", "performance", "disqualified"].some((k) => status.includes(k));

  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium border",
        ok && "border-emerald-500/40 bg-emerald-500/15 text-emerald-800",
        bad && !ok && "border-rose-500/40 bg-rose-500/10 text-rose-800",
        !ok && !bad && "border-border bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}
