import {
  MONTHLY_TARGET,
  TRAINING_TARGET,
  MONTHLY_HALF,
  MONTH2_FIRST10_TARGET,
  MONTH2_NEXT15_TARGET,
  MONTH3_SEVENTY_PCT,
  DEFAULT_FIXED_SALARY,
} from './constants';
import { getPhaseDayProgress } from './phaseDays';
import { calculateSalary, computeMonth2AggregateFromAchievements } from './salaryEngine';
import type {
  FresherMember,
  FresherPhase,
  Month2AggregateStatus,
  SalaryType,
} from './types';

export function pctOfTarget(achieved: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round((achieved / target) * 1000) / 10;
}

/** Performance salary: (% achieved vs phase target) × fixed base, capped at 100%). */
export function performanceSalaryAmount(
  achieved: number,
  target: number,
  fixedBase: number,
): number {
  return calculateSalary('month1', achieved, target, fixedBase);
}

export function createNewMember(
  name: string,
  role: string,
  joiningDate: string,
  email?: string | null,
  traineeUserId?: string | null,
): FresherMember {
  const m: FresherMember = {
    id: crypto.randomUUID(),
    name: name.trim(),
    role: role.trim(),
    joiningDate,
    ...(email != null && String(email).trim() !== "" ? { email: String(email).trim() } : {}),
    ...(traineeUserId != null && String(traineeUserId).trim() !== ""
      ? { trainee_user_id: String(traineeUserId).trim() }
      : {}),
    currentPhase: 'training',
    salaryType: 'performance',
    training: { achieved: 0, target: TRAINING_TARGET, isPaid: false, status: 'pending' },
    month1: { achieved: 0, target: MONTHLY_TARGET, status: 'pending' },
    month2: {
      first10Days: { achieved: 0, target: MONTH2_FIRST10_TARGET, status: 'pending' },
      next15Days: { achieved: 0, target: MONTH2_NEXT15_TARGET, status: 'pending' },
      totalAchieved: 0,
      status: 'pending',
    },
    month3: { achieved: 0, target: MONTHLY_TARGET, status: 'pending' },
    headlineStatus: '',
  };
  return recomputeMember(m);
}

function trainingSubStatus(achieved: number): 'pending' | 'passed' | 'failed' {
  if (achieved <= 0) return 'pending';
  return achieved >= TRAINING_TARGET ? 'passed' : 'failed';
}

function month1SubStatus(achieved: number): 'pending' | 'fixed_eligible' | 'performance' {
  if (achieved <= 0) return 'pending';
  return achieved >= MONTHLY_HALF ? 'fixed_eligible' : 'performance';
}

function month2Sub10(achieved: number): 'pending' | 'passed' | 'failed' {
  if (achieved <= 0) return 'pending';
  return achieved >= MONTH2_FIRST10_TARGET ? 'passed' : 'failed';
}

function month2Sub15(achieved: number): 'pending' | 'passed' | 'failed' {
  if (achieved <= 0) return 'pending';
  return achieved >= MONTH2_NEXT15_TARGET ? 'passed' : 'failed';
}

/** Priority: 10-day redemption → 15-day chance → full-month 50% gate → else disqualified if any data. */
export function computeMonth2Aggregate(m: FresherMember): Month2AggregateStatus {
  return computeMonth2AggregateFromAchievements(
    m.month2.first10Days.achieved,
    m.month2.next15Days.achieved,
    m.month2.totalAchieved,
  );
}

