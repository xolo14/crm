import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { UserPlus } from "lucide-react";
import { getCurrentWeekKeyIST } from "@/lib/hrLeadsWeek";

const WEEKLY_TARGET = 20;

export default function HRDashboard() {
  const weekKey = getCurrentWeekKeyIST();
  const { data } = useQuery({
    queryKey: ["hr", "dashboard", weekKey],
    queryFn: api.hr.dashboard,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: true,
  });
  const stats = data?.stats || data?.data?.stats || {};
  const activity = data?.activity || [];
  const weekMeta = stats.week || data?.week;
  const myWeekCount = stats.my_leads_count ?? stats.my_leads_added ?? 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">HR Dashboard</h1>
        <p className="text-sm text-muted-foreground">Overview of your leads, tasks and holidays.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">My Leads</CardTitle>
            <UserPlus className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{myWeekCount}</div>
            <p className="mt-1 text-xs text-muted-foreground">This week</p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-teal-500 transition-all"
                style={{ width: `${Math.min((myWeekCount / WEEKLY_TARGET) * 100, 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Resets {weekMeta?.resets_in ?? "—"}
            </p>
          </CardContent>
        </Card>
        {[
          ["Assigned Leads", stats.assigned_leads || 0],
          ["Pending Tasks", stats.pending_tasks || 0],
          ["Upcoming Holidays", stats.upcoming_holidays || 0],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{label}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{value as number}</p></CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Lead Activity</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activity}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#2ed573" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Trend</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activity}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#0f2318" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
