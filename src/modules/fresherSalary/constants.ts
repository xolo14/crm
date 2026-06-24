/** ₹1,60,000 — monthly sales target (Months 1–3). */
export const MONTHLY_TARGET = 160_000;

/** ₹30,000 — training period target (15 days). */
export const TRAINING_TARGET = 30_000;

/** Phase lengths in calendar days (for “Day X of Y”). */
export const TRAINING_DAYS = 15;
export const MONTH1_DAYS = 30;
export const MONTH2_DAYS = 30;
export const MONTH3_DAYS = 30;

/** 50% of monthly target — Month 1 threshold & Month 2 end gate. */
export const MONTHLY_HALF = MONTHLY_TARGET * 0.5;

/** First 10 days of Month 2 — redemption window. */
export const MONTH2_FIRST10_TARGET = 50_000;

/** Days 11–25 of Month 2 — second chance window (amount achieved in that window). */
export const MONTH2_NEXT15_TARGET = 80_000;

/** Month 3 — 70% floor for probation path. */
export const MONTH3_SEVENTY_PCT = MONTHLY_TARGET * 0.7;

export const DEFAULT_FIXED_SALARY = 15_000;

export const STORAGE_KEY = 'fresher_salary_tracker_v1';

/** Zustand persist key — v2: members live on server only; local persist is fixedSalaryEstimate only. */
export const ZUSTAND_STORAGE_KEY = 'fresher_salary_tracker_zustand_v2';
