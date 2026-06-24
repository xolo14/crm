import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { pctOfTarget } from "../logic";
import { ProgressBar } from "./ProgressBar";
import { StatusBadge } from "./StatusBadge";

export type PhaseInputBlockProps = {
  title: string;
  accent: string;
  target: number;
  achieved: number;
  onAchieved: (n: number) => void;
  help: string;
  badge: string;
  disabled?: boolean;
};

export function PhaseInputBlock({
  title,
  accent,
  target,
  achieved,
  onAchieved,
  help,
  badge,
  disabled = false,
}: PhaseInputBlockProps) {
  const pct = pctOfTarget(achieved, target);
  const barPct = Math.min(Math.max(pct, 0), 100);
  return (
    <div
      className={cn("rounded-2xl border p-4 transition-all duration-300", disabled ? "opacity-50" : "")}
      style={{ borderColor: `${accent}33`, background: `${accent}08` }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold" style={{ color: accent }}>
          {title}
        </h4>
        <StatusBadge status={badge} />
      </div>
      <div className="flex gap-3 items-end">
        <div className="flex-1 space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">Achieved (₹)</Label>
          <Input
            type="number"
            min={0}
            disabled={disabled}
            value={achieved || ""}
            onChange={(e) => onAchieved(+e.target.value || 0)}
          />
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-muted-foreground">Target</p>
          <p className="font-mono text-sm text-[#0f2318]">₹{target.toLocaleString("en-IN")}</p>
        </div>
      </div>
      <div className="mt-3 space-y-1">
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>Progress</span>
          <span>{pct}%</span>
        </div>
        <ProgressBar value={barPct} thin />
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{help}</p>
    </div>
  );
}