function deriveHeadline(m: FresherMember): string {
  const phase = m.currentPhase;
  if (phase === 'training') {
    const t = m.training;
    if (t.status === 'pending') return 'Training (15 days, unpaid) — enter achieved sales (target ₹30,000).';
    if (t.status === 'passed') return 'Training target met — Fixed Salary Eligible — Month 1';
    return 'Training target not met — Performance Based — Month 1';
  }
  if (phase === 'month1') {
    if (m.month1.status === 'pending') return 'Month 1 (30 days) — target ₹1,60,000. ≥50% (₹80,000) → fixed track for Month 2.';
    if (m.month1.status === 'fixed_eligible') return 'Fixed Salary Eligible — Month 2';
    return 'Performance Based — Month 2';
  }
  if (phase === 'month2') {
    const agg = m.month2.status;
    if (agg === 'pending') return 'Month 2 — first 10 days ₹50k redemption; days 11–25 ₹80k chance; full month ≥₹80k → Month 3 fixed.';
    if (agg === 'full_fixed') return '10-Day Redemption Passed — Full Month 2 Fixed Salary';
    if (agg === 'target_based') return '15-Day Chance Passed — Target Based, Eligible for Month 3';
    if (agg === 'fixed_eligible_month3') return 'Fixed Salary Eligible — Month 3';
    return 'Disqualified from Fixed Track — Performance Based';
  }
  if (phase === 'month3') {
    const a = m.month3.achieved;
    if (a <= 0) return 'Month 3 — final month (target ₹1,60,000).';
    if (a >= MONTHLY_TARGET) return 'Confirmed — Full Salary + Incentives';
    if (a >= MONTH3_SEVENTY_PCT) return 'Probation Extended — Target Review';
    return 'Performance Based — Review Required';
  }
  return 'Onboarding journey completed.';
}

export function recomputeMember(m: FresherMember): FresherMember {
  const training = {
    ...m.training,
    target: TRAINING_TARGET,
    isPaid: false as const,
    status: trainingSubStatus(m.training.achieved),
  };
  const month1 = {
    ...m.month1,
    target: MONTHLY_TARGET,
    status: month1SubStatus(m.month1.achieved),
  };
  const first10Days = {
    ...m.month2.first10Days,
    target: MONTH2_FIRST10_TARGET,
    status: month2Sub10(m.month2.first10Days.achieved),
  };
  const next15Days = {
    ...m.month2.next15Days,
    target: MONTH2_NEXT15_TARGET,
    status: month2Sub15(m.month2.next15Days.achieved),
  };

  const partial: FresherMember = {
    ...m,
    training,
    month1,
    month2: {
      ...m.month2,
      first10Days,
      next15Days,
      status: m.month2.status,
    },
    month3: { ...m.month3, target: MONTHLY_TARGET },
  };

  let month2Status = m.month2.status;
  if (m.currentPhase === 'month2') {
    month2Status = computeMonth2Aggregate(partial);
  }

  let month3 = { ...partial.month3, target: MONTHLY_TARGET };
  if (m.currentPhase === 'month3' || m.currentPhase === 'completed') {
    const a = m.month3.achieved;
    if (a <= 0) month3 = { ...month3, status: 'pending' };
    else if (a >= MONTHLY_TARGET) month3 = { ...month3, status: 'confirmed' };
    else if (a >= MONTH3_SEVENTY_PCT) month3 = { ...month3, status: 'probation' };
    else month3 = { ...month3, status: 'performance' };
  }

  const next: FresherMember = {
    ...partial,
    month2: {
      ...partial.month2,
      status: month2Status,
    },
    month3,
    headlineStatus: '',
  };
  next.headlineStatus = deriveHeadline(next);
  return next;
}

export function salaryTypeAfterTraining(passed: boolean): SalaryType {
  return passed ? 'fixed' : 'performance';
}

export function salaryTypeAfterMonth1(month1FixedEligible: boolean): SalaryType {
  return month1FixedEligible ? 'fixed' : 'performance';
}

export function salaryTypeAfterMonth2(status: Month2AggregateStatus, fallback: SalaryType): SalaryType {
  switch (status) {
    case 'full_fixed':
    case 'fixed_eligible_month3':
      return 'fixed';
    case 'target_based':
      return 'target_based';
    case 'disqualified':
      return 'performance';
    default:
      return fallback;
  }
}

/** Achieved amount for the member's active phase (may exceed target). */
export function currentPhaseAchieved(m: FresherMember): number {
  switch (m.currentPhase) {
    case 'training':
      return m.training.achieved;
    case 'month1':
      return m.month1.achieved;
    case 'month2':
      return m.month2.totalAchieved;
    case 'month3':
      return m.month3.achieved;
    default:
      return 0;
  }
}

