import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, ChevronRight, Sparkles } from "lucide-react";
import type { FresherPhase } from "../types";
import { PHASE_ACCENTS } from "../uiTokens";

type PhaseTimelineProps = {
  current: FresherPhase;
};

const STEPS: { key: FresherPhase; label: string }[] = [
  { key: "training", label: "Training" },
  { key: "month1", label: "Month 1" },
  { key: "month2", label: "Month 2" },
  { key: "month3", label: "Month 3" },
];

export function PhaseTimeline({ current }: PhaseTimelineProps) {
  const idx = STEPS.findIndex((s) => s.key === current);
  const activeIdx = current === "completed" ? 4 : idx;

  return (
    <div className="flex flex-wrap items-center gap-1 sm:gap-2 py-2">
      {STEPS.map((s, i) => {
        const done = activeIdx > i || current === "completed";
        const active = current === s.key;
        const color = PHASE_ACCENTS[s.key];
        return (
          <div key={s.key} className="flex items-center gap-1 sm:gap-2">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-all duration-300 sm:text-xs",
                done && "border-emerald-500/40 bg-emerald-500/10 text-emerald-800",
                active && !done && "border-[#2ed573]/50 bg-[#2ed573]/10 text-[#0f2318] shadow-sm",
                !done && !active && "border-border text-muted-foreground",
              )}
              style={active ? { borderColor: `${color}66`, color } : undefined}
            >
              {done ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : active ? (
                <Sparkles className="h-3.5 w-3.5" style={{ color }} />
              ) : (
                <span className="h-3.5 w-3.5 rounded-full border border-border" />
              )}
              {s.label}
            </div>
            {i < STEPS.length - 1 && (
              <ChevronRight className="hidden h-3 w-3 shrink-0 text-muted-foreground sm:inline" />
            )}
          </div>
        );
      })}
      {current === "completed" && (
        <Badge variant="secondary" className="text-[10px]">
          Completed
        </Badge>
      )}
    </div>
  );
}
