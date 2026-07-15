import { useState, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, Filter, Download, Upload, MoreHorizontal, Pencil, Trash2, Loader2, CheckSquare } from 'lucide-react';
import * as perms from '@/lib/permissions';
import { useIsMobile } from '@/hooks/use-mobile';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
const priorityColors: Record<string, string> = {
  low: 'bg-muted text-muted-foreground', medium: 'bg-blue-500/10 text-blue-600',
  high: 'bg-amber-500/10 text-amber-600', urgent: 'bg-red-500/10 text-red-600',
};

export default function Tasks() {
  const { toast } = useToast();
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => { const res = await api.tasks.list(); return res.data || []; },
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => { const res = await api.profiles.list(); return res.data || []; },
  });

  const createTask = useMutation({
    mutationFn: (data: any) => api.tasks.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tasks'] }); toast({ title: 'Task created' }); setDialogOpen(false); },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Error', description: err.message }),
  });

  const updateTask = useMutation({
    mutationFn: ({ id, ...data }: any) => api.tasks.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tasks'] }); toast({ title: 'Task updated' }); setEditDialogOpen(false); },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Error', description: err.message }),
  });

  const deleteTask = useMutation({
    mutationFn: (id: string) => api.tasks.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tasks'] }); toast({ title: 'Task deleted' }); },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Error', description: err.message }),
  });

  const toggleComplete = (id: string, completed: boolean) => {
    updateTask.mutate({ id, status: completed ? 'completed' : 'pending' });
  };

  const filtered = tasks.filter((t: any) => {
    const matchSearch = !search || t.title?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const isOverdue = (t: any) => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'completed';
  const getAssigneeName = (userId: string | null) => {
    if (!userId) return null;
    const m = teamMembers.find((m: any) => (m.user_id || m.id) === userId);
    return m?.full_name || m?.email || null;
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">{tasks.filter((t: any) => t.status !== 'completed').length} pending</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild><Button size="sm" className="gap-1.5 h-8"><Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">Add Task</span></Button></DialogTrigger>
          <DialogContent className="max-h-[min(90dvh,calc(100dvh-2rem))] overflow-y-auto"><DialogHeader><DialogTitle>Add Task</DialogTitle></DialogHeader>
            <TaskForm onSubmit={data => createTask.mutate(data)} submitting={createTask.isPending} teamMembers={teamMembers} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-2 mb-3">
        <div className="relative flex-1 max-w-xs sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px] h-9"><Filter className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isMobile ? (
        <div className="space-y-2.5">
          {filtered.length === 0 ? <div className="flex flex-col items-center py-16"><CheckSquare className="h-12 w-12 text-muted-foreground/20 mb-4" /><p className="text-sm font-medium text-muted-foreground">No tasks</p></div> : filtered.map((task: any) => (
            <div key={task.id} className={`mobile-card p-4 ${task.status === 'completed' ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-3">
                <Checkbox className="mt-1 h-5 w-5" checked={task.status === 'completed'} onCheckedChange={c => toggleComplete(task.id, !!c)} />
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-[15px] leading-tight ${task.status === 'completed' ? 'line-through' : ''}`}>{task.title}</p>
                  {task.description && <p className="text-[13px] text-muted-foreground mt-1 line-clamp-2">{task.description}</p>}
                  <div className="flex flex-wrap items-center gap-2 mt-2.5">
                    <Badge variant="outline" className={`${priorityColors[task.priority || 'medium']} capitalize text-[11px] px-2 py-0.5 rounded-md`}>{task.priority}</Badge>
                    {task.due_date && <span className={`text-[12px] ${isOverdue(task) ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>{new Date(task.due_date).toLocaleDateString()}</span>}
                    {getAssigneeName(task.assigned_to) && <span className="text-[12px] text-primary font-medium">→ {getAssigneeName(task.assigned_to)}</span>}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg shrink-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setEditingTask(task); setEditDialogOpen(true); }}><Pencil className="h-4 w-4 mr-2" />Edit</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => { if (confirm('Delete?')) deleteTask.mutate(task.id); }}><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card className="border-border/50 shadow-none">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-12">#</TableHead><TableHead className="w-10"></TableHead><TableHead>Task</TableHead><TableHead>Priority</TableHead><TableHead>Due</TableHead><TableHead>Assigned</TableHead><TableHead>Status</TableHead><TableHead className="w-12"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No tasks</TableCell></TableRow>
              : filtered.map((task: any, i: number) => (
                <TableRow key={task.id} className={task.status === 'completed' ? 'opacity-50' : ''}>
                  <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                  <TableCell><Checkbox checked={task.status === 'completed'} onCheckedChange={c => toggleComplete(task.id, !!c)} /></TableCell>
                  <TableCell>
                    <p className={`font-medium text-sm ${task.status === 'completed' ? 'line-through' : ''}`}>{task.title}</p>
                    {task.description && <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{task.description}</p>}
                  </TableCell>
                  <TableCell><Badge variant="outline" className={`${priorityColors[task.priority || 'medium']} capitalize text-xs`}>{task.priority}</Badge></TableCell>
                  <TableCell>{task.due_date ? <span className={`text-sm ${isOverdue(task) ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>{new Date(task.due_date).toLocaleDateString()}</span> : '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{getAssigneeName(task.assigned_to) || '—'}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize text-xs">{task.status?.replace('_', ' ')}</Badge></TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditingTask(task); setEditDialogOpen(true); }}><Pencil className="h-4 w-4 mr-2" />Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => { if (confirm('Delete?')) deleteTask.mutate(task.id); }}><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={editDialogOpen} onOpenChange={(o) => { setEditDialogOpen(o); if (!o) setEditingTask(null); }}>
        <DialogContent className="max-h-[min(90dvh,calc(100dvh-2rem))] overflow-y-auto"><DialogHeader><DialogTitle>Edit Task</DialogTitle></DialogHeader>
          {editingTask && <TaskForm initialData={editingTask} onSubmit={data => updateTask.mutate({ id: editingTask.id, ...data })} submitting={updateTask.isPending} teamMembers={teamMembers} isEdit />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskForm({ onSubmit, submitting, teamMembers, initialData, isEdit }: any) {
  const [form, setForm] = useState(initialData || { title: '', description: '', due_date: '', priority: 'medium', status: 'pending', assigned_to: '' });
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit({ ...form, assigned_to: form.assigned_to || null }); }} className="space-y-4">
      <div className="space-y-2"><Label>Title *</Label><Input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
      <div className="space-y-2"><Label>Description</Label><Textarea value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2"><Label>Due Date</Label><Input type="datetime-local" value={form.due_date || ''} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
        <div className="space-y-2"><Label>Priority</Label>
          <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {isEdit && <div className="space-y-2"><Label>Status</Label>
        <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s.replace('_', ' ')}</SelectItem>)}</SelectContent>
        </Select>
      </div>}
      <div className="space-y-2"><Label>Assign To</Label>
        <Select value={form.assigned_to || ''} onValueChange={v => setForm({ ...form, assigned_to: v })}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>
            {teamMembers.map((m: any) => {
              const uid = m.user_id || m.id;
              return (
                <SelectItem key={uid} value={uid}>{m.full_name || m.email}</SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>{submitting ? 'Saving...' : (isEdit ? 'Update' : 'Create')}</Button>
    </form>
  );
}
