import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { estimateEarnings } from "../logic";
import type { FresherMember } from "../types";
import { GLASS_PANEL } from "../uiTokens";

export type SalarySummaryProps = {
  member: FresherMember;
  fixedSalary: number;
  className?: string;
};

export function SalarySummary({ member, fixedSalary, className }: SalarySummaryProps) {
  const est = estimateEarnings(member, fixedSalary);
  const rows: [string, number, string][] = [
    ["Training (unpaid)", est.training, "—"],
    ["Month 1", est.month1, member.training.status === "passed" ? "Fixed" : "Performance"],
    ["Month 2", est.month2, String(member.month2.status)],
    ["Month 3", est.month3, String(member.month3.status)],
  ];

  return (
    <div className={cn(GLASS_PANEL, "space-y-3 p-4", className)}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-[#0f2318]">
        <Wallet className="h-4 w-4 text-emerald-600" /> Estimated earnings (₹)
      </h3>
      <div className="space-y-2 text-xs">
        {rows.map(([lab, amt, note]) => (
          <div key={lab} className="flex justify-between border-b border-border/60 py-1.5">
            <span className="text-muted-foreground">{lab}</span>
            <span className="font-mono text-[#0f2318]">
              ₹{amt.toLocaleString("en-IN")}
              <span className="ml-2 text-[10px] text-muted-foreground">{note}</span>
            </span>
          </div>
        ))}
        <div className="flex justify-between pt-2 font-semibold text-[#0f2318]">
          <span>Total (illustrative)</span>
          <span>₹{est.total.toLocaleString("en-IN")}</span>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Performance: min(achieved ÷ target, 100%) × ₹{fixedSalary.toLocaleString("en-IN")}. Confirmed month uses ~115%
          base as incentive placeholder.
        </p>
      </div>
    </div>
  );
}
