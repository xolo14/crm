/** Org-wide fresher salary + incentive policy (editable by org admin). */

/** Incentive band: apply `rate_percent` when collected exceeds `threshold` (0 = base / default). */
export type FresherIncentiveTier = {
  /** Collected must be greater than this for the rate (except threshold 0 = base rate). */
  threshold: number;
  rate_percent: number;
};

export type FresherOrgPolicy = {
  training_days: number;
  training_target: number;
  month_days: number;
  /** Full monthly sales target (e.g. ₹1,60,000). */
  monthly_full_target: number;
  /** % of monthly_full_target required to earn fixed salary next month (e.g. 50 → ₹80,000). */
  monthly_gate_percent: number;
  fixed_salary_monthly: number;
  /** Number of evaluation months after training (1..12). */
  probation_months: number;
  /**
   * B2C incentive on collected amount.
   * Base rate at threshold 0; higher tiers apply when collected > threshold.
   */
  incentive_tiers: FresherIncentiveTier[];
};

/** Default B2C incentive table: <80k→2%, >80k→4%, >120k→8%, >160k→12%, >200k→14%. */
export const DEFAULT_INCENTIVE_TIERS: FresherIncentiveTier[] = [
  { threshold: 0, rate_percent: 2 },
  { threshold: 80_000, rate_percent: 4 },
  { threshold: 120_000, rate_percent: 8 },
  { threshold: 160_000, rate_percent: 12 },
  { threshold: 200_000, rate_percent: 14 },
];

export const DEFAULT_FRESHER_POLICY: FresherOrgPolicy = {
  training_days: 15,
  training_target: 30_000,
  month_days: 30,
  monthly_full_target: 160_000,
  monthly_gate_percent: 50,
  fixed_salary_monthly: 15_000,
  probation_months: 3,
  incentive_tiers: DEFAULT_INCENTIVE_TIERS.map((t) => ({ ...t })),
};

export function monthlyGateAmount(policy: FresherOrgPolicy): number {
  const pct = Math.max(0, Math.min(100, Number(policy.monthly_gate_percent) || 0));
  return Math.round((Number(policy.monthly_full_target) || 0) * (pct / 100));
}

export function normalizeIncentiveTiers(raw: unknown): FresherIncentiveTier[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_INCENTIVE_TIERS.map((t) => ({ ...t }));
  }
  const parsed: FresherIncentiveTier[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const threshold = Math.max(0, Math.round(Number(o.threshold ?? o.min_collected ?? 0) || 0));
    const rate = Math.max(0, Math.min(100, Number(o.rate_percent ?? o.rate ?? 0) || 0));
    parsed.push({ threshold, rate_percent: rate });
  }
  if (parsed.length === 0) {
    return DEFAULT_INCENTIVE_TIERS.map((t) => ({ ...t }));
  }
  parsed.sort((a, b) => a.threshold - b.threshold);
  if (parsed[0].threshold !== 0) {
    parsed.unshift({ threshold: 0, rate_percent: DEFAULT_INCENTIVE_TIERS[0].rate_percent });
  }
  // Dedupe thresholds (keep last)
  const byTh = new Map<number, FresherIncentiveTier>();
  for (const t of parsed) byTh.set(t.threshold, t);
  return [...byTh.values()].sort((a, b) => a.threshold - b.threshold);
}

/** Highest tier where collected > threshold (threshold 0 always applies as base). */
export function incentiveRateForCollected(
  policy: Pick<FresherOrgPolicy, "incentive_tiers">,
  collected: number,
): number {
  const amount = Math.max(0, Number(collected) || 0);
  const tiers = normalizeIncentiveTiers(policy.incentive_tiers);
  let rate = tiers[0]?.rate_percent ?? 0;
  for (const t of tiers) {
    if (t.threshold === 0) {
      rate = t.rate_percent;
      continue;
    }
    if (amount > t.threshold) rate = t.rate_percent;
  }
  return rate;
}

export function incentiveAmountForCollected(
  policy: Pick<FresherOrgPolicy, "incentive_tiers">,
  collected: number,
): number {
  const amount = Math.max(0, Number(collected) || 0);
  const rate = incentiveRateForCollected(policy, amount);
  return Math.round(amount * (rate / 100) * 100) / 100;
}

export function normalizeFresherPolicy(raw: unknown): FresherOrgPolicy {
  const d = DEFAULT_FRESHER_POLICY;
  if (!raw || typeof raw !== "object") {
    return {
      ...d,
      incentive_tiers: d.incentive_tiers.map((t) => ({ ...t })),
    };
  }
  const o = raw as Record<string, unknown>;
  const num = (k: keyof FresherOrgPolicy, fallback: number, min = 0) => {
    if (k === "incentive_tiers") return fallback;
    const n = Number(o[k]);
    if (!Number.isFinite(n) || n < min) return fallback;
    return n;
  };
  return {
    training_days: Math.round(num("training_days", d.training_days, 1)),
    training_target: Math.round(num("training_target", d.training_target, 0)),
    month_days: Math.round(num("month_days", d.month_days, 1)),
    monthly_full_target: Math.round(num("monthly_full_target", d.monthly_full_target, 0)),
    monthly_gate_percent: Math.min(
      100,
      Math.round(num("monthly_gate_percent", d.monthly_gate_percent, 0)),
    ),
    fixed_salary_monthly: Math.round(num("fixed_salary_monthly", d.fixed_salary_monthly, 0)),
    probation_months: Math.min(
      12,
      Math.max(1, Math.round(num("probation_months", d.probation_months, 1))),
    ),
    incentive_tiers: normalizeIncentiveTiers(o.incentive_tiers),
  };
}

/** Merge member-specific terms onto org policy (member terms win). */
export function resolveMemberPolicy(
  orgPolicy: FresherOrgPolicy,
  memberTerms?: Partial<FresherOrgPolicy> | FresherOrgPolicy | null,
): FresherOrgPolicy {
  if (!memberTerms || typeof memberTerms !== "object") {
    return normalizeFresherPolicy(orgPolicy);
  }
  return normalizeFresherPolicy({ ...orgPolicy, ...memberTerms });
}
