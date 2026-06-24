import { Card, CardContent } from "@/components/ui/card";
import { ANALYTICS_CARD_CLASS, type RepSummary } from "@/utils/analyticsHelpers";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

interface Props {
  byRep: RepSummary[];
}

const COLORS = ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#6366f1"];
const TOOLTIP_STYLE = { borderRadius: "10px", border: "1px solid #e5e7eb", fontSize: "12px" };

export function MetricDonut({ byRep }: Props) {
  const donutData = byRep.map((r) => ({
    name: r.rep,
    value: r.calls + r.demos + r.enrolled,
  }));
  const total = donutData.reduce((s, d) => s + d.value, 0);

  return (
    <Card className={ANALYTICS_CARD_CLASS}>
      <CardContent className="px-4 py-4">
        <h3 className="mb-4 text-sm font-semibold text-gray-700">Activity by Rep</h3>
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
            <p className="text-[10px] text-gray-400">Total</p>
            <p className="text-lg font-bold text-gray-900">{total}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
