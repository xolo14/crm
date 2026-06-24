import type { FresherPhase } from './types';
import {
  TRAINING_DAYS,
  MONTH1_DAYS,
  MONTH2_DAYS,
  MONTH3_DAYS,
} from './constants';

/** Calendar-day offset from joining date (day 1 = join day) for each phase block. */
const PHASE_START_DAY: Record<Exclude<FresherPhase, 'completed'>, number> = {
  training: 1,
  month1: TRAINING_DAYS + 1,
  month2: TRAINING_DAYS + MONTH1_DAYS + 1,
  month3: TRAINING_DAYS + MONTH1_DAYS + MONTH2_DAYS + 1,
};

const PHASE_LENGTH: Record<Exclude<FresherPhase, 'completed'>, number> = {
  training: TRAINING_DAYS,
  month1: MONTH1_DAYS,
  month2: MONTH2_DAYS,
  month3: MONTH3_DAYS,
};

function parseJoin(joinStr: string): Date {
  const [y, m, d] = joinStr.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function calendarDaysSinceJoin(joinStr: string): number {
  const join = startOfLocalDay(parseJoin(joinStr));
  const today = startOfLocalDay(new Date());
  const ms = today.getTime() - join.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * "Day X of Y" for the member's current phase using calendar segments from joining date.
 * If the user advanced a phase early, X is at least 1 for that phase.
 */
export function getPhaseDayProgress(
  joiningDate: string,
  currentPhase: FresherPhase,
): { currentDay: number; totalDays: number; label: string } | null {
  if (currentPhase === 'completed') {
    return {
      currentDay: MONTH3_DAYS,
      totalDays: MONTH3_DAYS,
      label: `Completed · Month 3 was ${MONTH3_DAYS} days`,
    };
  }

  const totalDays = PHASE_LENGTH[currentPhase];
  const phaseStart = PHASE_START_DAY[currentPhase];
  const elapsed = calendarDaysSinceJoin(joiningDate);
  const rawInPhase = elapsed - phaseStart + 1;
  const currentDay = Math.max(1, Math.min(totalDays, rawInPhase));
  return {
    currentDay,
    totalDays,
    label: `Day ${currentDay} of ${totalDays}`,
  };
}
