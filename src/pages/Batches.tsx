import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import * as perms from '@/lib/permissions';
import { Plus, Download, MoreHorizontal, Pencil, Trash2, Loader2 } from 'lucide-react';
import {
  batchScheduleStatus,
  batchStatusLabel,
  BATCH_READ_ONLY_ROLES,
  isOpenBatchSchedule,
} from '@/utils/batchSchedule';

const CAN_CREATE_ROLES = ['super_admin', 'admin', 'manager'];
const CAN_EDIT_ALL_ROLES = ['super_admin', 'admin', 'manager'];
const CAN_DELETE_ROLES = ['super_admin', 'admin'];

const NO_COURSES_MSG =
  'No courses yet. Create a course on the Courses page before creating a batch.';

function validCourseOptions(courses: { id?: string; name?: string }[]) {
  return courses.filter((c): c is { id: string; name?: string } => Boolean(c?.id));
}

function CoursePicker({
  value,
  onChange,
  courses,
}: {
  value: string;
  onChange: (id: string) => void;
  courses: { id?: string; name?: string }[];
}) {
  const options = validCourseOptions(courses);

  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground rounded-md border border-dashed px-3 py-2">
        {NO_COURSES_MSG}
      </p>
    );
  }

  const selected =
    value && options.some((c) => c.id === value) ? value : options[0].id;

  return (
    <>
      <Select value={selected} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select course" />
        </SelectTrigger>
        <SelectContent>
          {options.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name || 'Untitled course'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input type="hidden" name="course_id" value={selected} />
    </>
  );
}

