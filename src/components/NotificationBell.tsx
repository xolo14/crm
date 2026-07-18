import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bell, Check, CheckCheck, Trash2, UserPlus, Info, AlertTriangle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  id: string;
  title: string;
  message: string | null;
  type: string;
  is_read: boolean;
  link: string | null;
  created_at: string;
}

const typeIcons: Record<string, LucideIcon> = {
  lead_assigned: UserPlus,
  info: Info,
  warning: AlertTriangle,
};

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  // Shared react-query key: the two always-mounted bells (mobile + desktop)
  // dedupe into a single 30s poll, which also pauses while the tab is hidden.
  const { data } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async () => {
      const res = await api.notifications.list();
      return Array.isArray(res) ? (res as Notification[]) : [];
    },
    enabled: Boolean(user?.id),
    refetchInterval: 30000,
    staleTime: 25000,
  });
  const notifications = data ?? [];

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const patchNotifications = (updater: (prev: Notification[]) => Notification[]) => {
    queryClient.setQueryData<Notification[]>(['notifications', user?.id], prev =>
      updater(prev ?? []),
    );
  };

  const markAsRead = async (id: string) => {
    try {
      await api.notifications.update(id, { is_read: true });
      patchNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) { console.error(err); }
  };

  const markAllRead = async () => {
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;
    try {
      await api.notifications.markAllRead(unreadIds);
      patchNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (err) { console.error(err); }
  };

  const deleteNotification = async (id: string) => {
    try {
      await api.notifications.delete(id);
      patchNotifications(prev => prev.filter(n => n.id !== id));
    } catch (err) { console.error(err); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9">
          <Bell className="h-4.5 w-4.5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4.5 min-w-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={markAllRead}>
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[360px]">
          {notifications.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((n) => {
                const Icon = typeIcons[n.type] || Info;
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "flex gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer",
                      !n.is_read && "bg-primary/5"
                    )}
                    onClick={() => {
                      if (!n.is_read) markAsRead(n.id);
                      if (n.link) window.location.href = n.link;
                    }}
                  >
                    <div className={cn(
                      "h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      n.type === 'lead_assigned' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    )}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm", !n.is_read && "font-semibold")}>{n.title}</p>
                      {n.message && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>}
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {!n.is_read && (
                        <button onClick={(e) => { e.stopPropagation(); markAsRead(n.id); }} className="p-1 rounded hover:bg-muted" title="Mark as read">
                          <Check className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }} className="p-1 rounded hover:bg-destructive/10" title="Delete">
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
