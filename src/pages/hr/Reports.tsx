import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

export default function HRReports() {
  const [tab, setTab] = useState("lead");
  const [range, setRange] = useState("month");
  const { data } = useQuery({ queryKey: ["hr", "reports", range], queryFn: () => api.hr.reports(range) });
  const leadData = data?.lead_report || [];
  const taskData = data?.task_report || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Lead and task analytics</p>
        </div>
        <div className="flex gap-2">
          <select className="rounded-md border px-2" value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="week">Week</option><option value="month">Month</option><option value="year">Year</option>
          </select>
          <Button variant="outline" onClick={() => downloadCsv(tab === "lead" ? "lead-report.csv" : "task-report.csv", tab === "lead" ? leadData : taskData)}>Export CSV</Button>
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="lead">Lead Report</TabsTrigger><TabsTrigger value="task">Task Report</TabsTrigger></TabsList>
      </Tabs>
      {tab === "lead" ? (
        <Card>
          <CardHeader><CardTitle className="text-sm">Leads per Period</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={leadData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#2ed573" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-sm">Task Completion Rate</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={taskData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Line dataKey="completed" stroke="#0f2318" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
