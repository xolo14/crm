import { Card, CardContent } from "@/components/ui/card";
import { ANALYTICS_CARD_CLASS, type SalesReport } from "@/utils/analyticsHelpers";
import { CHART_SERIES_LIGHT } from "@/lib/chartTheme";
import { fmtPercent } from "@/lib/formatMetric";

interface Props {
  data: SalesReport[];
}

export function ConversionFunnel({ data }: Props) {
  const sum = (key: keyof Pick<SalesReport, "calls" | "followUps" | "demos" | "enrolled">) =>
    data.reduce((s, r) => s + r[key], 0);

  const stages = [
    { label: "Calls", value: sum("calls"), color: CHART_SERIES_LIGHT[2] },
    { label: "Follow-ups", value: sum("followUps"), color: CHART_SERIES_LIGHT[3] },
    { label: "Demos", value: sum("demos"), color: CHART_SERIES_LIGHT[1] },
    { label: "Enrolled", value: sum("enrolled"), color: CHART_SERIES_LIGHT[0] },
  ];

  // These are independent self-reported activity totals, not nested funnel stages
  // (a demo can come from a lead never called this week), so no drop-off % is shown.
  const max = Math.max(...stages.map((s) => s.value), 1);

  return (
    <Card className={ANALYTICS_CARD_CLASS}>
      <CardContent className="px-4 py-4">
        <h3 className="mb-1 text-sm font-semibold text-gray-700">Reported activity</h3>
        <p className="mb-4 text-xs text-gray-400">Totals from daily reports (self-reported, not CRM status)</p>
        <div className="space-y-2">
          {stages.map((s, i) => {
            const pct = Math.round((s.value / max) * 100);
            return (
              <div key={s.label}>
                <div className="flex justify-center">
                  <div
                    style={{
                      width: `${Math.max(pct, 20)}%`,
                      background: s.color,
                      borderRadius: "8px",
                      padding: "10px 16px",
                      transition: "width 600ms ease-out",
                      minWidth: "120px",
                    }}
                    className="flex items-center justify-between"
                  >
                    <span className="text-xs font-semibold text-white">{s.label}</span>
                    <span className="ml-2 text-sm font-bold text-white">{s.value}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 border-t border-gray-100 pt-3 text-center">
          <span className="text-xs text-gray-400">Reported enrolled per call: </span>
          <span className="mx-1 text-sm font-bold text-brand-700">
            {stages[0].value > 0 ? fmtPercent((stages[3].value / stages[0].value) * 100) : "0%"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
