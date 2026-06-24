import { useState, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, Mail, Phone, Download, Upload, MoreHorizontal, Pencil, Trash2, Loader2 } from 'lucide-react';
import { BulkActionsBar } from '@/components/BulkActions';
import * as perms from '@/lib/permissions';
import { useIsMobile } from '@/hooks/use-mobile';

export default function Contacts() {
  const { toast } = useToast();
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasCreate = perms.canCreate(role);
  const hasEditAll = perms.canEditAll(role);
  const hasDelete = perms.canDelete(role);
  const hasBulkDelete = perms.canBulkDelete(role);
  const hasExport = perms.canExport(role);

  const canEditContact = (c: any) => hasEditAll || c.owner_id === user?.id;
  const canDeleteContact = () => hasDelete;

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['contacts'],
    queryFn: async () => { const res = await api.contacts.list(); return res.data || []; },
  });

  const createContact = useMutation({
    mutationFn: (data: any) => api.contacts.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['contacts'] }); toast({ title: 'Contact created' }); setDialogOpen(false); },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Error', description: err.message }),
  });

  const updateContact = useMutation({
    mutationFn: ({ id, ...data }: any) => api.contacts.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['contacts'] }); toast({ title: 'Contact updated' }); setEditDialogOpen(false); },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Error', description: err.message }),
  });

  const deleteContact = useMutation({
    mutationFn: (id: string) => api.contacts.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['contacts'] }); toast({ title: 'Contact deleted' }); },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Error', description: err.message }),
  });

  const filtered = contacts.filter((c: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return c.name?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s) || c.company?.toLowerCase().includes(s);
  });

  const handleExport = () => {
    const headers = ['Name', 'Email', 'Phone', 'Company', 'Position'];
    const rows = contacts.map((c: any) => [c.name, c.email || '', c.phone || '', c.company || '', c.position || '']);
    const csv = [headers.join(','), ...rows.map((r: any) => r.map((v: any) => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'contacts.csv'; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Contacts exported' });
  };

  const toggleSelect = (id: string) => { setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const toggleSelectAll = () => { if (selectedIds.size === filtered.length) setSelectedIds(new Set()); else setSelectedIds(new Set(filtered.map((c: any) => c.id))); };

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">{contacts.length} total</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasExport && <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={handleExport}><Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">Export</span></Button>}
          {hasCreate && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild><Button size="sm" className="gap-1.5 h-8"><Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">Add Contact</span></Button></DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
                <ContactForm onSubmit={data => createContact.mutate(data)} submitting={createContact.isPending} />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="mb-3 max-w-xs sm:max-w-sm relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
      </div>

      {isMobile ? (
        <div className="space-y-2.5">
          {filtered.length === 0 ? <div className="flex flex-col items-center py-16"><Mail className="h-12 w-12 text-muted-foreground/20 mb-4" /><p className="text-sm font-medium text-muted-foreground">No contacts</p></div> : filtered.map((c: any) => (
            <div key={c.id} className="mobile-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[15px] leading-tight">{c.name}</p>
                  {(c.company || c.position) && <p className="text-[13px] text-muted-foreground mt-0.5">{c.company}{c.position ? ` · ${c.position}` : ''}</p>}
                  <div className="flex flex-col gap-1 mt-2.5">
                    {c.email && <span className="text-[13px] text-muted-foreground flex items-center gap-2"><Mail className="h-3.5 w-3.5 shrink-0" />{c.email}</span>}
                    {c.phone && <span className="text-[13px] text-muted-foreground flex items-center gap-2"><Phone className="h-3.5 w-3.5 shrink-0" />{c.phone}</span>}
                  </div>
                </div>
                {(canEditContact(c) || canDeleteContact()) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg shrink-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canEditContact(c) && <DropdownMenuItem onClick={() => { setEditingContact(c); setEditDialogOpen(true); }}><Pencil className="h-4 w-4 mr-2" />Edit</DropdownMenuItem>}
                      {canDeleteContact() && <DropdownMenuItem className="text-destructive" onClick={() => { if (confirm('Delete?')) deleteContact.mutate(c.id); }}><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card className="border-border/50 shadow-none">
          <Table>
            <TableHeader><TableRow><TableHead className="w-12">#</TableHead><TableHead>Name</TableHead><TableHead>Company</TableHead><TableHead>Contact</TableHead><TableHead>Position</TableHead><TableHead className="w-12"></TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No contacts</TableCell></TableRow> : filtered.map((c: any, i: number) => (
                <TableRow key={c.id}>
                  <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.company || '—'}</TableCell>
                  <TableCell>
                    {c.email && <span className="text-xs flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</span>}
                    {c.phone && <span className="text-xs flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{c.phone}</span>}
                  </TableCell>
                  <TableCell className="text-sm">{c.position || '—'}</TableCell>
                  <TableCell>
                    {(canEditContact(c) || canDeleteContact()) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canEditContact(c) && <DropdownMenuItem onClick={() => { setEditingContact(c); setEditDialogOpen(true); }}><Pencil className="h-4 w-4 mr-2" />Edit</DropdownMenuItem>}
                          {canDeleteContact() && <DropdownMenuItem className="text-destructive" onClick={() => { if (confirm('Delete?')) deleteContact.mutate(c.id); }}><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={editDialogOpen} onOpenChange={(o) => { setEditDialogOpen(o); if (!o) setEditingContact(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Edit Contact</DialogTitle></DialogHeader>
          {editingContact && <ContactForm initialData={editingContact} onSubmit={data => updateContact.mutate({ id: editingContact.id, ...data })} submitting={updateContact.isPending} isEdit />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ContactForm({ onSubmit, submitting, initialData, isEdit }: { onSubmit: (data: any) => void; submitting?: boolean; initialData?: any; isEdit?: boolean }) {
  const [form, setForm] = useState(initialData || { name: '', email: '', phone: '', company: '', position: '', notes: '' });
  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div className="space-y-2"><Label>Name *</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
        <div className="space-y-2"><Label>Phone</Label><Input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2"><Label>Company</Label><Input value={form.company || ''} onChange={e => setForm({ ...form, company: e.target.value })} /></div>
        <div className="space-y-2"><Label>Position</Label><Input value={form.position || ''} onChange={e => setForm({ ...form, position: e.target.value })} /></div>
      </div>
      <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
      <Button type="submit" className="w-full" disabled={submitting}>{submitting ? 'Saving...' : (isEdit ? 'Update' : 'Create')}</Button>
    </form>
  );
}
