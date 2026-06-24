import {
  MONTH1_DAYS,
  MONTH2_DAYS,
  MONTH3_DAYS,
  MONTHLY_TARGET,
  TRAINING_DAYS,
  TRAINING_TARGET,
} from "@/modules/fresherSalary/constants";
import { currentPhaseProgress } from "@/modules/fresherSalary/phaseProgress";
import { getPhaseDayProgress } from "@/modules/fresherSalary/phaseDays";
import type { FresherMember, FresherPhase } from "@/modules/fresherSalary/types";

export interface PhaseInfo {
  phaseNumber: number;
  phaseKey: FresherPhase;
  phaseName: string;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  dayInPhase: number;
  isPhaseComplete: boolean;
  targetAmount: number;
}

export const PHASE_DEFS = [
  {
    num: 1,
    key: "training" as const,
    name: "Training",
    startDay: 1,
    endDay: TRAINING_DAYS,
    target: TRAINING_TARGET,
    duration: TRAINING_DAYS,
  },
  {
    num: 2,
    key: "month1" as const,
    name: "Phase 1 Evaluation",
    startDay: TRAINING_DAYS + 1,
    endDay: TRAINING_DAYS + MONTH1_DAYS,
    target: MONTHLY_TARGET,
    duration: MONTH1_DAYS,
  },
  {
    num: 3,
    key: "month2" as const,
    name: "Phase 2 Evaluation",
    startDay: TRAINING_DAYS + MONTH1_DAYS + 1,
    endDay: TRAINING_DAYS + MONTH1_DAYS + MONTH2_DAYS,
    target: MONTHLY_TARGET,
    duration: MONTH2_DAYS,
  },
  {
    num: 4,
    key: "month3" as const,
    name: "Phase 3 Evaluation",
    startDay: TRAINING_DAYS + MONTH1_DAYS + MONTH2_DAYS + 1,
    endDay: TRAINING_DAYS + MONTH1_DAYS + MONTH2_DAYS + MONTH3_DAYS,
    target: MONTHLY_TARGET,
    duration: MONTH3_DAYS,
  },
] as const;

function parseJoin(joinStr: string): Date {
  const [y, m, d] = joinStr.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function getPhaseInfoForMember(member: FresherMember): PhaseInfo | null {
  if (member.currentPhase === "completed") return null;
  const def = PHASE_DEFS.find((p) => p.key === member.currentPhase);
  if (!def) return null;

  const dayProgress = getPhaseDayProgress(member.joiningDate, member.currentPhase);
  if (!dayProgress) return null;

  const joined = parseJoin(member.joiningDate);
  const startDate = new Date(joined);
  startDate.setDate(joined.getDate() + def.startDay - 1);
  const endDate = new Date(joined);
  endDate.setDate(joined.getDate() + def.endDay - 1);

  const dayInPhase = dayProgress.currentDay;
  const isPhaseComplete = dayInPhase >= def.duration;

  return {
    phaseNumber: def.num,
    phaseKey: def.key,
    phaseName: def.name,
    startDate,
    endDate,
    totalDays: def.duration,
    dayInPhase,
    isPhaseComplete,
    targetAmount: def.target,
  };
}

export function getNextPhaseDef(currentPhase: FresherPhase) {
  const idx = PHASE_DEFS.findIndex((p) => p.key === currentPhase);
  if (idx < 0 || idx >= PHASE_DEFS.length - 1) return null;
  return PHASE_DEFS[idx + 1];
}

export function shouldTriggerEmail(dayInPhase: number, totalDays: number): 10 | 15 | 30 | null {
  if (dayInPhase === 10) return 10;
  if (dayInPhase === 15) return 15;
  if (dayInPhase === 30 && totalDays === 30) return 30;
  return null;
}

export function getPhaseActivity(member: FresherMember) {
  const prog = currentPhaseProgress(member);
  switch (member.currentPhase) {
    case "month2":
      return {
        totalCalls: member.training.achieved,
        totalFollowUps: member.month2.next15Days.achieved,
        totalDemos: member.month2.first10Days.achieved,
        totalEnrolled: member.month2.totalAchieved,
      };
    case "training":
      return {
        totalCalls: member.training.achieved,
        totalFollowUps: 0,
        totalDemos: 0,
        totalEnrolled: member.training.achieved,
      };
    default:
      return {
        totalCalls: member.training.achieved,
        totalFollowUps: 0,
        totalDemos: 0,
        totalEnrolled: prog.achieved,
      };
  }
}
