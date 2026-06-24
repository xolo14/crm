import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getPhaseDayProgress } from "../phaseDays";
import { currentPhaseProgress } from "../phaseProgress";
import type { FresherMember } from "../types";
import { PHASE_ACCENTS, GLASS_PANEL } from "../uiTokens";
import { ProgressBar } from "./ProgressBar";
import { SalaryTypePill } from "./SalaryTypePill";

export type MemberCardProps = {
  member: FresherMember;
  onOpen: () => void;
  className?: string;
};

const PHASE_LABEL: Record<FresherMember["currentPhase"], string> = {
  training: "Training",
  month1: "Month 1",
  month2: "Month 2",
  month3: "Month 3",
  completed: "Completed",
};

export function MemberCard({ member, onOpen, className }: MemberCardProps) {
  const cp = currentPhaseProgress(member);
  const dayInfo = getPhaseDayProgress(member.joiningDate, member.currentPhase);
  const accent = PHASE_ACCENTS[member.currentPhase];

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        GLASS_PANEL,
        "group cursor-pointer p-5 text-left hover:border-[#2ed573]/40 hover:bg-muted/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold text-[#0f2318]"
            style={{
              background: `linear-gradient(135deg, ${accent}55, rgba(46,213,115,0.15))`,
            }}
          >
            {member.name.trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-[#0f2318] transition-colors group-hover:text-[#0f5230]">
              {member.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">{member.role}</p>
            {dayInfo && <p className="mt-1 text-[10px] text-[#0f5230]">{dayInfo.label}</p>}
          </div>
        </div>
        <SalaryTypePill type={member.salaryType} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant="outline" className="text-[10px]" style={{ borderColor: `${accent}66` }}>
          {PHASE_LABEL[member.currentPhase]}
        </Badge>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          Joined {member.joiningDate}
        </Badge>
      </div>
      <div className="mt-4 space-y-2">
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>
            {cp.label}: ₹{cp.achieved.toLocaleString("en-IN")} / ₹{cp.target.toLocaleString("en-IN")}
          </span>
          <span className="font-medium text-[#0f5230]">{cp.pct}%</span>
        </div>
        <ProgressBar value={Math.min(cp.pct, 100)} variant="card" />
      </div>
      <p className="mt-3 line-clamp-2 text-[11px] text-muted-foreground">{member.headlineStatus}</p>
    </button>
  );
}
