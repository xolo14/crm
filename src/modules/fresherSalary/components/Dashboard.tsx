import { cn } from "@/lib/utils";
import { Sparkles, TrendingUp, Users, Wallet } from "lucide-react";

export type DashboardStats = {
  total: number;
  fixed: number;
  perf: number;
  pipeline: number;
};

export type DashboardProps = {
  stats: DashboardStats;
  className?: string;
};

export function Dashboard({ stats, className }: DashboardProps) {
  const items = [
    { label: "Total members", value: stats.total, icon: Users, c: "text-blue-600" },
    { label: "On fixed salary", value: stats.fixed, icon: Wallet, c: "text-emerald-600" },
    { label: "Performance / target", value: stats.perf, icon: TrendingUp, c: "text-amber-600" },
    {
      label: "Pipeline achieved",
      value: `₹${stats.pipeline.toLocaleString("en-IN")}`,
      icon: Sparkles,
      c: "text-[#0f5230]",
    },
  ] as const;

  return (
    <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-4", className)}>
      {items.map((k) => (
        <div
          key={k.label}
          className="rounded-lg border border-border/60 bg-card p-4 shadow-none transition-transform duration-300 hover:scale-[1.01]"
        >
          <div className="mb-2 flex items-center gap-2">
            <k.icon className={cn("h-4 w-4", k.c)} />
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k.label}</span>
          </div>
          <p className="text-xl font-bold text-[#0f2318]">{k.value}</p>
        </div>
      ))}
    </div>
  );
}
