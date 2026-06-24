import {
  MONTHLY_TARGET,
  TRAINING_TARGET,
} from "./constants";
import type { FresherMember } from "./types";
import { pctOfTarget } from "./logic";

export function currentPhaseProgress(m: FresherMember): {
  label: string;
  pct: number;
  achieved: number;
  target: number;
} {
  switch (m.currentPhase) {
    case "training":
      return {
        label: "Training",
        pct: pctOfTarget(m.training.achieved, TRAINING_TARGET),
        achieved: m.training.achieved,
        target: TRAINING_TARGET,
      };
    case "month1":
      return {
        label: "Month 1",
        pct: pctOfTarget(m.month1.achieved, MONTHLY_TARGET),
        achieved: m.month1.achieved,
        target: MONTHLY_TARGET,
      };
    case "month2":
      return {
        label: "Month 2 (total)",
        pct: pctOfTarget(m.month2.totalAchieved, MONTHLY_TARGET),
        achieved: m.month2.totalAchieved,
        target: MONTHLY_TARGET,
      };
    case "month3":
      return {
        label: "Month 3",
        pct: pctOfTarget(m.month3.achieved, MONTHLY_TARGET),
        achieved: m.month3.achieved,
        target: MONTHLY_TARGET,
      };
    default:
      return { label: "—", pct: 100, achieved: 0, target: MONTHLY_TARGET };
  }
}
