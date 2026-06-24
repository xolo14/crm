import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, Download, Upload, MoreHorizontal, Pencil, Trash2, Loader2, Info } from 'lucide-react';
import { BulkActionsBar } from '@/components/BulkActions';
import * as perms from '@/lib/permissions';

const STUDENT_STATUSES = ['active', 'completed', 'dropped'] as const;

const LEAD_SOURCE_LABELS: Record<string, string> = {
  google_ads: 'Google Ads', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube',
  website: 'Website', google_forms: 'Google Forms', whatsapp: 'WhatsApp', referral: 'Referral',
  walkin: 'Walk-in', college_seminar: 'College Seminar', other: 'Other',
};

function formatLeadSource(raw?: string | null) {
  if (!raw) return '—';
  return LEAD_SOURCE_LABELS[raw] || String(raw).replace(/_/g, ' ');
}

function parseLeadTags(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j.join(', ') : raw;
    } catch {
      return raw;
    }
  }
  if (Array.isArray(raw)) return raw.join(', ');
  return String(raw);
}

export default function Students() {
  const { toast } = useToast();
  const { role, organization } = useAuth();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailStudent, setDetailStudent] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasCreate = perms.canCreate(role);
  const hasEditAll = perms.canEditAll(role);
  const hasDelete = perms.canDelete(role);
  const hasBulkDelete = perms.canBulkDelete(role);
  const hasImport = perms.canImport(role);
  const hasExport = perms.canExport(role);

  useEffect(() => {
    fetchStudents();
  }, [organization?.id]);

  const fetchStudents = async () => {
    setLoading(true);
    try {
      const data = await api.students.list();
      const list = Array.isArray(data) ? data : data.data || data.students || [];
      setStudents(list);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleExport = () => {
    const headers = ['S.No', 'Name', 'Email', 'Phone', 'College', 'Year', 'Course', 'Batch', 'Status', 'Enrolled'];
    const rows = students.map((s, i) => [i + 1, s.name, s.email, s.phone, s.college, s.year_of_study, s.course_name || s.course || '—', s.batch_name || s.batch || '—', s.status, s.enrollment_date]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'students.csv'; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Students exported' });
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const lines = (evt.target?.result as string).split('\n').slice(1).filter(Boolean);
      const imported = lines.map((line, i) => {
        const cols = line.split(',').map(c => c.replace(/^"|"$/g, '').trim());
        return { id: String(Date.now() + i), name: cols[1] || '', email: cols[2] || '', phone: cols[3] || '', college: cols[4] || '', year_of_study: cols[5] || '', course: cols[6] || '—', batch: cols[7] || '—', status: cols[8] || 'active', enrollment_date: cols[9] || new Date().toISOString().split('T')[0] };
      });
      setStudents(prev => [...imported, ...prev]);
      toast({ title: `${imported.length} students imported` });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const q = search.toLowerCase();
  const filtered = students.filter(s =>
    !search
    || s.name?.toLowerCase().includes(q)
    || s.email?.toLowerCase().includes(q)
    || s.organization_name?.toLowerCase().includes(q)
    || String(s.course_name || s.course || '').toLowerCase().includes(q)
    || String(s.batch_name || s.batch || '').toLowerCase().includes(q)
  );

  const statusColor = (status: string) => {
    if (status === 'active') return 'bg-emerald-500/10 text-emerald-700 border-emerald-200';
    if (status === 'completed') return 'bg-blue-500/10 text-blue-700 border-blue-200';
    return 'bg-red-500/10 text-red-700 border-red-200';
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    try {
      await api.students.create({
        name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'),
        college: fd.get('college'), year_of_study: fd.get('year'),
      });
      toast({ title: 'Student enrolled successfully' });
      setDialogOpen(false);
      fetchStudents();
    } catch (err: any) { toast({ variant: 'destructive', title: err.message }); }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    try {
      await api.students.update(editingStudent.id, {
        name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'),
        college: fd.get('college'), year_of_study: fd.get('year'), status: fd.get('status'),
      });
      toast({ title: 'Student updated' });
      setEditDialogOpen(false);
      setEditingStudent(null);
      fetchStudents();
    } catch (err: any) { toast({ variant: 'destructive', title: err.message }); }
  };

  const handleDelete = async (id: string) => {
    if (!hasDelete) { toast({ variant: 'destructive', title: 'Permission denied' }); return; }
    if (confirm('Delete this student?')) {
      try {
        await api.students.delete(id);
        toast({ title: 'Student deleted' });
        fetchStudents();
      } catch (err: any) { toast({ variant: 'destructive', title: err.message }); }
    }
  };

  const handleBulkDelete = async () => {
    for (const id of selectedIds) { await api.students.delete(id); }
    toast({ title: `${selectedIds.size} students deleted` });
    setSelectedIds(new Set());
    fetchStudents();
  };

  const openEdit = (student: any) => {
    if (!hasEditAll) { toast({ variant: 'destructive', title: 'Permission denied' }); return; }
    setEditingStudent(student);
    setEditDialogOpen(true);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(s => s.id)));
  };
  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < filtered.length;

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Students</h1>
          <p className="text-sm text-muted-foreground mt-1">{students.length} enrolled students</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasImport && (
            <>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4" />{!isMobile && ' Import'}</Button>
            </>
          )}
          {hasExport && <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport}><Download className="h-4 w-4" />{!isMobile && ' Export'}</Button>}
          {hasCreate && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild><Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" />{!isMobile && ' Enroll'}</Button></DialogTrigger>
              <DialogContent className="max-w-[95vw] sm:max-w-lg">
                <DialogHeader><DialogTitle>Enroll New Student</DialogTitle></DialogHeader>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Name *</Label><Input name="name" required /></div>
                    <div className="space-y-2"><Label>Email *</Label><Input name="email" type="email" required /></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2"><Label>Phone</Label><Input name="phone" /></div>
                    <div className="space-y-2"><Label>College</Label><Input name="college" /></div>
                  </div>
                  <div className="space-y-2"><Label>Year of Study</Label><Input name="year" placeholder="e.g. 3rd Year" /></div>
                  <Button type="submit" className="w-full">Enroll Student</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="mb-4 max-w-sm relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search name, email, org, course, batch…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {hasBulkDelete && <BulkActionsBar selectedCount={selectedIds.size} onBulkDelete={handleBulkDelete} canBulkDelete={hasBulkDelete} entityName="students" />}

      {isMobile ? (
        <div className="space-y-2.5">
          {filtered.length === 0 ? <div className="flex flex-col items-center py-16"><Search className="h-12 w-12 text-muted-foreground/20 mb-4" /><p className="text-sm font-medium text-muted-foreground">No students found</p></div> : filtered.map((student, i) => (
            <div key={student.id} className="mobile-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] text-muted-foreground font-mono w-5">{i + 1}.</span>
                    <p className="font-semibold text-[15px] leading-tight truncate">{student.name}</p>
                  </div>
                  <div className="ml-7 space-y-0.5">
                    <p className="text-[13px] text-muted-foreground truncate">{student.email}</p>
                    {student.phone && <p className="text-[13px] text-muted-foreground">{student.phone}</p>}
                  </div>
                  <div className="flex items-center gap-2 mt-2.5 ml-7 flex-wrap">
                    <Badge variant="outline" className={statusColor(student.status) + ' capitalize text-[11px] px-2 py-0.5 rounded-md'}>{student.status}</Badge>
                    {(student.organization_name || organization?.name) && (
                      <span className="text-[11px] text-muted-foreground">{student.organization_name || organization?.name}</span>
                    )}
                    {(student.college || student.lead_college) && (
                      <span className="text-[12px] text-muted-foreground">{student.college || student.lead_college}</span>
                    )}
                  </div>
                  {(student.source_lead_id || student.lead_source) && (
                    <div className="ml-7 mt-1 text-[11px] text-muted-foreground">
                      Lead: {formatLeadSource(student.lead_source)}
                    </div>
                  )}
                  {(student.course_name || student.course || student.batch_name || student.batch) && (
                    <div className="ml-7 mt-1 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/80">Enrolled:</span>{' '}
                      {student.course_name || student.course || '—'}
                      {student.batch_name || student.batch ? ` · ${student.batch_name || student.batch}` : ''}
                    </div>
                  )}
                  {student.source_lead_id && (
                    <Button type="button" variant="link" className="ml-7 h-auto p-0 text-xs" onClick={() => setDetailStudent(student)}>View lead details</Button>
                  )}
                </div>
                {(hasEditAll || hasDelete) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg shrink-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {hasEditAll && <DropdownMenuItem onClick={() => openEdit(student)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>}
                      {hasDelete && <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(student.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>}
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
            <TableHeader>
              <TableRow>
                {hasBulkDelete && <TableHead className="w-12"><Checkbox checked={allSelected ? true : someSelected ? 'indeterminate' : false} onCheckedChange={toggleSelectAll} /></TableHead>}
                <TableHead className="w-12">#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Lead source</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>College</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Enrolled</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={hasBulkDelete ? 12 : 11} className="text-center py-8 text-muted-foreground">No students found</TableCell></TableRow>
              ) : filtered.map((student, index) => (
                <TableRow key={student.id} className={selectedIds.has(student.id) ? 'bg-muted/50' : ''}>
                  {hasBulkDelete && <TableCell><Checkbox checked={selectedIds.has(student.id)} onCheckedChange={() => toggleSelect(student.id)} /></TableCell>}
                  <TableCell className="text-muted-foreground text-sm">{index + 1}</TableCell>
                  <TableCell className="font-medium">{student.name}</TableCell>
                  <TableCell>
                    <div className="text-sm">{student.email}</div>
                    <div className="text-xs text-muted-foreground">{student.phone}</div>
                  </TableCell>
                  <TableCell className="text-sm max-w-[140px]">
                    <div className="truncate" title={(student.organization_name || organization?.name) || ''}>
                      {student.organization_name || organization?.name || '—'}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm max-w-[120px]">
                    <div className="truncate" title={formatLeadSource(student.lead_source)}>{formatLeadSource(student.lead_source)}</div>
                  </TableCell>
                  <TableCell className="text-sm max-w-[140px]">
                    <div className="truncate" title={String(student.course_name || student.course || '')}>
                      {student.course_name || student.course || '—'}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm max-w-[140px]">
                    <div className="truncate" title={String(student.batch_name || student.batch || '')}>
                      {student.batch_name || student.batch || '—'}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{student.college || student.lead_college || '—'}</TableCell>
                  <TableCell><Badge variant="outline" className={statusColor(student.status) + ' capitalize text-xs'}>{student.status}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{student.enrollment_date ? new Date(student.enrollment_date).toLocaleDateString() : '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      {student.source_lead_id && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Lead details" onClick={() => setDetailStudent(student)}>
                          <Info className="h-4 w-4" />
                        </Button>
                      )}
                    {(hasEditAll || hasDelete) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {hasEditAll && <DropdownMenuItem onClick={() => openEdit(student)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>}
                          {hasDelete && <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(student.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Sheet open={!!detailStudent} onOpenChange={(open) => { if (!open) setDetailStudent(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Lead → student</SheetTitle>
            <SheetDescription>Details copied from the lead when status was set to Enroll.</SheetDescription>
          </SheetHeader>
          {detailStudent && (
            <div className="mt-6 space-y-4 text-sm">
              <div className="rounded-lg border border-border/60 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Student record</p>
                <p><span className="text-muted-foreground">Name:</span> {detailStudent.name}</p>
                <p><span className="text-muted-foreground">Email:</span> {detailStudent.email}</p>
                <p><span className="text-muted-foreground">Phone:</span> {detailStudent.phone || '—'}</p>
                <p><span className="text-muted-foreground">College:</span> {detailStudent.college || '—'}</p>
                <p><span className="text-muted-foreground">Year:</span> {detailStudent.year_of_study || '—'}</p>
                <p><span className="text-muted-foreground">Enrolled:</span> {detailStudent.enrollment_date ? new Date(detailStudent.enrollment_date).toLocaleDateString() : '—'}</p>
                <p><span className="text-muted-foreground">Course:</span> {detailStudent.course_name || detailStudent.course || '—'}</p>
                <p><span className="text-muted-foreground">Batch:</span> {detailStudent.batch_name || detailStudent.batch || '—'}</p>
              </div>
              <div className="rounded-lg border border-border/60 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Original lead</p>
                <p><span className="text-muted-foreground">Lead ID:</span> <span className="font-mono text-xs">{detailStudent.source_lead_id || '—'}</span></p>
                <p><span className="text-muted-foreground">Organization:</span> {detailStudent.organization_name || '—'}</p>
                <p><span className="text-muted-foreground">Lead name:</span> {detailStudent.lead_contact_name || '—'}</p>
                <p><span className="text-muted-foreground">Lead email:</span> {detailStudent.lead_email || '—'}</p>
                <p><span className="text-muted-foreground">Lead phone:</span> {detailStudent.lead_phone || '—'}</p>
                <p><span className="text-muted-foreground">Source:</span> {formatLeadSource(detailStudent.lead_source)}</p>
                <p><span className="text-muted-foreground">Lead college:</span> {detailStudent.lead_college || '—'}</p>
                <p><span className="text-muted-foreground">Company:</span> {detailStudent.lead_company || '—'}</p>
                <p><span className="text-muted-foreground">Referral code:</span> {detailStudent.lead_referred_by || '—'}</p>
                <p><span className="text-muted-foreground">Lead status (at link):</span> {detailStudent.lead_status ? String(detailStudent.lead_status).replace(/_/g, ' ') : '—'}</p>
                <p><span className="text-muted-foreground">Tags:</span> {parseLeadTags(detailStudent.lead_tags) || '—'}</p>
                <p className="pt-1"><span className="text-muted-foreground">Notes:</span></p>
                <p className="text-xs whitespace-pre-wrap rounded-md bg-muted/40 p-2">{detailStudent.lead_notes || '—'}</p>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditingStudent(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader><DialogTitle>Edit Student</DialogTitle></DialogHeader>
          {editingStudent && (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Name *</Label><Input name="name" required defaultValue={editingStudent.name} /></div>
                <div className="space-y-2"><Label>Email *</Label><Input name="email" type="email" required defaultValue={editingStudent.email} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Phone</Label><Input name="phone" defaultValue={editingStudent.phone} /></div>
                <div className="space-y-2"><Label>College</Label><Input name="college" defaultValue={editingStudent.college} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Year of Study</Label><Input name="year" defaultValue={editingStudent.year_of_study} /></div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select name="status" defaultValue={editingStudent.status}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STUDENT_STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <Button type="submit" className="w-full">Update Student</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
