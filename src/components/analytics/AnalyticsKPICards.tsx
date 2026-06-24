import { Card, CardContent } from "@/components/ui/card";
import { ANALYTICS_CARD_CLASS, type RepSummary, type SalesReport } from "@/utils/analyticsHelpers";
import { BarChart2, Monitor, Phone, TrendingUp, UserCheck } from "lucide-react";

interface Props {
  data: SalesReport[];
  byRep: RepSummary[];
}

export function AnalyticsKPICards({ data, byRep }: Props) {
  const totalCalls = data.reduce((s, r) => s + r.calls, 0);
  const totalDemos = data.reduce((s, r) => s + r.demos, 0);
  const totalEnrolled = data.reduce((s, r) => s + r.enrolled, 0);
  const convRate = totalCalls > 0 ? `${((totalEnrolled / totalCalls) * 100).toFixed(1)}%` : "0%";
  const avgDemos = byRep.length > 0 ? (totalDemos / byRep.length).toFixed(1) : "0";

  const cards = [
    { label: "Total Calls", value: String(totalCalls), icon: Phone, bg: "bg-[#eff6ff]", iconColor: "text-[#3b82f6]" },
    { label: "Total Demos", value: String(totalDemos), icon: Monitor, bg: "bg-[#f5f3ff]", iconColor: "text-[#8b5cf6]" },
    { label: "Total Enrolled", value: String(totalEnrolled), icon: UserCheck, bg: "bg-[#f0fdf4]", iconColor: "text-[#22c55e]" },
    {
      label: "Conversion Rate",
      value: convRate,
      sub: "Enrolled ÷ Calls",
      icon: TrendingUp,
      bg: "bg-[#fffbeb]",
      iconColor: "text-[#f59e0b]",
    },
    { label: "Avg Demos / Rep", value: avgDemos, icon: BarChart2, bg: "bg-[#eef2ff]", iconColor: "text-[#6366f1]" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.label} className={ANALYTICS_CARD_CLASS}>
          <CardContent className="px-4 py-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${c.bg}`}>
              <c.icon className={`h-5 w-5 ${c.iconColor}`} aria-hidden />
            </div>
            <p className="mt-3 text-2xl font-bold text-gray-900">{c.value}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{c.label}</p>
            {"sub" in c && c.sub ? <p className="mt-0.5 text-xs text-gray-400">{c.sub}</p> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
