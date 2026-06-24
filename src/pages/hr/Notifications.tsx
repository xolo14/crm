import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default function HRNotifications() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["hr", "notifications"], queryFn: api.hr.notifications, refetchInterval: 30000 });
  const notifications = data?.data || data || [];
  const mutation = useMutation({
    mutationFn: (id: string) => api.hr.markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr", "notifications"] }),
  });

  if (!notifications.length) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <p className="text-lg font-medium">No notifications</p>
          <p className="text-sm">You are all caught up.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          Notifications
          <Badge variant="secondary">{notifications.filter((x: any) => !Number(x.is_read)).length} unread</Badge>
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Latest HR alerts and updates</p>
      </div>
      {notifications.map((n: any) => (
        <Card key={n.id} className={!Number(n.is_read) ? "border-primary/40 bg-primary/5" : ""}>
          <CardContent className="py-3">
            <button className="w-full text-left" onClick={() => mutation.mutate(n.id)}>
              <p className="font-medium">{n.title}</p>
              {n.message && <p className="text-sm text-muted-foreground">{n.message}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{n.created_at ? new Date(n.created_at).toLocaleString() : ""}</p>
            </button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
