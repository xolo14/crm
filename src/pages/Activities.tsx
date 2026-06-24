import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Phone, Mail, Users, FileText, CheckSquare, MoreHorizontal, Pencil, Trash2, Loader2 } from 'lucide-react';

const TYPES = ['call', 'meeting', 'email', 'note', 'task'] as const;
const typeIcons: Record<string, any> = { call: Phone, meeting: Users, email: Mail, note: FileText, task: CheckSquare };
const typeColors: Record<string, string> = {
  call: 'bg-blue-500/10 text-blue-600', meeting: 'bg-amber-500/10 text-amber-600',
  email: 'bg-green-500/10 text-green-600', note: 'bg-muted text-muted-foreground', task: 'bg-purple-500/10 text-purple-600',
};

const CAN_CREATE_ROLES = ['super_admin', 'admin', 'manager', 'sales_representative'];
const CAN_EDIT_ALL_ROLES = ['super_admin', 'admin', 'manager'];
const CAN_DELETE_ROLES = ['super_admin', 'admin'];

export default function Activities() {
  const { toast } = useToast();
  const { user, role } = useAuth();
  const isMobile = useIsMobile();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const canCreate = CAN_CREATE_ROLES.includes(role || '');
  const canEditAll = CAN_EDIT_ALL_ROLES.includes(role || '');
  const canDelete = CAN_DELETE_ROLES.includes(role || '');

  const canEditActivity = (activity: any) => canEditAll || activity.user_id === user?.id;
  const canDeleteActivity = () => canDelete;

  useEffect(() => { fetchActivities(); }, []);

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const data = await api.activities.list();
      setActivities(Array.isArray(data) ? data : data.activities || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleCreate = async (formData: any) => {
    try {
      await api.activities.create({ ...formData, user_id: user?.id, duration_minutes: formData.duration_minutes ? Number(formData.duration_minutes) : null });
      toast({ title: 'Activity logged' }); setDialogOpen(false); fetchActivities();
    } catch (err: any) { toast({ variant: 'destructive', title: err.message }); }
  };

  const handleUpdate = async (formData: any) => {
    if (!editingActivity) return;
    try {
      await api.activities.update(editingActivity.id, { ...formData, duration_minutes: formData.duration_minutes ? Number(formData.duration_minutes) : null });
      toast({ title: 'Activity updated' }); setEditDialogOpen(false); setEditingActivity(null); fetchActivities();
    } catch (err: any) { toast({ variant: 'destructive', title: err.message }); }
  };

  const handleDeleteActivity = async (activity: any) => {
    if (!canDeleteActivity()) { toast({ variant: 'destructive', title: 'Permission denied' }); return; }
    if (confirm('Delete this activity?')) {
      try { await api.activities.delete(activity.id); toast({ title: 'Activity deleted' }); fetchActivities(); }
      catch (err: any) { toast({ variant: 'destructive', title: err.message }); }
    }
  };

  const openEdit = (activity: any) => {
    if (!canEditActivity(activity)) { toast({ variant: 'destructive', title: 'Permission denied' }); return; }
    setEditingActivity(activity); setEditDialogOpen(true);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Activities</h1>
          <p className="text-sm text-muted-foreground mt-1">Track calls, meetings, and interactions</p>
        </div>
        {canCreate && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild><Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" />{!isMobile && ' Log Activity'}</Button></DialogTrigger>
            <DialogContent className="max-w-[95vw] sm:max-w-lg">
              <DialogHeader><DialogTitle>Log Activity</DialogTitle></DialogHeader>
              <ActivityForm onSubmit={handleCreate} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {activities.length === 0 ? <p className="text-muted-foreground text-center py-12">No activities yet</p> : (
        <div className="space-y-3">
          {activities.map((a) => {
            const Icon = typeIcons[a.type] || FileText;
            return (
              <Card key={a.id} className="border-border/50 shadow-none">
                <CardContent className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4">
                  <div className={`p-2 rounded-lg ${typeColors[a.type]} shrink-0`}><Icon className="h-4 w-4" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-sm font-medium truncate">{a.subject}</p>
                      <Badge variant="secondary" className="text-xs capitalize">{a.type}</Badge>
                    </div>
                    {a.description && <p className="text-xs text-muted-foreground line-clamp-2">{a.description}</p>}
                  </div>
                  <div className="text-right shrink-0 flex items-start gap-1 sm:gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground">{new Date(a.occurred_at || a.created_at).toLocaleDateString()}</p>
                      {a.duration_minutes && <p className="text-xs text-muted-foreground">{a.duration_minutes}m</p>}
                    </div>
                    {(canEditActivity(a) || canDeleteActivity()) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canEditActivity(a) && <DropdownMenuItem onClick={() => openEdit(a)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>}
                          {canDeleteActivity() && <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteActivity(a)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditingActivity(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader><DialogTitle>Edit Activity</DialogTitle></DialogHeader>
          {editingActivity && <ActivityForm initialData={editingActivity} onSubmit={handleUpdate} isEdit />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActivityForm({ onSubmit, initialData, isEdit }: { onSubmit: (data: any) => void; initialData?: any; isEdit?: boolean }) {
  const [form, setForm] = useState(initialData || { type: 'call', subject: '', description: '', duration_minutes: '' });
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div className="space-y-2"><Label>Type</Label>
        <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2"><Label>Subject *</Label><Input required value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>
      <div className="space-y-2"><Label>Description</Label><Textarea value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
      <div className="space-y-2"><Label>Duration (minutes)</Label><Input type="number" value={form.duration_minutes || ''} onChange={e => setForm({ ...form, duration_minutes: e.target.value })} /></div>
      <Button type="submit" className="w-full">{isEdit ? 'Update Activity' : 'Log Activity'}</Button>
    </form>
  );
}
