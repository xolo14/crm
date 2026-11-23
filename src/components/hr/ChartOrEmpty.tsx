import type { ReactNode } from "react";
import { BarChart3 } from "lucide-react";

/** Renders the chart, or a clear "No data yet" message when every value is zero / there are no rows. */
export function ChartOrEmpty({
  rows,
  valueKey,
  emptyText = "No data yet",
  hint,
  children,
}: {
  rows: Record<string, unknown>[];
  valueKey: string;
  emptyText?: string;
  hint?: string;
  children: ReactNode;
}) {
  const hasData = rows.some((r) => Number(r[valueKey] ?? 0) > 0);
  if (hasData) return <>{children}</>;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-center">
      <BarChart3 className="h-6 w-6 text-muted-foreground/60" aria-hidden />
      <p className="text-sm font-medium text-muted-foreground">{emptyText}</p>
      {hint ? <p className="max-w-xs text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
