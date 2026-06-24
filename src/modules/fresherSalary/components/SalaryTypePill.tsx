import { cn } from "@/lib/utils";
import type { SalaryType } from "../types";

export function SalaryTypePill({ type }: { type: SalaryType }) {
  const map = {
    fixed: "border-emerald-500/40 bg-emerald-500/15 text-emerald-800",
    performance: "border-amber-500/40 bg-amber-500/15 text-amber-900",
    target_based: "border-violet-500/40 bg-violet-500/15 text-violet-900",
  };
  const label = type === "fixed" ? "Fixed" : type === "performance" ? "Performance" : "Target based";
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", map[type])}>{label}</span>
  );
}
