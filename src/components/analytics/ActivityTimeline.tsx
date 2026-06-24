import { Card, CardContent } from "@/components/ui/card";
import { ANALYTICS_CARD_CLASS, type SalesReport } from "@/utils/analyticsHelpers";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Props {
  data: SalesReport[];
}

type DateBucket = { date: string; Calls: number; Demos: number; Enrolled: number };

const TOOLTIP_STYLE = { borderRadius: "10px", border: "1px solid #e5e7eb", fontSize: "12px" };

function fmt(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function ActivityTimeline({ data }: Props) {
  const byDate = Object.values(
    data.reduce<Record<string, DateBucket>>((acc, r) => {
      acc[r.date] = acc[r.date] ?? { date: r.date, Calls: 0, Demos: 0, Enrolled: 0 };
      acc[r.date].Calls += r.calls;
      acc[r.date].Demos += r.demos;
      acc[r.date].Enrolled += r.enrolled;
      return acc;
    }, {}),
  ).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Card className={ANALYTICS_CARD_CLASS}>
      <CardContent className="px-4 py-4">
        <h3 className="mb-4 text-sm font-semibold text-gray-700">Activity Timeline</h3>
        <ResponsiveContainer width="100%" height={210}>
          <AreaChart data={byDate} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <defs>
              <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gD" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tickFormatter={fmt} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={fmt} />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Area type="monotone" dataKey="Calls" stroke="#3b82f6" strokeWidth={2} fill="url(#gC)" dot={{ r: 4, fill: "#3b82f6" }} />
            <Area type="monotone" dataKey="Demos" stroke="#8b5cf6" strokeWidth={2} fill="url(#gD)" dot={{ r: 4, fill: "#8b5cf6" }} />
            <Area type="monotone" dataKey="Enrolled" stroke="#22c55e" strokeWidth={2} fill="url(#gE)" dot={{ r: 4, fill: "#22c55e" }} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
