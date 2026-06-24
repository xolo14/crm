import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  MONTHLY_HALF,
  MONTH2_FIRST10_TARGET,
  MONTH2_NEXT15_TARGET,
} from "../constants";
import type { FresherMember } from "../types";
import { PHASE_ACCENTS, GLASS_PANEL } from "../uiTokens";
import { PhaseInputBlock } from "./PhaseInputBlock";

type PatchFn = (patch: (m: FresherMember) => FresherMember) => void;

export type Month2SubChancesProps = {
  member: FresherMember;
  onPatch: PatchFn;
  glassClassName?: string;
};

export function Month2SubChances({ member, onPatch, glassClassName = GLASS_PANEL }: Month2SubChancesProps) {
  const accent = PHASE_ACCENTS.month2;
  return (
    <div className={cn(glassClassName, "border-emerald-500/25 p-4")}>
      <h4 className="mb-3 text-sm font-semibold" style={{ color: accent }}>
        Phase 3 — Month 2 (30 days)
      </h4>
      <div className="space-y-4">
        <PhaseInputBlock
          title="Days 1–10 redemption"
          accent={accent}
          target={MONTH2_FIRST10_TARGET}
          achieved={member.month2.first10Days.achieved}
          onAchieved={(v) =>
            onPatch((m) => ({
              ...m,
              month2: {
                ...m.month2,
                first10Days: { ...m.month2.first10Days, achieved: v },
              },
            }))
          }
          help={`≥ ₹${MONTH2_FIRST10_TARGET.toLocaleString("en-IN")} → full Month 2 fixed salary window.`}
          badge={member.month2.first10Days.status}
        />
        <PhaseInputBlock
          title="Days 11–25 chance"
          accent={accent}
          target={MONTH2_NEXT15_TARGET}
          achieved={member.month2.next15Days.achieved}
          onAchieved={(v) =>
            onPatch((m) => ({
              ...m,
              month2: {
                ...m.month2,
                next15Days: { ...m.month2.next15Days, achieved: v },
              },
            }))
          }
          help={`≥ ₹${MONTH2_NEXT15_TARGET.toLocaleString("en-IN")} in window → target-based, eligible Month 3.`}
          badge={member.month2.next15Days.status}
        />
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Full month total (30 days)</Label>
          <Input
            type="number"
            min={0}
            value={member.month2.totalAchieved || ""}
            onChange={(e) =>
              onPatch((m) => ({
                ...m,
                month2: { ...m.month2, totalAchieved: +e.target.value || 0 },
              }))
            }
          />
          <p className="text-[10px] text-muted-foreground">
            End rule: total ≥ ₹{MONTHLY_HALF.toLocaleString("en-IN")} → Fixed Salary Eligible — Month 3.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          Month 2 aggregate: {member.month2.status}
        </Badge>
      </div>
    </div>
  );
}
