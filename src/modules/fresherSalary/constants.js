/**
 * JS entry for tooling/scripts that expect `.js`.
 * Canonical implementation: `./constants.ts` (must use `.ts` here to avoid resolving `./constants` → this file).
 */
export {
  MONTHLY_TARGET,
  TRAINING_TARGET,
  TRAINING_DAYS,
  MONTH1_DAYS,
  MONTH2_DAYS,
  MONTH3_DAYS,
  MONTHLY_HALF,
  MONTH2_FIRST10_TARGET,
  MONTH2_NEXT15_TARGET,
  MONTH3_SEVENTY_PCT,
  DEFAULT_FIXED_SALARY,
  STORAGE_KEY,
  ZUSTAND_STORAGE_KEY,
} from "./constants.ts";