export default function Batches() {
  const { toast } = useToast();
  const { role } = useAuth();
  const isMobile = useIsMobile();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<any>(null);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<any[]>([]);
  const [createCourseId, setCreateCourseId] = useState<string>('');
  const [editCourseId, setEditCourseId] = useState<string>('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');

  const currentRole = role || '';
  const canCreate = CAN_CREATE_ROLES.includes(currentRole);
  const canEditAll = CAN_EDIT_ALL_ROLES.includes(currentRole);
  const canDelete = CAN_DELETE_ROLES.includes(currentRole);
  const hasExport = perms.canExport(role);
  const isReadOnlyViewer = (BATCH_READ_ONLY_ROLES as readonly string[]).includes(currentRole);

  useEffect(() => {
    fetchBatches();
    if (canCreate || canEditAll) fetchCourses();
  }, [canCreate, canEditAll]);

  const fetchBatches = async () => {
    setLoading(true);
    try {
      const data = await api.batches.list();
      const list = Array.isArray(data) ? data : data.data || data.batches || [];
      setBatches(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCourses = async () => {
    try {
      const data = await api.courses.list();
      const list = Array.isArray(data) ? data : data.data || data.courses || [];
      setCourses(list);
      const firstId = validCourseOptions(list)[0]?.id;
      if (firstId) setCreateCourseId(firstId);
    } catch (err) {
      console.error(err);
    }
  };

  const displayStatus = (batch: { start_date?: string; end_date?: string }) =>
    batchScheduleStatus(batch.start_date, batch.end_date);

  const statusColor = (status: string) => {
    if (status === 'active') return 'bg-emerald-500/10 text-emerald-700 border-emerald-200';
    if (status === 'completed') return 'bg-blue-500/10 text-blue-700 border-blue-200';
    return 'bg-amber-500/10 text-amber-700 border-amber-200';
  };

  const visibleBatches = useMemo(() => {
    if (!isReadOnlyViewer) return batches;
    return batches.filter((b) => isOpenBatchSchedule(b.start_date, b.end_date));
  }, [batches, isReadOnlyViewer]);

  const activeCount = useMemo(
    () => visibleBatches.filter((b) => displayStatus(b) === 'active').length,
    [visibleBatches],
  );

  const editPreviewStatus = useMemo(
    () => batchScheduleStatus(editStart || null, editEnd || null),
    [editStart, editEnd],
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validCourseOptions(courses).length === 0) {
      toast({ variant: 'destructive', title: 'Create a course before adding a batch' });
      return;
    }
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    try {
      await api.batches.create({
        name: fd.get('name'),
        course_id: fd.get('course_id') || null,
        start_date: fd.get('start'),
        end_date: fd.get('end'),
        seat_limit: Number(fd.get('seats') || 30),
      });
      toast({ title: 'Batch created' });
      setDialogOpen(false);
      fetchBatches();
    } catch (err: any) {
      toast({ variant: 'destructive', title: err.message });
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBatch) return;
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    try {
      await api.batches.update(editingBatch.id, {
        name: fd.get('name'),
        course_id: fd.get('course_id') || null,
        start_date: fd.get('start'),
        end_date: fd.get('end'),
        seat_limit: Number(fd.get('seats') || 30),
      });
      toast({ title: 'Batch updated' });
      setEditDialogOpen(false);
      setEditingBatch(null);
      fetchBatches();
    } catch (err: any) {
      toast({ variant: 'destructive', title: err.message });
    }
  };

  const handleDelete = async (id: string) => {
    if (!canDelete) {
      toast({ variant: 'destructive', title: 'Permission denied' });
      return;
    }
    if (confirm('Delete this batch?')) {
      try {
        await api.batches.delete(id);
        toast({ title: 'Batch deleted' });
        fetchBatches();
      } catch (err: any) {
        toast({ variant: 'destructive', title: err.message });
      }
    }
  };

  const openEdit = (batch: any) => {
    if (!canEditAll) {
      toast({ variant: 'destructive', title: 'Permission denied' });
      return;
    }
    setEditingBatch(batch);
    setEditCourseId(batch.course_id || '');
    setEditStart(batch.start_date ? String(batch.start_date).slice(0, 10) : '');
    setEditEnd(batch.end_date ? String(batch.end_date).slice(0, 10) : '');
    setEditDialogOpen(true);
  };

  const handleExport = () => {
    const headers = ['S.No', 'Name', 'Course', 'Start Date', 'End Date', 'Seat Limit', 'Enrolled', 'Status'];
    const rows = visibleBatches.map((b, i) => [
      i + 1,
      b.name,
      b.course || '—',
      b.start_date,
      b.end_date,
      b.seat_limit,
      b.enrolled || 0,
      displayStatus(b),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'batches.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Batches exported' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Batches</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {visibleBatches.length} batches • {activeCount} active
            {isReadOnlyViewer ? ' • upcoming & active only' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasExport && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport}>
              <Download className="h-4 w-4" />
              {!isMobile && ' Export'}
            </Button>
          )}
          {canCreate && (
            <Dialog
              open={dialogOpen}
              onOpenChange={(open) => {
                setDialogOpen(open);
                if (open) {
                  const firstId = validCourseOptions(courses)[0]?.id;
                  if (firstId) setCreateCourseId(firstId);
                }
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  {!isMobile && ' Create Batch'}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-[95vw] sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create New Batch</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Batch Name *</Label>
                    <Input name="name" required placeholder="Full Stack April 2026" />
                  </div>
                  <div className="space-y-2">
                    <Label>Course *</Label>
                    <CoursePicker
                      value={createCourseId}
                      onChange={setCreateCourseId}
                      courses={courses}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Start Date</Label>
                      <Input name="start" type="date" />
                    </div>
                    <div className="space-y-2">
                      <Label>End Date</Label>
                      <Input name="end" type="date" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Seat Limit</Label>
                    <Input name="seats" type="number" min={1} defaultValue={30} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Status updates automatically: Upcoming (before start), Active (during), Completed (after end).
                  </p>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={validCourseOptions(courses).length === 0}
                  >
                    Create Batch
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {canEditAll && (
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Batch</DialogTitle>
          </DialogHeader>
          {editingBatch && (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="space-y-2">
                <Label>Batch Name *</Label>
                <Input name="name" required defaultValue={editingBatch.name} />
              </div>
              <div className="space-y-2">
                <Label>Course *</Label>
                <CoursePicker
                  value={editCourseId}
                  onChange={setEditCourseId}
                  courses={courses}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input
                    name="start"
                    type="date"
                    value={editStart}
                    onChange={(e) => setEditStart(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input
                    name="end"
                    type="date"
                    value={editEnd}
                    onChange={(e) => setEditEnd(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Seat Limit</Label>
                <Input name="seats" type="number" min={1} defaultValue={editingBatch.seat_limit} />
              </div>
              <div className="flex items-center gap-2 pb-1">
                <span className="text-sm text-muted-foreground">Status (automatic)</span>
                <Badge variant="outline" className={statusColor(editPreviewStatus) + ' text-xs'}>
                  {batchStatusLabel(editPreviewStatus)}
                </Badge>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={validCourseOptions(courses).length === 0}
              >
                Update Batch
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      )}

      {isMobile ? (
        <div className="space-y-3">
          {visibleBatches.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No batches found</p>
          ) : (
            visibleBatches.map((batch) => {
              const status = displayStatus(batch);
              return (
                <Card key={batch.id} className="p-4 border-border/50 shadow-none">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{batch.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {batch.course_name || batch.course || '—'}
                      </p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="outline" className={statusColor(status) + ' text-xs'}>
                          {batchStatusLabel(status)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {batch.enrolled || 0}/{batch.seat_limit} enrolled
                        </span>
                      </div>
                      {batch.start_date && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(batch.start_date).toLocaleDateString()}
                          {batch.end_date ? ` → ${new Date(batch.end_date).toLocaleDateString()}` : ''}
                        </p>
                      )}
                    </div>
                    {(canEditAll || canDelete) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canEditAll && (
                            <DropdownMenuItem onClick={() => openEdit(batch)}>
                              <Pencil className="h-4 w-4 mr-2" /> Edit
                            </DropdownMenuItem>
                          )}
                          {canDelete && (
                            <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(batch.id)}>
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </Card>
              );
            })
          )}
        </div>
      ) : (
        <Card className="border-border/50 shadow-none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Batch Name</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Enrollment</TableHead>
                <TableHead>Status</TableHead>
                {(canEditAll || canDelete) && <TableHead className="w-16">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleBatches.map((batch, index) => {
                const status = displayStatus(batch);
                return (
                  <TableRow key={batch.id}>
                    <TableCell className="text-muted-foreground text-sm">{index + 1}</TableCell>
                    <TableCell className="font-medium">{batch.name}</TableCell>
                    <TableCell className="text-sm">{batch.course_name || batch.course || '—'}</TableCell>
                    <TableCell className="text-sm">
                      {batch.start_date ? new Date(batch.start_date).toLocaleDateString() : '—'}
                      {batch.end_date ? ` → ${new Date(batch.end_date).toLocaleDateString()}` : ''}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{
                              width: `${((batch.enrolled || 0) / (batch.seat_limit || 1)) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {batch.enrolled || 0}/{batch.seat_limit}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColor(status) + ' text-xs'}>
                        {batchStatusLabel(status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(canEditAll || canDelete) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canEditAll && (
                              <DropdownMenuItem onClick={() => openEdit(batch)}>
                                <Pencil className="h-4 w-4 mr-2" /> Edit
                              </DropdownMenuItem>
                            )}
                            {canDelete && (
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDelete(batch.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
