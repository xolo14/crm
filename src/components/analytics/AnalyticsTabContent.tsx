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
  );
}
