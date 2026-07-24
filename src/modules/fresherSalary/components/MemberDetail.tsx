import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  MONTHLY_HALF,
  MONTHLY_TARGET,
  TRAINING_TARGET,
} from "../constants";
import { canAdvancePhase } from "../logic";
import { evaluateMember } from "../salaryEngine";
import { getPhaseDayProgress } from "../phaseDays";
import type { FresherMember } from "../types";
import { GLASS_PANEL, PHASE_ACCENTS } from "../uiTokens";
import { useFresherSalaryStore } from "../useFresherSalaryStore";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Month2SubChances } from "./Month2SubChances";
import { PhaseInputBlock } from "./PhaseInputBlock";
import { PhaseTimeline } from "./PhaseTimeline";
import { SalarySummary } from "./SalarySummary";
import { SalaryTypePill } from "./SalaryTypePill";

export type MemberDetailProps = {
  member: FresherMember;
  glass?: string;
  onRequestAdvance: () => void;
  onRequestRemove: () => void;
};

export function MemberDetail({
  member,
  glass = GLASS_PANEL,
  onRequestAdvance,
  onRequestRemove,
}: MemberDetailProps) {
  const fixedSalary = useFresherSalaryStore((s) => s.fixedSalaryEstimate);
  const updatePhaseData = useFresherSalaryStore((s) => s.updatePhaseData);

  const patch =
    (id: string) =>
    (patchFn: (m: FresherMember) => FresherMember) => {
      updatePhaseData(id, patchFn);
    };

  const dayLine = getPhaseDayProgress(member.joiningDate, member.currentPhase);

  return (
    <>
      <SheetHeader className="space-y-1 pr-8">
        <SheetTitle className="text-2xl font-bold tracking-tight text-[#0f2318]">{member.name}</SheetTitle>
        <SheetDescription className="text-sm">
          {member.role} · Joined {member.joiningDate}
          {dayLine ? <span className="mt-1 block text-xs text-[#0f5230]">{dayLine.label}</span> : null}
        </SheetDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          <SalaryTypePill type={member.salaryType} />
          <Badge variant="secondary">{member.headlineStatus}</Badge>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 w-fit border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={onRequestRemove}
        >
          <Trash2 className="h-3.5 w-3.5 mr-2" />
          Remove member
        </Button>
      </SheetHeader>

      <ScrollArea className="mt-6 h-[calc(100dvh-8rem)] pr-4">
        <PhaseTimeline current={member.currentPhase} />

        <div className={cn(glass, "mt-4 border-border p-3 text-[11px] text-muted-foreground")}>
          <p className="mb-1 text-xs font-semibold text-[#0f2318]">Engine snapshot</p>
          <p className="leading-relaxed">{evaluateMember(member).summaryHeadline}</p>
        </div>

        <SalarySummary member={member} fixedSalary={fixedSalary} className="mt-6" />

        <div className="space-y-6 mt-6">
          <PhaseInputBlock
            title="Phase 1 — Training (15 days, unpaid)"
            accent={PHASE_ACCENTS.training}
            target={TRAINING_TARGET}
            achieved={member.training.achieved}
            onAchieved={(v) =>
              patch(member.id)((m) => ({
                ...m,
                training: { ...m.training, achieved: v },
              }))
            }
            help={`Target ₹${TRAINING_TARGET.toLocaleString("en-IN")}. Met → Month 1 fixed track; not met → performance.`}
            badge={member.training.status}
          />

          <PhaseInputBlock
            title="Phase 2 — Month 1 (30 days)"
            accent={PHASE_ACCENTS.month1}
            target={MONTHLY_TARGET}
            achieved={member.month1.achieved}
            onAchieved={(v) =>
              patch(member.id)((m) => ({
                ...m,
                month1: { ...m.month1, achieved: v },
              }))
            }
            help={`≥ 50% (₹${MONTHLY_HALF.toLocaleString("en-IN")}) → fixed-eligible Month 2.`}
            badge={member.month1.status}
          />

          <Month2SubChances
            member={member}
            onPatch={(fn) => patch(member.id)(fn)}
            glassClassName={glass}
          />

          <PhaseInputBlock
            title="Phase 4 — Month 3 (final)"
            accent={PHASE_ACCENTS.month3}
            target={MONTHLY_TARGET}
            achieved={member.month3.achieved}
            onAchieved={(v) =>
              patch(member.id)((m) => ({
                ...m,
                month3: { ...m.month3, achieved: v },
              }))
            }
            help="100% → Confirmed · 70–99% → Probation · &lt;70% → Performance review."
            badge={member.month3.status}
          />
        </div>

        {canAdvancePhase(member) && member.currentPhase !== "completed" && (
          <Button
            type="button"
            className="mt-8 w-full bg-[#2ed573] font-semibold text-[#0f2318] hover:bg-[#26c968]"
            onClick={onRequestAdvance}
          >
            Advance to next phase
          </Button>
        )}

        {!canAdvancePhase(member) && member.currentPhase !== "completed" && (
          <p className="mt-6 flex items-center gap-2 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Advance unlocks when this phase period ends (last calendar day). Target can be met earlier; overfulfill still counts in this phase.
          </p>
        )}
      </ScrollArea>
    </>
  );
}
