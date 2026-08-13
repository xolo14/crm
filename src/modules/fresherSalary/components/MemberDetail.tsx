import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { evaluateMember } from "../salaryEngine";
import { getPhaseDayProgress } from "../phaseDays";
import type { FresherMember } from "../types";
import { monthlyGateAmount, resolveMemberPolicy, type FresherOrgPolicy } from "../policy";
import { GLASS_PANEL, PHASE_ACCENTS } from "../uiTokens";
import { useFresherSalaryStore } from "../useFresherSalaryStore";
import { Trash2 } from "lucide-react";
import { PhaseInputBlock } from "./PhaseInputBlock";
import { PhaseTimeline } from "./PhaseTimeline";
import { SalarySummary } from "./SalarySummary";
import { SalaryTypePill } from "./SalaryTypePill";
import { SalaryFlowDiagram } from "./SalaryFlowDiagram";

export type MemberDetailProps = {
  member: FresherMember;
  policy: FresherOrgPolicy;
  glass?: string;
  /** Org admin may manually override achieved amounts. */
  canManualEdit?: boolean;
  onRequestRemove: () => void;
  onManualSave?: (member: FresherMember) => void | Promise<void>;
};

export function MemberDetail({
  member,
  policy,
  glass = GLASS_PANEL,
  canManualEdit = false,
  onRequestRemove,
  onManualSave,
}: MemberDetailProps) {
  const fixedSalary = useFresherSalaryStore((s) => s.fixedSalaryEstimate);
  const updatePhaseData = useFresherSalaryStore((s) => s.updatePhaseData);

  const patch =
    (id: string) =>
    (patchFn: (m: FresherMember) => FresherMember) => {
      updatePhaseData(id, patchFn);
    };

  const dayLine = getPhaseDayProgress(member.joiningDate, member.currentPhase);
  const terms = resolveMemberPolicy(policy, member.salaryTerms);
  const gate = monthlyGateAmount(terms);
  const readOnly = !canManualEdit;

  return (
    <>
      <DialogHeader className="space-y-1 pr-8 text-left">
        <DialogTitle className="text-2xl font-bold tracking-tight text-[#0f2318]">{member.name}</DialogTitle>
        <DialogDescription className="text-sm">
          {member.role} · Joined {member.joiningDate}
          {dayLine ? <span className="mt-1 block text-xs text-[#0f5230]">{dayLine.label}</span> : null}
          <span className="mt-1 block text-xs text-muted-foreground">
            Phases move automatically from the training start date. Achieved sales sync from payment links
            {canManualEdit ? "; org admins can override amounts below." : "."}
          </span>
        </DialogDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          <SalaryTypePill type={member.salaryType} />
          <Badge variant="secondary">{member.headlineStatus}</Badge>
        </div>
        {canManualEdit ? (
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
        ) : null}
      </DialogHeader>

      <ScrollArea className="mt-4 max-h-[min(70vh,720px)] pr-3">
        <SalaryFlowDiagram policy={terms} activePhase={member.currentPhase} compact className="mb-4" />

        <PhaseTimeline current={member.currentPhase} />

        <div className={cn(glass, "mt-4 border-border p-3 text-[11px] text-muted-foreground")}>
          <p className="mb-1 text-xs font-semibold text-[#0f2318]">Progress snapshot</p>
          <p className="leading-relaxed">{evaluateMember(member).summaryHeadline}</p>
        </div>

        <SalarySummary
          member={member}
          fixedSalary={terms.fixed_salary_monthly || fixedSalary}
          orgPolicy={policy}
          className="mt-6"
        />

        <div className="mt-6 space-y-6">
          <PhaseInputBlock
            title={`Training (${terms.training_days} days, unpaid)`}
            accent={PHASE_ACCENTS.training}
            target={terms.training_target}
            achieved={member.training.achieved}
            disabled={readOnly}
            onAchieved={(v) =>
              patch(member.id)((m) => ({
                ...m,
                training: { ...m.training, achieved: v },
              }))
            }
            help={`Target ₹${terms.training_target.toLocaleString("en-IN")}. Met → next month fixed ₹${terms.fixed_salary_monthly.toLocaleString("en-IN")}; else target-based.`}
            badge={member.training.status}
          />

          <PhaseInputBlock
            title="Month 1"
            accent={PHASE_ACCENTS.month1}
            target={gate}
            achieved={member.month1.achieved}
            disabled={readOnly}
            onAchieved={(v) =>
              patch(member.id)((m) => ({
                ...m,
                month1: { ...m.month1, achieved: v },
              }))
            }
            help={`Gate ₹${gate.toLocaleString("en-IN")} (${terms.monthly_gate_percent}% of ₹${terms.monthly_full_target.toLocaleString("en-IN")}). Met → fixed next month; miss → target-based next month.`}
            badge={member.month1.status}
          />

          <PhaseInputBlock
            title="Month 2"
            accent={PHASE_ACCENTS.month2}
            target={gate}
            achieved={member.month2.totalAchieved}
            disabled={readOnly}
            onAchieved={(v) =>
              patch(member.id)((m) => ({
                ...m,
                month2: { ...m.month2, totalAchieved: v },
              }))
            }
            help={`Same gate. Miss while on fixed still moves you to target-based next month.`}
            badge={String(member.month2.status)}
          />

          <PhaseInputBlock
            title="Month 3"
            accent={PHASE_ACCENTS.month3}
            target={gate}
            achieved={member.month3.achieved}
            disabled={readOnly}
            onAchieved={(v) =>
              patch(member.id)((m) => ({
                ...m,
                month3: { ...m.month3, achieved: v },
              }))
            }
            help="Same rule every month through probation: achieve gate → fixed next; miss → target-based next."
            badge={member.month3.status}
          />
        </div>

        {canManualEdit && onManualSave ? (
          <Button
            type="button"
            className="mt-8 w-full bg-[#0f5230] font-semibold text-white hover:bg-[#0c4226]"
            onClick={() => void onManualSave(member)}
          >
            Save manual overrides
          </Button>
        ) : null}
      </ScrollArea>
    </>
  );
}
