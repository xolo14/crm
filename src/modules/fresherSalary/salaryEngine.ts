/**
 * Pure salary / phase evaluation rules for the fresher tracker.
 * Components must not embed business rules — use these functions only.
 */
import {
  MONTHLY_TARGET,
  TRAINING_TARGET,
  MONTHLY_HALF,
  MONTH2_FIRST10_TARGET,
  MONTH2_NEXT15_TARGET,
  MONTH3_SEVENTY_PCT,
} from './constants';
import type { FresherMember, FresherPhase, Month2AggregateStatus, SalaryType, SubStatus } from './types';

export type TrainingSubStatus = SubStatus;

export type TrainingEvaluation = {
  status: TrainingSubStatus;
  salaryType: SalaryType;
  nextPhase: FresherPhase;
  message: string;
};

export type Month1Evaluation = {
  status: 'pending' | 'fixed_eligible' | 'performance';
  salaryType: SalaryType;
  nextPhase: FresherPhase;
  message: string;
};

export type Month2Evaluation = {
  first10Status: TrainingSubStatus;
  next15Status: TrainingSubStatus;
  overallStatus: Month2AggregateStatus;
  salaryType: SalaryType;
  nextPhase: FresherPhase;
  message: string;
};

export type Month3Evaluation = {
  status: 'pending' | 'confirmed' | 'probation' | 'performance';
  salaryType: SalaryType;
  message: string;
  incentiveEligible: boolean;
};

export type MemberEvaluation = {
  training: TrainingEvaluation;
  month1: Month1Evaluation;
  month2: Month2Evaluation;
  month3: Month3Evaluation;
  currentPhase: FresherPhase;
  summaryHeadline: string;
};

/** Core Month 2 aggregate from numeric inputs (same priority as legacy logic). */
export function computeMonth2AggregateFromAchievements(
  first10Achieved: number,
  next15Achieved: number,
  totalAchieved: number,
): Month2AggregateStatus {
  if (first10Achieved >= MONTH2_FIRST10_TARGET) return 'full_fixed';
  if (next15Achieved >= MONTH2_NEXT15_TARGET) return 'target_based';
  if (totalAchieved >= MONTHLY_HALF) return 'fixed_eligible_month3';
  if (first10Achieved > 0 || next15Achieved > 0 || totalAchieved > 0) return 'disqualified';
  return 'pending';
}

function salaryTypeAfterTraining(passed: boolean): SalaryType {
  return passed ? 'fixed' : 'performance';
}

function salaryTypeAfterMonth1(fixedEligible: boolean): SalaryType {
  return fixedEligible ? 'fixed' : 'performance';
}

