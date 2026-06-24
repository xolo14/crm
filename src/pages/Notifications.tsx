import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, format, isAfter, isBefore, startOfDay, endOfDay } from 'date-fns';
import { Bell, Check, CheckCheck, Trash2, UserPlus, Info, AlertTriangle, Search, Calendar } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface Notification {
  id: string;
  title: string;
  message: string | null;
  type: string;
  is_read: boolean;
  link: string | null;
  created_at: string;
}

const typeIcons: Record<string, any> = {
  lead_assigned: UserPlus,
  info: Info,
  warning: AlertTriangle,
};

const typeLabels: Record<string, string> = {
  lead_assigned: 'Lead Assigned',
  info: 'Info',
  warning: 'Warning',
};

const typeBadgeColors: Record<string, string> = {
  lead_assigned: 'bg-primary/10 text-primary border-primary/20',
  info: 'bg-info/10 text-info border-info/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
};

export default function Notifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [readFilter, setReadFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await api.notifications.list();
      if (Array.isArray(data)) setNotifications(data);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [user?.id, fetchNotifications]);

  const filtered = notifications.filter(n => {
    if (typeFilter !== 'all' && n.type !== typeFilter) return false;
    if (readFilter === 'unread' && n.is_read) return false;
    if (readFilter === 'read' && !n.is_read) return false;
    if (search && !n.title.toLowerCase().includes(search.toLowerCase()) && !(n.message || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (dateFrom) {
      const from = startOfDay(new Date(dateFrom));
      if (isBefore(new Date(n.created_at), from)) return false;
    }
    if (dateTo) {
      const to = endOfDay(new Date(dateTo));
      if (isAfter(new Date(n.created_at), to)) return false;
    }
    return true;
  });

  const markAsRead = async (id: string) => {
    await api.notifications.update(id, { is_read: true });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const markAllRead = async () => {
    const ids = filtered.filter(n => !n.is_read).map(n => n.id);
    if (!ids.length) return;
    await api.notifications.markAllRead(ids);
    setNotifications(prev => prev.map(n => ids.includes(n.id) ? { ...n, is_read: true } : n));
    toast({ title: `${ids.length} notifications marked as read` });
  };

  const deleteNotification = async (id: string) => {
    await api.notifications.delete(id);
    setNotifications(prev => prev.filter(n => n.id !== id));
    setSelectedIds(prev => { const s = new Set(prev); s.delete(id); return s; });
  };

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    await api.notifications.bulkDelete(ids);
    setNotifications(prev => prev.filter(n => !selectedIds.has(n.id)));
    setSelectedIds(new Set());
    toast({ title: `${ids.length} notifications deleted` });
  };

  const bulkMarkRead = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    await api.notifications.markAllRead(ids);
    setNotifications(prev => prev.map(n => selectedIds.has(n.id) ? { ...n, is_read: true } : n));
    setSelectedIds(new Set());
    toast({ title: `${ids.length} notifications marked as read` });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(n => n.id)));
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const uniqueTypes = [...new Set(notifications.map(n => n.type))];

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Bell className="h-5 w-5 md:h-6 md:w-6 text-primary" />
            Notifications
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-xs">{unreadCount} unread</Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">View and manage all your notifications</p>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={markAllRead}>
              <CheckCheck className="h-4 w-4" /> Mark All Read
            </Button>
          )}
        </div>
      </div>

      <Card className="p-3 md:p-4">
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3">
          <div className="relative col-span-2 sm:col-span-2 lg:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue placeholder="All Types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {uniqueTypes.map(t => (
                <SelectItem key={t} value={t}>{typeLabels[t] || t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={readFilter} onValueChange={setReadFilter}>
            <SelectTrigger><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unread">Unread</SelectItem>
              <SelectItem value="read">Read</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="pl-9" />
          </div>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="pl-9" />
          </div>
        </div>
      </Card>

      {selectedIds.size > 0 && (
        <Card className="p-3 border-primary/30 bg-primary/5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1" onClick={bulkMarkRead}>
                <Check className="h-3.5 w-3.5" /> Mark Read
              </Button>
              <Button variant="destructive" size="sm" className="gap-1" onClick={bulkDelete}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="divide-y divide-border overflow-hidden">
        {filtered.length > 0 && (
          <div className="px-4 py-2 bg-muted/30 flex items-center gap-3 border-b border-border">
            <Checkbox checked={selectedIds.size === filtered.length && filtered.length > 0} onCheckedChange={selectAll} />
            <span className="text-xs text-muted-foreground font-medium">
              {filtered.length} notification{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Bell className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No notifications found</p>
          </div>
        ) : (
          filtered.map(n => {
            const Icon = typeIcons[n.type] || Info;
            return (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors",
                  !n.is_read && "bg-primary/5"
                )}
              >
                <Checkbox checked={selectedIds.has(n.id)} onCheckedChange={() => toggleSelect(n.id)} className="mt-1" />
                <div className={cn(
                  "h-9 w-9 rounded-full flex items-center justify-center shrink-0",
                  n.type === 'lead_assigned' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                )}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => {
                    if (!n.is_read) markAsRead(n.id);
                    if (n.link) window.location.href = n.link;
                  }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={cn("text-sm", !n.is_read && "font-semibold")}>{n.title}</p>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", typeBadgeColors[n.type] || '')}>
                      {typeLabels[n.type] || n.type}
                    </Badge>
                    {!n.is_read && <span className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                  </div>
                  {n.message && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {format(new Date(n.created_at), 'MMM d, yyyy h:mm a')} · {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!n.is_read && (
                    <button onClick={() => markAsRead(n.id)} className="p-1.5 rounded-md hover:bg-muted" title="Mark as read">
                      <Check className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                  <button onClick={() => deleteNotification(n.id)} className="p-1.5 rounded-md hover:bg-destructive/10" title="Delete">
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
