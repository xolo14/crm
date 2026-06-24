import { Card, CardContent } from "@/components/ui/card";
import { ANALYTICS_CARD_CLASS, type RepSummary } from "@/utils/analyticsHelpers";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Props {
  byRep: RepSummary[];
}

const TOOLTIP_STYLE = { borderRadius: "10px", border: "1px solid #e5e7eb", fontSize: "12px" };

export function PerformanceBarChart({ byRep }: Props) {
  const chartData = byRep.map((r) => ({
    name: r.rep.length > 10 ? `${r.rep.slice(0, 10)}…` : r.rep,
    fullName: r.rep,
    Calls: r.calls,
    Demos: r.demos,
    Enrolled: r.enrolled,
  }));

  return (
    <Card className={ANALYTICS_CARD_CLASS}>
      <CardContent className="px-4 py-4">
        <h3 className="mb-4 text-sm font-semibold text-gray-700">Rep Performance</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload as { fullName?: string } | undefined;
                return p?.fullName ?? "";
              }}
            />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Bar dataKey="Calls" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Demos" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Enrolled" fill="#22c55e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
