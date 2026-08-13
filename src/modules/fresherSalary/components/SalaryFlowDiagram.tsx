import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { monthlyGateAmount, type FresherOrgPolicy } from "../policy";

function formatInr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** Escape text for Mermaid node / edge labels. */
function mLabel(s: string): string {
  return s.replace(/"/g, "#quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildFresherSalaryMermaid(policy: FresherOrgPolicy): string {
  const trainDays = policy.training_days;
  const trainT = formatInr(policy.training_target);
  const fixed = formatInr(policy.fixed_salary_monthly);
  const gate = formatInr(monthlyGateAmount(policy));
  const full = formatInr(policy.monthly_full_target);
  const pct = policy.monthly_gate_percent;
  const gateEdge = mLabel(`Achieved ${gate}<br/>(${pct}% of ${full})`);
  const trainNode = mLabel(`Training Period<br/>${trainDays} days<br/>Target: ${trainT}`);
  const m1Fixed = mLabel(`1st Month<br/>${fixed} Fixed Salary`);
  const m1Target = mLabel(`1st Month<br/>Target Based<br/>No Fixed Salary`);
  const m2Fixed = mLabel(`2nd Month<br/>${fixed} Fixed Salary`);
  const m2Target = mLabel(`2nd Month<br/>Target Based<br/>No Fixed Salary`);
  const m3Fixed = mLabel(`3rd Month<br/>${fixed} Fixed Salary`);
  const m3Target = mLabel(`3rd Month<br/>Target Based<br/>No Fixed Salary`);
  const cycleFixed = mLabel(`Next Month<br/>${fixed} Fixed Salary`);
  const cycleTarget = mLabel(`Next Month<br/>Target Based<br/>No Fixed Salary`);

  return `
flowchart TD
  Start([New Fresher]) --> Training["${trainNode}"]

  Training -->|Achieved| M1Fixed["${m1Fixed}"]
  Training -->|Not Achieved| M1Target["${m1Target}"]

  M1Fixed -->|"${gateEdge}"| M2Fixed["${m2Fixed}"]
  M1Fixed -->|Not Achieved| M2Target["${m2Target}"]
  M1Target -->|"${gateEdge}"| M2Fixed
  M1Target -->|Not Achieved| M2Target

  M2Fixed -->|"${gateEdge}"| M3Fixed["${m3Fixed}"]
  M2Fixed -->|Not Achieved| M3Target["${m3Target}"]
  M2Target -->|"${gateEdge}"| M3Fixed
  M2Target -->|Not Achieved| M3Target

  M3Fixed -->|"${gateEdge}"| CycleFixed["${cycleFixed}"]
  M3Fixed -->|Not Achieved| CycleTarget["${cycleTarget}"]
  M3Target -->|"${gateEdge}"| CycleFixed
  M3Target -->|Not Achieved| CycleTarget

  CycleFixed -->|"${gateEdge}"| CycleFixed
  CycleFixed -->|Not Achieved| CycleTarget
  CycleTarget -->|"${gateEdge}"| CycleFixed
  CycleTarget -->|Not Achieved| CycleTarget

  classDef train fill:#e8f4ff,stroke:#2563eb,color:#0f172a
  classDef fixed fill:#e8faf0,stroke:#16a34a,color:#0f172a
  classDef target fill:#fff7ed,stroke:#ea580c,color:#0f172a
  classDef start fill:#f1f5f9,stroke:#64748b,color:#0f172a

  class Start start
  class Training train
  class M1Fixed,M2Fixed,M3Fixed,CycleFixed fixed
  class M1Target,M2Target,M3Target,CycleTarget target
`.trim();
}

export type SalaryFlowDiagramProps = {
  policy: FresherOrgPolicy;
  /** Highlight current phase key for a member progress view. */
  activePhase?: string | null;
  className?: string;
  compact?: boolean;
  /** When false (default), shows a single collapsed line; click to open the graph. */
  defaultOpen?: boolean;
};

/**
 * Full detailed fresher salary flowchart (Mermaid TD graph).
 * Collapsed to one line by default; expands on click.
 */
export function SalaryFlowDiagram({
  policy,
  activePhase,
  className,
  compact,
  defaultOpen = false,
}: SalaryFlowDiagramProps) {
  const reactId = useId().replace(/:/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const definition = useMemo(() => buildFresherSalaryMermaid(policy), [policy]);

  const summaryLine = useMemo(() => {
    const gate = monthlyGateAmount(policy);
    const tiers = policy.incentive_tiers || [];
    const top = tiers.length ? tiers[tiers.length - 1] : null;
    const inc =
      top != null
        ? ` · incentives ${tiers[0]?.rate_percent ?? 0}%–${top.rate_percent}%`
        : "";
    return `Training ${policy.training_days}d · ${formatInr(policy.training_target)} → months gate ${formatInr(gate)} → fixed ${formatInr(policy.fixed_salary_monthly)}${inc}`;
  }, [policy]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void (async () => {
      // Wait a tick so CollapsibleContent mounts the container.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (cancelled || !containerRef.current) return;

      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: "base",
          flowchart: {
            curve: "basis",
            padding: 16,
            htmlLabels: true,
            nodeSpacing: 40,
            rankSpacing: 48,
            useMaxWidth: true,
          },
          themeVariables: {
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            fontSize: compact ? "12px" : "13px",
            primaryColor: "#e8f4ff",
            primaryTextColor: "#0f172a",
            primaryBorderColor: "#2563eb",
            lineColor: "#64748b",
            secondaryColor: "#e8faf0",
            tertiaryColor: "#fff7ed",
          },
        });

        const renderId = `fresher-flow-${reactId}-${Date.now()}`;
        const { svg } = await mermaid.render(renderId, definition);
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;

        if (activePhase) {
          const phaseMap: Record<string, string[]> = {
            training: ["Training"],
            month1: ["M1Fixed", "M1Target"],
            month2: ["M2Fixed", "M2Target"],
            month3: ["M3Fixed", "M3Target"],
            completed: ["CycleFixed", "CycleTarget"],
          };
          const ids = phaseMap[activePhase] || [];
          const root = containerRef.current;
          ids.forEach((id) => {
            root.querySelectorAll("g.node").forEach((g) => {
              const gid = g.getAttribute("id") || "";
              if (gid.includes(id) || gid.startsWith(id)) {
                (g as SVGElement).style.outline = "2px solid #2ed573";
                (g as SVGElement).style.outlineOffset = "2px";
              }
            });
          });
        }
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not render flowchart");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, definition, reactId, activePhase, compact]);

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-gray-200 bg-white", className)}>
      <Collapsible open={open} onOpenChange={setOpen} className="group">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50/80 sm:px-5">
          <span className="flex min-w-0 items-center gap-2">
            <BookOpen className="h-4 w-4 shrink-0 text-[#2ed573]" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-gray-800">Salary rules</span>
              <span className="mt-0.5 block truncate text-xs text-gray-500">{summaryLine}</span>
            </span>
            <span className="ml-1 hidden shrink-0 rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 sm:inline">
              {open ? "Click to close" : "Click to open graph"}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>

        <CollapsibleContent className="overflow-hidden border-t border-gray-100 data-[state=closed]:animate-none">
          <div className="px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
            {!compact ? (
              <p className="mb-3 max-w-2xl text-xs text-gray-500">
                Hit the gate → next month on fixed salary. Miss the gate (even from fixed) → next month target-based. Same
                rule every month through probation.
              </p>
            ) : null}

            {error ? (
              <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <div
              ref={containerRef}
              className={cn(
                "fresher-mermaid overflow-x-auto [&_svg]:mx-auto [&_svg]:max-w-full",
                compact ? "min-h-[280px]" : "min-h-[420px]",
              )}
              aria-label="Fresher salary progression flowchart"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
