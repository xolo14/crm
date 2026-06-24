import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type ProgressBarProps = {
  /** 0–100 */
  value: number;
  className?: string;
  thin?: boolean;
  variant?: "default" | "card";
};

export function ProgressBar({ value, className, thin, variant = "default" }: ProgressBarProps) {
  const v = Math.min(Math.max(value, 0), 100);
  return (
    <Progress
      value={v}
      className={cn(
        thin ? "h-1.5" : "h-2",
        variant === "card" && "bg-muted [&>div]:bg-[#2ed573]",
        variant === "default" && "bg-muted [&>div]:bg-[#2ed573]",
        className,
      )}
    />
  );
}
