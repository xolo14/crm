import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One page header for every page: 24px/700 title (no icon), optional one-line description,
 * actions right-aligned (they wrap under the title on phones).
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** One KPI tile style everywhere: label, number (en-IN grouped by the caller), optional sub-line. */
export function KpiTile({
  label,
  value,
  sub,
  className,
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
  /** Makes the tile a button (e.g. open the matching tab or list). */
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold leading-tight tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "min-w-0 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {body}
      </button>
    );
  }
  return <div className={cn("min-w-0 rounded-xl border border-border bg-card p-4", className)}>{body}</div>;
}
