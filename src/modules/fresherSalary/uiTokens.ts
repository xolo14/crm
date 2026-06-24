import type { FresherPhase } from "./types";

/** Accent hex colors per phase (cards, timeline). */
export const PHASE_ACCENTS: Record<FresherPhase | "idle", string> = {
  training: "#F59E0B",
  month1: "#6366F1",
  month2: "#10B981",
  month3: "#EC4899",
  completed: "#94A3B8",
  idle: "#64748B",
};

/** Matches main app surfaces (e.g. Payments / Payment links): subtle card, no heavy shadow. */
export const GLASS_PANEL =
  "rounded-xl border border-border/60 bg-card text-card-foreground shadow-none transition-all duration-300";

export function nextPhaseLabel(phase: FresherPhase): string {
  const map: Record<FresherPhase, string> = {
    training: "Month 1",
    month1: "Month 2",
    month2: "Month 3",
    month3: "Completed",
    completed: "",
  };
  return map[phase] ?? "";
}
