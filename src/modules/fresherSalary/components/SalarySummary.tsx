import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { estimateEarnings } from "../logic";
import {
  incentiveRateForCollected,
  normalizeFresherPolicy,
  type FresherOrgPolicy,
} from "../policy";
import type { FresherMember } from "../types";
import { GLASS_PANEL } from "../uiTokens";

export type SalarySummaryProps = {
  member: FresherMember;
  fixedSalary: number;
  orgPolicy?: FresherOrgPolicy | null;
  className?: string;
};

export function SalarySummary({ member, fixedSalary, orgPolicy, className }: SalarySummaryProps) {
  const est = estimateEarnings(member, fixedSalary, orgPolicy);
  const terms = normalizeFresherPolicy(member.salaryTerms ?? orgPolicy ?? undefined);
  const collected =
    member.currentPhase === "month1"
      ? member.month1.achieved
      : member.currentPhase === "month2"
        ? member.month2.totalAchieved
        : member.month3.achieved;
  const rate = incentiveRateForCollected(terms, collected);
  const rows: [string, number, string][] = [
    ["Training (unpaid)", est.training, "—"],
    ["Month 1", est.month1, member.training.status === "passed" ? "Fixed" : "Performance"],
    ["Month 2", est.month2, String(member.month2.status)],
    ["Month 3", est.month3, String(member.month3.status)],
    ["Incentive", est.incentive, `${rate}% of collected`],
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
          Performance: min(achieved ÷ target, 100%) × ₹
          {(member.salaryTerms?.fixed_salary_monthly || fixedSalary).toLocaleString("en-IN")}. Incentive uses
          this member&apos;s tier table on collected amount above the monthly gate.
        </p>
      </div>
    </div>
  );
}
