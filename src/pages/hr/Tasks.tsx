import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { useIsMobile } from "@/hooks/use-mobile";

export default function HRTasks() {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["hr", "tasks"], queryFn: api.hr.tasks });
  const [tab, setTab] = useState("all");
  const tasks = data?.data || data || [];
  const visible = useMemo(() => tasks.filter((t: any) => (tab === "all" ? true : tab === "pending" ? t.status !== "completed" : t.status === "completed")), [tasks, tab]);
  const mutation = useMutation({
    mutationFn: (id: string) => api.hr.updateTaskStatus(id, "completed"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr", "tasks"] }),
  });
  const priorityClass = (p: string) =>
    p === "high" || p === "urgent" ? "bg-red-100 text-red-700" : p === "medium" ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700";

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Tasks</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">{tasks.filter((t: any) => t.status !== "completed").length} pending</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>
      </Tabs>
      {isMobile ? (
        <div className="mt-3 space-y-2.5">
          {visible.map((task: any) => (
            <Card key={task.id} className="border-border/50 shadow-none">
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{task.title}</p>
                  <Badge className={priorityClass(task.priority)}>{task.priority}</Badge>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{task.assigned_by_name || "—"}</p>
                  <Badge variant="secondary">{task.status}</Badge>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{task.due_date ? new Date(task.due_date).toLocaleDateString() : "—"}</p>
                  {task.status !== "completed" && <Button size="sm" className="h-7 text-xs" onClick={() => mutation.mutate(task.id)}>Mark Complete</Button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="mt-3 border-border/50 shadow-none">
          <Table>
            <TableHeader><TableRow><TableHead>Task Title</TableHead><TableHead>Assigned By</TableHead><TableHead>Due Date</TableHead><TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {visible.map((task: any) => (
                <TableRow key={task.id}>
                  <TableCell className="font-medium">{task.title}</TableCell>
                  <TableCell className="text-muted-foreground">{task.assigned_by_name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{task.due_date ? new Date(task.due_date).toLocaleDateString() : "—"}</TableCell>
                  <TableCell><Badge className={priorityClass(task.priority)}>{task.priority}</Badge></TableCell>
                  <TableCell><Badge variant="secondary">{task.status}</Badge></TableCell>
                  <TableCell>{task.status !== "completed" && <Button size="sm" className="h-7 text-xs" onClick={() => mutation.mutate(task.id)}>Mark Complete</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
