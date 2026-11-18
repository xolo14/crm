import { Card, CardContent } from "@/components/ui/card";
import { ANALYTICS_CARD_CLASS, type SalesReport } from "@/utils/analyticsHelpers";
import { chartSeries } from "@/lib/chartTheme";
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

/** Sortable timestamp for the date strings reports use (ISO or dd/mm/yyyy). */
function dateValue(d: string): number {
  const t = new Date(d).getTime();
  if (!Number.isNaN(t)) return t;
  const parts = d.trim().split(/[/-]/).map(Number);
  if (parts.length === 3 && parts[2] > 1000) return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
  return 0;
}

function fmt(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function ActivityTimeline({ data }: Props) {
  const S = chartSeries();
  const byDate = Object.values(
    data.reduce<Record<string, DateBucket>>((acc, r) => {
      acc[r.date] = acc[r.date] ?? { date: r.date, Calls: 0, Demos: 0, Enrolled: 0 };
      acc[r.date].Calls += r.calls;
      acc[r.date].Demos += r.demos;
      acc[r.date].Enrolled += r.enrolled;
      return acc;
    }, {}),
  ).sort((a, b) => dateValue(a.date) - dateValue(b.date)); // oldest on the left

  return (
    <Card className={ANALYTICS_CARD_CLASS}>
      <CardContent className="px-4 py-4">
        <h3 className="mb-4 text-sm font-semibold text-gray-700">Activity Timeline</h3>
        <ResponsiveContainer width="100%" height={210}>
          <AreaChart data={byDate} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <defs>
              <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={S[0]} stopOpacity={0.15} />
                <stop offset="95%" stopColor={S[0]} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gD" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={S[3]} stopOpacity={0.15} />
                <stop offset="95%" stopColor={S[3]} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={S[2]} stopOpacity={0.2} />
                <stop offset="95%" stopColor={S[2]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tickFormatter={fmt} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={fmt} />
            <Legend wrapperStyle={{ fontSize: "12px" }} />
            <Area type="monotone" dataKey="Calls" stroke={S[0]} strokeWidth={2} fill="url(#gC)" dot={{ r: 3, fill: S[0] }} />
            <Area type="monotone" dataKey="Demos" stroke={S[3]} strokeWidth={2} fill="url(#gD)" dot={{ r: 3, fill: S[3] }} />
            <Area type="monotone" dataKey="Enrolled" stroke={S[2]} strokeWidth={2} fill="url(#gE)" dot={{ r: 3, fill: S[2] }} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
