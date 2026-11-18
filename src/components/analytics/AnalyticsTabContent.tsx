import type { RepSummary, SalesReport } from "@/utils/analyticsHelpers";
import { AnalyticsKPICards } from "./AnalyticsKPICards";
import { PerformanceBarChart } from "./PerformanceBarChart";
import { MetricDonut } from "./MetricDonut";
import { ActivityTimeline } from "./ActivityTimeline";
import { ConversionFunnel } from "./ConversionFunnel";
import { RepLeaderboard } from "./RepLeaderboard";

interface Props {
  data: SalesReport[];
  byRep: RepSummary[];
}

export function AnalyticsTabContent({ data, byRep }: Props) {
  return (
    <>
      <AnalyticsKPICards data={data} byRep={byRep} />

      {data.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <p className="text-sm font-semibold">No reports in this period</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick a longer period or another rep. Charts appear once daily reports exist for the selection.
          </p>
        </div>
      ) : (
      <>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <PerformanceBarChart byRep={byRep} />
        <MetricDonut byRep={byRep} />
      </div>

      <div className="mt-5">
        <ActivityTimeline data={data} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ConversionFunnel data={data} />
        <RepLeaderboard byRep={byRep} />
      </div>
      </>
      )}
    </>
  );
}
