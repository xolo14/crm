import { Card, CardContent } from "@/components/ui/card";
import { ANALYTICS_CARD_CLASS, type RepSummary } from "@/utils/analyticsHelpers";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CHART_SERIES_LIGHT } from "@/lib/chartTheme";

interface Props {
  byRep: RepSummary[];
}

const COLORS = CHART_SERIES_LIGHT;
const TOOLTIP_STYLE = { borderRadius: "10px", border: "1px solid #e5e7eb", fontSize: "12px" };

export function MetricDonut({ byRep }: Props) {
  // Calls only: adding demos/enrolled to calls double-counted and made the total
  // disagree with "Total Calls" (808 vs 807). Beyond 5 reps, fold into "Other".
  const sorted = [...byRep].sort((a, b) => b.calls - a.calls).filter((r) => r.calls > 0);
  const donutData = sorted.slice(0, 5).map((r) => ({ name: r.rep, value: r.calls }));
  const otherCalls = sorted.slice(5).reduce((s, r) => s + r.calls, 0);
  if (otherCalls > 0) donutData.push({ name: "Other", value: otherCalls });
  const total = donutData.reduce((s, d) => s + d.value, 0);

  return (
    <Card className={ANALYTICS_CARD_CLASS}>
      <CardContent className="px-4 py-4">
        <h3 className="mb-4 text-sm font-semibold text-gray-700">Calls by rep (self-reported)</h3>
        <div className="relative">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={donutData}
                cx="50%"
                cy="50%"
                innerRadius={65}
                outerRadius={95}
                paddingAngle={3}
                dataKey="value"
              >
                {donutData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => [v, n]} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: "11px" }}
                formatter={(v: string) => (v.length > 14 ? `${v.slice(0, 14)}…` : v)}
              />
            </PieChart>
          </ResponsiveContainer>
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[68%] text-center"
            aria-hidden
          >
            <p className="text-[10px] text-gray-400">Calls</p>
            <p className="text-lg font-bold text-gray-900">{total}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