/** Target for the member's active phase. */
export function currentPhaseTarget(m: FresherMember): number {
  switch (m.currentPhase) {
    case 'training':
      return TRAINING_TARGET;
    case 'month1':
    case 'month3':
      return MONTHLY_TARGET;
    case 'month2':
      return MONTHLY_TARGET;
    default:
      return 0;
  }
}

/**
 * Current phase is complete only when the calendar phase period has ended
 * (last day of the phase or later). Target can be met early but advance waits for period end.
 */
export function isCurrentPhaseComplete(m: FresherMember, joinDayProgress?: { currentDay: number; totalDays: number } | null): boolean {
  if (m.currentPhase === 'completed') return true;
  if (joinDayProgress && joinDayProgress.totalDays > 0 && joinDayProgress.currentDay >= joinDayProgress.totalDays) {
    return true;
  }
  return false;
}

export function canAdvancePhase(m: FresherMember): boolean {
  const r = recomputeMember(m);
  if (r.currentPhase === 'completed') return false;
  const dayLine = getPhaseDayProgress(r.joiningDate, r.currentPhase);
  return isCurrentPhaseComplete(r, dayLine);
}

export function advancePhase(m: FresherMember): FresherMember {
  const r = recomputeMember(m);
  if (!canAdvancePhase(r)) return r;

  let nextPhase: FresherPhase = r.currentPhase;
  let salaryType: SalaryType = r.salaryType;

  if (r.currentPhase === 'training') {
    nextPhase = 'month1';
    salaryType = salaryTypeAfterTraining(r.training.status === 'passed');
  } else if (r.currentPhase === 'month1') {
    nextPhase = 'month2';
    salaryType = salaryTypeAfterMonth1(r.month1.status === 'fixed_eligible');
  } else if (r.currentPhase === 'month2') {
    const finalM2 = computeMonth2Aggregate(r);
    nextPhase = 'month3';
    salaryType = salaryTypeAfterMonth2(finalM2, r.salaryType);
    return recomputeMember({
      ...r,
      currentPhase: nextPhase,
      salaryType,
      month2: { ...r.month2, status: finalM2 },
    });
  } else if (r.currentPhase === 'month3') {
    nextPhase = 'completed';
  }

  return recomputeMember({
    ...r,
    currentPhase: nextPhase,
    salaryType,
  });
}

export function estimateEarnings(m: FresherMember, fixedBase: number = DEFAULT_FIXED_SALARY): {
  training: number;
  month1: number;
  month2: number;
  month3: number;
  total: number;
} {
  const fb = fixedBase;
  const training = 0;

  const phaseOrder = (p: FresherMember['currentPhase']) =>
    ['training', 'month1', 'month2', 'month3', 'completed'].indexOf(p);

  let month1 = 0;
  if (phaseOrder(m.currentPhase) >= 1 && m.month1.achieved > 0) {
    month1 =
      m.training.status === 'passed'
        ? fb
        : performanceSalaryAmount(m.month1.achieved, MONTHLY_TARGET, fb);
  }

  let month2 = 0;
  if (phaseOrder(m.currentPhase) >= 2 && (m.month2.totalAchieved > 0 || m.month2.first10Days.achieved > 0)) {
    if (m.month2.status === 'full_fixed') month2 = fb;
    else if (m.month2.status === 'target_based')
      month2 = performanceSalaryAmount(m.month2.totalAchieved, MONTHLY_TARGET, fb);
    else if (m.month2.status === 'fixed_eligible_month3') month2 = fb;
    else month2 = performanceSalaryAmount(m.month2.totalAchieved, MONTHLY_TARGET, fb);
  }

  let month3 = 0;
  if (phaseOrder(m.currentPhase) >= 3 && m.month3.achieved > 0) {
    if (m.month3.status === 'confirmed') month3 = Math.round(fb * 1.15 * 100) / 100;
    else if (m.month3.status === 'probation') month3 = fb;
    else month3 = performanceSalaryAmount(m.month3.achieved, MONTHLY_TARGET, fb);
  }

  return {
    training,
    month1,
    month2,
    month3,
    total: training + month1 + month2 + month3,
  };
}

export function totalPipelineAchieved(m: FresherMember): number {
  return (
    m.training.achieved +
    m.month1.achieved +
    m.month2.totalAchieved +
    m.month3.achieved
  );
}