function salaryTypeAfterMonth2(status: Month2AggregateStatus, fallback: SalaryType): SalaryType {
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

function sub10(achieved: number): TrainingSubStatus {
  if (achieved <= 0) return 'pending';
  return achieved >= MONTH2_FIRST10_TARGET ? 'passed' : 'failed';
}

function sub15(achieved: number): TrainingSubStatus {
  if (achieved <= 0) return 'pending';
  return achieved >= MONTH2_NEXT15_TARGET ? 'passed' : 'failed';
}

export function evaluateTraining(achieved: number): TrainingEvaluation {
  if (achieved <= 0) {
    return {
      status: 'pending',
      salaryType: 'performance',
      nextPhase: 'month1',
      message: 'Enter achieved sales for training (target ₹30,000). Advance unlocks after you enter an amount.',
    };
  }
  if (achieved >= TRAINING_TARGET) {
    return {
      status: 'passed',
      salaryType: salaryTypeAfterTraining(true),
      nextPhase: 'month1',
      message: 'Training target met — Fixed Salary Eligible track for Month 1.',
    };
  }
  return {
    status: 'failed',
    salaryType: salaryTypeAfterTraining(false),
    nextPhase: 'month1',
    message: 'Training target not met — Performance Based track for Month 1.',
  };
}

export function evaluateMonth1(achieved: number, _trainingStatus: TrainingSubStatus): Month1Evaluation {
  let status: Month1Evaluation['status'] = 'pending';
  if (achieved > 0) {
    status = achieved >= MONTHLY_HALF ? 'fixed_eligible' : 'performance';
  }
  const salaryType = salaryTypeAfterMonth1(status === 'fixed_eligible');
  const message =
    achieved <= 0
      ? 'Enter Month 1 achieved sales (target ₹1,60,000). ≥50% → fixed-eligible Month 2.'
      : status === 'fixed_eligible'
        ? '≥50% of monthly target — Fixed Salary Eligible for Month 2.'
        : 'Below 50% — Performance Based for Month 2.';
  void _trainingStatus;
  return {
    status,
    salaryType,
    nextPhase: 'month2',
    message,
  };
}

export function evaluateMonth2(
  first10Achieved: number,
  next15Achieved: number,
  totalAchieved: number,
  salaryFallback: SalaryType,
): Month2Evaluation {
  const first10Status = sub10(first10Achieved);
  const next15Status = sub15(next15Achieved);
  const overallStatus = computeMonth2AggregateFromAchievements(first10Achieved, next15Achieved, totalAchieved);
  const salaryType = salaryTypeAfterMonth2(overallStatus, salaryFallback);

  let message: string;
  switch (overallStatus) {
    case 'full_fixed':
      message = '10-day redemption met — full Month 2 fixed salary path.';
      break;
    case 'target_based':
      message = '15-day window met — target-based pay; eligible for Month 3.';
      break;
    case 'fixed_eligible_month3':
      message = 'Full-month rule met — Fixed Salary Eligible for Month 3.';
      break;
    case 'disqualified':
      message = 'Below redemption / chance gates — disqualified from fixed track; performance based.';
      break;
    default:
      message =
        'Enter days 1–10, 11–25, and full-month totals. Advance requires at least one non-zero achieved amount.';
  }

  return {
    first10Status,
    next15Status,
    overallStatus,
    salaryType,
    nextPhase: 'month3',
    message,
  };
}

export function evaluateMonth3(achieved: number): Month3Evaluation {
  if (achieved <= 0) {
    return {
      status: 'pending',
      salaryType: 'performance',
      message: 'Enter Month 3 achieved sales (target ₹1,60,000).',
      incentiveEligible: false,
    };
  }
  if (achieved >= MONTHLY_TARGET) {
    return {
      status: 'confirmed',
      salaryType: 'fixed',
      message: '100%+ of target — Confirmed; full salary + incentive eligibility.',
      incentiveEligible: true,
    };
  }
  if (achieved >= MONTH3_SEVENTY_PCT) {
    return {
      status: 'probation',
      salaryType: 'performance',
      message: '70–99% of target — Probation / extended review.',
      incentiveEligible: false,
    };
  }
  return {
    status: 'performance',
    salaryType: 'performance',
    message: 'Below 70% — Performance review required.',
    incentiveEligible: false,
  };
}

function headlineFromPhase(m: FresherMember, ev: MemberEvaluation): string {
  switch (m.currentPhase) {
    case 'training':
      return ev.training.message.split('—')[0]?.trim() || ev.training.message;
    case 'month1':
      return m.month1.status === 'pending'
        ? 'Month 1 — enter achieved amount.'
        : ev.month1.message.split('(')[0]?.trim() || ev.month1.message;
    case 'month2':
      return ev.month2.message;
    case 'month3':
      return ev.month3.message;
    case 'completed':
      return 'Onboarding journey completed.';
    default:
      return '';
  }
}

export function evaluateMember(member: FresherMember): MemberEvaluation {
  const t = evaluateTraining(member.training.achieved);
  const m1 = evaluateMonth1(member.month1.achieved, member.training.status);
  const m2 = evaluateMonth2(
    member.month2.first10Days.achieved,
    member.month2.next15Days.achieved,
    member.month2.totalAchieved,
    member.salaryType,
  );
  const m3 = evaluateMonth3(member.month3.achieved);

  const summaryHeadline = headlineFromPhase(member, {
    training: t,
    month1: m1,
    month2: m2,
    month3: m3,
    currentPhase: member.currentPhase,
    summaryHeadline: '',
  });

  return {
    training: t,
    month1: m1,
    month2: m2,
    month3: m3,
    currentPhase: member.currentPhase,
    summaryHeadline,
  };
}

export function calculateSalary(
  phase: 'training' | 'month1' | 'month2' | 'month3',
  achieved: number,
  target: number,
  fixedBase: number,
): number {
  if (phase === 'training') return 0;
  if (target <= 0) return 0;
  const ratio = Math.min(achieved / target, 1);
  return Math.round(ratio * fixedBase * 100) / 100;
}
