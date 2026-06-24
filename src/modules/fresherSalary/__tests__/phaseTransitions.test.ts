import { describe, expect, it } from "vitest";
import { MONTH2_FIRST10_TARGET, MONTHLY_HALF, MONTHLY_TARGET, TRAINING_TARGET } from "../constants";
import {
  advancePhase,
  canAdvancePhase,
  createNewMember,
  isCurrentPhaseComplete,
  recomputeMember,
} from "../logic";
import { computeMonth2AggregateFromAchievements } from "../salaryEngine";

/** Join date N calendar days ago (keeps tests independent of fixed dates). */
function joinDaysAgo(n: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

describe("phase transition guards", () => {
  it("cannot advance training until period ends even if target met", () => {
    let m = createNewMember("A", "Rep", joinDaysAgo(3));
    expect(canAdvancePhase(m)).toBe(false);
    m = recomputeMember({ ...m, training: { ...m.training, achieved: TRAINING_TARGET } });
    expect(canAdvancePhase(m)).toBe(false);
    m = createNewMember("A2", "Rep", joinDaysAgo(15));
    m = recomputeMember({ ...m, training: { ...m.training, achieved: 0 } });
    expect(canAdvancePhase(m)).toBe(true);
  });

  it("training → month1 maps salary track by training target", () => {
    let m = createNewMember("B", "Rep", joinDaysAgo(15));
    m = recomputeMember({ ...m, training: { ...m.training, achieved: TRAINING_TARGET } });
    const next = advancePhase(m);
    expect(next.currentPhase).toBe("month1");
    expect(next.salaryType).toBe("fixed");
    let m2 = createNewMember("C", "Rep", joinDaysAgo(15));
    m2 = recomputeMember({ ...m2, training: { ...m2.training, achieved: 1000 } });
    const next2 = advancePhase(m2);
    expect(next2.currentPhase).toBe("month1");
    expect(next2.salaryType).toBe("performance");
  });

  it("month1 advance requires month1 period to end", () => {
    let m = createNewMember("D", "Rep", joinDaysAgo(20));
    m = recomputeMember({ ...m, training: { ...m.training, achieved: TRAINING_TARGET } });
    m = advancePhase(m);
    expect(m.currentPhase).toBe("month1");
    m = recomputeMember({ ...m, month1: { ...m.month1, achieved: MONTHLY_TARGET } });
    expect(canAdvancePhase(m)).toBe(false);
    const mEnd = createNewMember("D2", "Rep", joinDaysAgo(45));
    const mEndR = recomputeMember({
      ...mEnd,
      currentPhase: "month1",
      training: { ...mEnd.training, achieved: TRAINING_TARGET, status: "passed" },
      month1: { ...mEnd.month1, achieved: MONTHLY_HALF },
    });
    expect(canAdvancePhase(mEndR)).toBe(true);
  });

  it("month2 advance requires month2 period to end", () => {
    let m = createNewMember("E", "Rep", joinDaysAgo(50));
    m = recomputeMember({ ...m, training: { ...m.training, achieved: TRAINING_TARGET } });
    m = advancePhase(m);
    m = recomputeMember({ ...m, month1: { ...m.month1, achieved: MONTHLY_TARGET } });
    m = advancePhase(m);
    expect(m.currentPhase).toBe("month2");
    m = recomputeMember({ ...m, month2: { ...m.month2, totalAchieved: MONTHLY_TARGET } });
    expect(canAdvancePhase(m)).toBe(false);
    const mEnd = recomputeMember({
      ...m,
      joiningDate: joinDaysAgo(75),
    });
    expect(canAdvancePhase(mEnd)).toBe(true);
  });

  it("month3 advance requires month3 period to end", () => {
    let m = createNewMember("F", "Rep", joinDaysAgo(80));
    m = recomputeMember({ ...m, training: { ...m.training, achieved: TRAINING_TARGET } });
    m = advancePhase(m);
    m = recomputeMember({ ...m, month1: { ...m.month1, achieved: MONTHLY_TARGET } });
    m = advancePhase(m);
    m = recomputeMember({
      ...m,
      month2: {
        ...m.month2,
        first10Days: { ...m.month2.first10Days, achieved: MONTH2_FIRST10_TARGET },
        totalAchieved: MONTHLY_TARGET,
      },
    });
    m = advancePhase(m);
    expect(m.currentPhase).toBe("month3");
    m = recomputeMember({ ...m, month3: { ...m.month3, achieved: MONTHLY_TARGET } });
    expect(canAdvancePhase(m)).toBe(false);
    const mEnd = recomputeMember({ ...m, joiningDate: joinDaysAgo(105) });
    expect(canAdvancePhase(mEnd)).toBe(true);
    const done = advancePhase(mEnd);
    expect(done.currentPhase).toBe("completed");
  });

  it("overfulfillment does not complete phase before period ends", () => {
    const m = recomputeMember({
      ...createNewMember("G", "Rep", joinDaysAgo(3)),
      training: { achieved: TRAINING_TARGET + 50_000, target: TRAINING_TARGET, isPaid: false, status: "passed" },
    });
    expect(isCurrentPhaseComplete(m)).toBe(false);
    expect(m.training.achieved).toBeGreaterThan(TRAINING_TARGET);
  });
});

describe("month2 aggregate edge cases", () => {
  it("priority: first10 clears before next15", () => {
    expect(
      computeMonth2AggregateFromAchievements(MONTH2_FIRST10_TARGET, 0, 0),
    ).toBe("full_fixed");
  });

  it("next15 target_based when first10 missed", () => {
    expect(
      computeMonth2AggregateFromAchievements(0, 80_000, 0),
    ).toBe("target_based");
  });

  it("total-only gate for month3 fixed eligibility", () => {
    expect(
      computeMonth2AggregateFromAchievements(0, 0, MONTHLY_HALF),
    ).toBe("fixed_eligible_month3");
  });

  it("disqualified when partial numbers but no gate met", () => {
    expect(
      computeMonth2AggregateFromAchievements(1000, 1000, 1000),
    ).toBe("disqualified");
  });

  it("pending when all zero", () => {
    expect(computeMonth2AggregateFromAchievements(0, 0, 0)).toBe("pending");
  });
});
