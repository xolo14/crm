import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import * as perms from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartOrEmpty } from "@/components/hr/ChartOrEmpty";

function downloadCsv(filename: string, rows: any[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => JSON.stringify(row[h] ?? "")).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

const RANGE_TEXT: Record<string, string> = { week: "last 7 days", month: "last 30 days", year: "last 12 months" };

/** Evenly spaced axis labels, always including the latest bucket (today / this month). */
function evenTicks(labels: string[], range: string): string[] {
  const step = range === "month" ? 5 : range === "year" ? 2 : 1;
  const n = labels.length;
  return labels.filter((_, i) => (n - 1 - i) % step === 0);
}

type TaskSummary = { total: number; completed: number; late: number; overdue: number; completion_rate: number };

export default function HRReports() {
  const { role } = useAuth();
  const hasExport = perms.canExport(role);
  const [tab, setTab] = useState("lead");
  const [range, setRange] = useState("month");
  const { data } = useQuery({ queryKey: ["hr", "reports", range], queryFn: () => api.hr.reports(range) });
  const leadData: { label: string; count: number }[] = data?.lead_report || [];
  const leadTotal: number = data?.lead_total ?? leadData.reduce((s, r) => s + Number(r.count || 0), 0);
  const taskData: { label: string; completed: number; on_time: number; late: number }[] = data?.task_report || [];
  const summary = data?.task_summary as TaskSummary | undefined;
  const per = range === "year" ? "month" : "day";
  const leadTicks = evenTicks(leadData.map((r) => r.label), range);
  const taskTicks = evenTicks(taskData.map((r) => r.label), range);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Leads and tasks, {RANGE_TEXT[range]}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <select
            aria-label="Report period"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
            <option value="year">Last 12 months</option>
          </select>
          {hasExport && (
            <Button variant="outline" onClick={() => downloadCsv(tab === "lead" ? "lead-report.csv" : "task-report.csv", tab === "lead" ? leadData : taskData)}>Export CSV</Button>
          )}
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="lead">Lead Report</TabsTrigger><TabsTrigger value="task">Task Report</TabsTrigger></TabsList>
      </Tabs>
      {tab === "lead" ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm">New leads per {per}</CardTitle>
            <span className="text-xs text-muted-foreground">{leadTotal} in this period</span>
          </CardHeader>
          <CardContent className="h-72">
            <ChartOrEmpty rows={leadData} valueKey="count" hint="Leads assigned to you or added by you appear here.">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leadData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} ticks={leadTicks} interval={0} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Leads" fill="#2ed573" />
                </BarChart>
              </ResponsiveContainer>
            </ChartOrEmpty>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm">Tasks completed per {per}</CardTitle>
            {summary ? (
              <span className="text-xs text-muted-foreground">
                {summary.total > 0 ? (
                  <>
                    Due in this period: {summary.completed} of {summary.total} completed ({summary.completion_rate}%)
                    {summary.late > 0 ? <> · <span className="text-amber-600 dark:text-amber-400">{summary.late} late</span></> : null}
                    {summary.overdue > 0 ? <> · <span className="text-destructive">{summary.overdue} overdue</span></> : null}
                  </>
                ) : (
                  "No tasks due in this period"
                )}
              </span>
            ) : null}
          </CardHeader>
          <CardContent className="h-72">
            <ChartOrEmpty rows={taskData} valueKey="completed" hint="Tasks you mark complete appear here.">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={taskData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} ticks={taskTicks} interval={0} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="on_time" name="On time" stackId="done" fill="#0f2318" />
                  <Bar dataKey="late" name="Late" stackId="done" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </ChartOrEmpty>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
