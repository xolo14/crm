import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BookOpen, ChevronDown } from "lucide-react";

/**
 * Copy and figures for the collapsible Quick Reference only.
 * Tracker KPIs elsewhere still use `modules/fresherSalary/constants.ts`.
 */
const GUIDELINES_POLICY = {
  training: { durationDays: 15, minTarget: 30_000 },
  month1: {
    durationDays: 30,
    target: 30_000,
    partialThresholdPercent: 50,
  },
  month2: {
    durationDays: 30,
    target: 50_000,
    checkpointDays: [10, 20] as const,
    partialThresholdPercent: 50,
  },
  month3: {
    durationDays: 30,
    /** Evaluation uses the same monthly performance target as Month 2 / stats bar. */
    monthlyTarget: 50_000,
    partialThresholdPercent: 50,
  },
  salary: {
    baseFixedMonthly: 8_800,
    maxAnnualCTC: 165_000,
  },
} as const;

function formatInr(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

function RuleCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">{title}</p>
      <div className="space-y-1 text-sm font-medium text-gray-800">{children}</div>
    </div>
  );
}

export function RulesReferencePanel() {
  const { training, month1, month2, month3, salary } = GUIDELINES_POLICY;

  const month1Half = Math.round(month1.target * (month1.partialThresholdPercent / 100));
  const month2Half = Math.round(month2.target * (month2.partialThresholdPercent / 100));
  const month3Half = Math.round(month3.monthlyTarget * (month3.partialThresholdPercent / 100));

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <Collapsible defaultOpen={false} className="group">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-gray-50/80">
          <span className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 shrink-0 text-[#2ed573]" aria-hidden />
            <span className="text-sm font-semibold text-gray-700">Salary Rules Quick Reference</span>
            <span className="ml-1 rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              Guidelines
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden">
          <div className="border-t border-gray-100 px-5 pb-5 pt-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <RuleCard title="Training period">
                <p className="text-muted-foreground">{training.durationDays} days</p>
                <p>Minimum sales target: {formatInr(training.minTarget)}</p>
                <p className="mt-1 text-xs font-normal text-gray-600">
                  ✅ Met {formatInr(training.minTarget)} → Fixed salary track in Month 1
                </p>
                <p className="text-xs font-normal text-gray-600">
                  ❌ Not met → Performance-based pay only (no fixed component)
                </p>
              </RuleCard>

              <RuleCard title="Evaluation — Month 1">
                <p className="text-muted-foreground">{month1.durationDays} days</p>
                <p>Monthly sales target: {formatInr(month1.target)}</p>
                <p className="mt-1 text-xs font-normal text-gray-600">
                  ✅ Target fully met ({formatInr(month1.target)}+) → Fixed salary from next month onward
                </p>
                <p className="text-xs font-normal text-gray-600">
                  ⚠️ {month1.partialThresholdPercent}%+ ({formatInr(month1Half)}+) → Eligible to continue to Month 2
                </p>
                <p className="text-xs font-normal text-gray-600">
                  ❌ Below {month1.partialThresholdPercent}% → Performance-based pay only (no fixed component)
                </p>
              </RuleCard>

              <RuleCard title="Evaluation — Month 2">
                <p className="text-muted-foreground">{month2.durationDays} days</p>
                <p>Monthly sales target: {formatInr(month2.target)}</p>
                <p className="mt-1 text-xs font-normal text-blue-700">
                  ℹ️ Day {month2.checkpointDays[0]} &amp; Day {month2.checkpointDays[1]} check-ins — progress reviews,
                  not hard gates
                </p>
                <p className="mt-1 text-xs font-normal text-gray-600">
                  ✅ {formatInr(month2.target)} achieved → Fixed salary for the next 30 days; proceeds to Month 3
                  confirmed
                </p>
                <p className="text-xs font-normal text-gray-600">
                  ⚠️ {month2.partialThresholdPercent}%+ ({formatInr(month2Half)}+) but below{" "}
                  {formatInr(month2.target)} → Proceed to Month 3 (no fixed component yet)
                </p>
                <p className="text-xs font-normal text-gray-600">
                  ❌ Below {month2.partialThresholdPercent}% → Performance-based pay only in Month 3
                </p>
              </RuleCard>

              <RuleCard title="Evaluation — Month 3 (final)">
                <p className="text-muted-foreground">{month3.durationDays} days</p>
                <p>
                  Monthly target: {formatInr(month3.monthlyTarget)} · Threshold:{" "}
                  {month3.partialThresholdPercent}% ({formatInr(month3Half)}+)
                </p>
                <p className="mt-1 text-xs font-normal text-gray-600">
                  ✅ {month3.partialThresholdPercent}%+ achieved → Eligible for next month; may transition to confirmed
                  fixed salary structure
                </p>
                <p className="text-xs font-normal text-gray-600">
                  ❌ Below {month3.partialThresholdPercent}% → Performance-based pay only
                </p>
              </RuleCard>

              <RuleCard title="Salary reference">
                <p>Base fixed salary (on meeting target): {formatInr(salary.baseFixedMonthly)}/month</p>
                <p>Performance incentive: Variable (% of target achieved)</p>
                <p>Maximum annual CTC potential: {formatInr(salary.maxAnnualCTC)}</p>
                <p className="mt-2 text-xs font-normal text-gray-600">
                  PF / PT and other statutory items follow your organisation&apos;s payroll policy.
                </p>
              </RuleCard>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
