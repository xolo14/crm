import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, DollarSign, Calendar, MoreHorizontal, Pencil, Trash2, Loader2 } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

const CAN_CREATE_ROLES = ['super_admin', 'admin', 'manager', 'sales_representative'];
const CAN_EDIT_ALL_ROLES = ['super_admin', 'admin', 'manager'];
const CAN_DELETE_ROLES = ['super_admin', 'admin', 'manager'];

export default function Deals() {
  const { toast } = useToast();
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<any>(null);

  const canCreate = CAN_CREATE_ROLES.includes(role || '');
  const canEditAll = CAN_EDIT_ALL_ROLES.includes(role || '');
  const canDelete = CAN_DELETE_ROLES.includes(role || '');
  const canEditDeal = (deal: any) => canEditAll || deal.owner_id === user?.id;
  const canDeleteDeal = (deal: any) => canDelete;

  const { data: stages = [], isLoading: stagesLoading } = useQuery({
    queryKey: ['pipeline-stages'],
    queryFn: async () => { const res = await api.deals.stages(); return res.data || []; },
  });

  const { data: deals = [], isLoading: dealsLoading } = useQuery({
    queryKey: ['deals'],
    queryFn: async () => { const res = await api.deals.list(); return res.data || []; },
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts-select'],
    queryFn: async () => { const res = await api.contacts.list(); return (res.data || []).map((c: any) => ({ id: c.id, name: c.name })); },
  });

  const createDeal = useMutation({
    mutationFn: (data: any) => api.deals.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['deals'] }); toast({ title: 'Deal created' }); setDialogOpen(false); },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Error', description: err.message }),
  });

  const updateDeal = useMutation({
    mutationFn: ({ id, ...data }: any) => api.deals.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['deals'] }); toast({ title: 'Deal updated' }); setEditDialogOpen(false); },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Error', description: err.message }),
  });

  const deleteDeal = useMutation({
    mutationFn: (id: string) => api.deals.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['deals'] }); toast({ title: 'Deal deleted' }); },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Error', description: err.message }),
  });

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const deal = deals.find((d: any) => d.id === result.draggableId);
    if (!deal || !canEditDeal(deal)) return;
    updateDeal.mutate({ id: result.draggableId, stage_id: result.destination.droppableId });
  };

  const openDeals = deals.filter((d: any) => d.status !== 'won' && d.status !== 'lost');

  if (stagesLoading || dealsLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Deals Pipeline</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">{openDeals.length} open · ₹{openDeals.reduce((s: number, d: any) => s + Number(d.value || 0), 0).toLocaleString()}</p>
        </div>
        {canCreate && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild><Button size="sm" className="gap-1.5 h-8"><Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">Add Deal</span></Button></DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Add Deal</DialogTitle></DialogHeader>
              <DealForm stages={stages} contacts={contacts} onSubmit={data => createDeal.mutate(data)} submitting={createDeal.isPending} />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-2.5 sm:gap-4 overflow-x-auto pb-4 -mx-3 px-3 sm:-mx-6 sm:px-6 snap-x scrollbar-none">
          {stages.map((stage: any) => {
            const stageDeals = openDeals.filter((d: any) => d.stage_id === stage.id);
            const stageValue = stageDeals.reduce((s: number, d: any) => s + Number(d.value || 0), 0);
            return (
              <div key={stage.id} className="flex-shrink-0 w-[240px] sm:w-72 snap-start">
                <div className="flex items-center justify-between mb-2 px-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full" style={{ backgroundColor: stage.color || '#6366f1' }} />
                    <span className="text-xs sm:text-sm font-semibold">{stage.name}</span>
                    <span className="text-[10px] text-muted-foreground bg-muted px-1 py-0.5 rounded-full">{stageDeals.length}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">₹{stageValue.toLocaleString()}</span>
                </div>
                <Droppable droppableId={stage.id}>
                  {(provided, snapshot) => (
                    <div ref={provided.innerRef} {...provided.droppableProps}
                      className={`space-y-2 min-h-[150px] sm:min-h-[200px] p-2 rounded-lg transition-colors ${snapshot.isDraggingOver ? 'bg-accent/50' : 'bg-muted/30'}`}>
                      {stageDeals.map((deal: any, idx: number) => (
                        <Draggable key={deal.id} draggableId={deal.id} index={idx} isDragDisabled={!canEditDeal(deal)}>
                          {(provided, snapshot) => (
                            <Card ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}
                              className={`border-border/50 shadow-none ${snapshot.isDragging ? 'shadow-lg rotate-2' : ''}`}>
                              <CardContent className="p-2.5 sm:p-3">
                                <div className="flex items-start justify-between gap-1">
                                  <p className="text-xs sm:text-sm font-medium flex-1">{deal.title}</p>
                                  {(canEditDeal(deal) || canDeleteDeal(deal)) && (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-5 w-5 sm:h-6 sm:w-6 shrink-0"><MoreHorizontal className="h-3 w-3" /></Button></DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        {canEditDeal(deal) && <DropdownMenuItem onClick={() => { setEditingDeal(deal); setEditDialogOpen(true); }}><Pencil className="h-4 w-4 mr-2" />Edit</DropdownMenuItem>}
                                        {canDeleteDeal(deal) && <DropdownMenuItem className="text-destructive" onClick={() => { if (confirm('Delete?')) deleteDeal.mutate(deal.id); }}><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem>}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )}
                                </div>
                                <div className="flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground mt-1.5">
                                  <span className="flex items-center gap-0.5"><DollarSign className="h-3 w-3" />₹{Number(deal.value || 0).toLocaleString()}</span>
                                  {deal.expected_close_date && <span className="flex items-center gap-0.5"><Calendar className="h-3 w-3" />{new Date(deal.expected_close_date).toLocaleDateString()}</span>}
                                </div>
                              </CardContent>
                            </Card>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>

      <Dialog open={editDialogOpen} onOpenChange={(o) => { setEditDialogOpen(o); if (!o) setEditingDeal(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Edit Deal</DialogTitle></DialogHeader>
          {editingDeal && <DealForm stages={stages} contacts={contacts} initialData={editingDeal} onSubmit={data => updateDeal.mutate({ id: editingDeal.id, ...data })} submitting={updateDeal.isPending} isEdit />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DealForm({ stages, contacts, onSubmit, submitting, initialData, isEdit }: any) {
  const defaultStage = stages.find((s: any) => s.is_default) || stages[0];
  const [form, setForm] = useState(initialData || { title: '', value: '', stage_id: defaultStage?.id || '', contact_id: '', expected_close_date: '', description: '' });
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit({ ...form, value: form.value ? Number(form.value) : null, contact_id: form.contact_id || null }); }} className="space-y-4">
      <div className="space-y-2"><Label>Title *</Label><Input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2"><Label>Value (₹)</Label><Input type="number" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></div>
        <div className="space-y-2"><Label>Stage</Label>
          <Select value={form.stage_id} onValueChange={v => setForm({ ...form, stage_id: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{stages.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2"><Label>Contact</Label>
          <Select value={form.contact_id || ''} onValueChange={v => setForm({ ...form, contact_id: v })}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{contacts.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2"><Label>Close Date</Label><Input type="date" value={form.expected_close_date || ''} onChange={e => setForm({ ...form, expected_close_date: e.target.value })} /></div>
      </div>
      <div className="space-y-2"><Label>Description</Label><Textarea value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
      <Button type="submit" className="w-full" disabled={submitting}>{submitting ? 'Saving...' : (isEdit ? 'Update' : 'Create')}</Button>
    </form>
  );
}
