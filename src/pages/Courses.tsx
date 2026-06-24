import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { Plus, BookOpen, Download, Upload, MoreHorizontal, Pencil, Trash2, Eye, EyeOff, Loader2 } from 'lucide-react';

type Course = {
  id: string; name: string; description: string; price: number;
  duration_weeks: number | null; is_active: boolean; modules: string[]; created_at: string;
};

const CAN_CREATE_ROLES = ['super_admin', 'admin', 'manager'];
const CAN_EDIT_ROLES = ['super_admin', 'admin', 'manager'];
const CAN_DELETE_ROLES = ['super_admin', 'admin'];
const CAN_TOGGLE_ROLES = ['super_admin', 'admin', 'manager'];

export default function Courses() {
  const { toast } = useToast();
  const { role } = useAuth();
  const isMobile = useIsMobile();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentRole = role || '';
  const canCreate = CAN_CREATE_ROLES.includes(currentRole);
  const canEdit = CAN_EDIT_ROLES.includes(currentRole);
  const canDelete = CAN_DELETE_ROLES.includes(currentRole);
  const canToggle = CAN_TOGGLE_ROLES.includes(currentRole);

  useEffect(() => { fetchCourses(); }, []);

  const fetchCourses = async () => {
    setLoading(true);
    try {
      const data = await api.courses.list();
      const list = Array.isArray(data) ? data : data.data || data.courses || [];
      setCourses(list.map((c: any) => ({ ...c, modules: Array.isArray(c.modules) ? c.modules : typeof c.modules === 'string' ? JSON.parse(c.modules || '[]') : [] })));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleCreate = async (data: Partial<Course>) => {
    try {
      await api.courses.create(data);
      toast({ title: 'Course created' });
      setDialogOpen(false);
      fetchCourses();
    } catch (err: any) { toast({ variant: 'destructive', title: err.message }); }
  };

  const handleEdit = async (data: Partial<Course>) => {
    if (!editingCourse) return;
    try {
      await api.courses.update(editingCourse.id, data);
      toast({ title: 'Course updated' });
      setEditDialogOpen(false);
      setEditingCourse(null);
      fetchCourses();
    } catch (err: any) { toast({ variant: 'destructive', title: err.message }); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this course?')) return;
    try {
      await api.courses.delete(id);
      toast({ title: 'Course deleted' });
      fetchCourses();
    } catch (err: any) { toast({ variant: 'destructive', title: err.message }); }
  };

  const handleToggleActive = async (id: string) => {
    const course = courses.find(c => c.id === id);
    if (!course) return;
    try {
      await api.courses.update(id, { is_active: !course.is_active });
      toast({ title: 'Course status updated' });
      fetchCourses();
    } catch (err: any) { toast({ variant: 'destructive', title: err.message }); }
  };

  const openEdit = (course: Course) => { setEditingCourse(course); setEditDialogOpen(true); };

  const handleExport = () => {
    const headers = ['S.No', 'Name', 'Description', 'Price', 'Duration (weeks)', 'Status', 'Modules'];
    const rows = courses.map((c, i) => [i + 1, c.name, c.description, c.price, c.duration_weeks ?? '', c.is_active ? 'Active' : 'Inactive', c.modules.join('; ')]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'courses.csv'; a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Courses exported' });
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Courses</h1>
          <p className="text-sm text-muted-foreground mt-1">{courses.length} courses available</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport}><Download className="h-4 w-4" />{!isMobile && ' Export'}</Button>
          {canCreate && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild><Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" />{!isMobile && ' Add Course'}</Button></DialogTrigger>
              <DialogContent className="max-w-[95vw] sm:max-w-lg"><DialogHeader><DialogTitle>Add New Course</DialogTitle></DialogHeader><CourseForm onSubmit={handleCreate} /></DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {isMobile ? (
        <div className="space-y-3">
          {courses.length === 0 ? <p className="text-center py-8 text-muted-foreground">No courses found</p> : courses.map((course, i) => (
            <Card key={course.id} className={`p-4 border-border/50 shadow-none ${!course.is_active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><BookOpen className="h-3.5 w-3.5 text-primary" /></div>
                    <p className="font-medium text-sm truncate">{course.name}</p>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{course.description || '—'}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">₹{Number(course.price).toLocaleString('en-IN')}</span>
                    {course.duration_weeks && <span className="text-xs text-muted-foreground">{course.duration_weeks} weeks</span>}
                    <Badge variant={course.is_active ? 'default' : 'secondary'} className="text-xs">{course.is_active ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  {course.modules?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {course.modules.slice(0, 3).map((m, j) => <Badge key={j} variant="secondary" className="text-xs font-normal">{m}</Badge>)}
                      {course.modules.length > 3 && <Badge variant="outline" className="text-xs font-normal">+{course.modules.length - 3}</Badge>}
                    </div>
                  )}
                </div>
                {(canEdit || canDelete) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canEdit && <DropdownMenuItem onClick={() => openEdit(course)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>}
                      {canToggle && <DropdownMenuItem onClick={() => handleToggleActive(course.id)}>{course.is_active ? <><EyeOff className="h-4 w-4 mr-2" /> Deactivate</> : <><Eye className="h-4 w-4 mr-2" /> Activate</>}</DropdownMenuItem>}
                      {canDelete && <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(course.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-border/50 shadow-none overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">S.No</TableHead><TableHead>Course Name</TableHead>
                <TableHead className="hidden md:table-cell">Description</TableHead><TableHead>Price</TableHead>
                <TableHead className="hidden sm:table-cell">Duration</TableHead><TableHead>Modules</TableHead>
                <TableHead>Status</TableHead>{(canEdit || canDelete) && <TableHead className="w-12">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.length === 0 ? (
                <TableRow><TableCell colSpan={canEdit || canDelete ? 8 : 7} className="text-center py-8 text-muted-foreground">No courses found</TableCell></TableRow>
              ) : courses.map((course, index) => (
                <TableRow key={course.id} className={!course.is_active ? 'opacity-60' : ''}>
                  <TableCell className="text-muted-foreground text-sm font-medium">{index + 1}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2"><div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><BookOpen className="h-4 w-4 text-primary" /></div><span className="font-medium text-sm">{course.name}</span></div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell"><p className="text-sm text-muted-foreground truncate max-w-xs">{course.description || '—'}</p></TableCell>
                  <TableCell className="font-semibold text-sm">₹{Number(course.price).toLocaleString('en-IN')}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{course.duration_weeks ? `${course.duration_weeks} weeks` : '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                      {course.modules?.slice(0, 3).map((m, i) => <Badge key={i} variant="secondary" className="text-xs font-normal">{m}</Badge>)}
                      {course.modules && course.modules.length > 3 && <Badge variant="outline" className="text-xs font-normal">+{course.modules.length - 3}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={course.is_active ? 'default' : 'secondary'} className="text-xs">{course.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                  {(canEdit || canDelete) && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canEdit && <DropdownMenuItem onClick={() => openEdit(course)}><Pencil className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>}
                          {canToggle && <DropdownMenuItem onClick={() => handleToggleActive(course.id)}>{course.is_active ? <><EyeOff className="h-4 w-4 mr-2" /> Deactivate</> : <><Eye className="h-4 w-4 mr-2" /> Activate</>}</DropdownMenuItem>}
                          {canDelete && <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(course.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditingCourse(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg"><DialogHeader><DialogTitle>Edit Course</DialogTitle></DialogHeader>
          {editingCourse && <CourseForm initialData={editingCourse} onSubmit={handleEdit} isEdit />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CourseForm({ onSubmit, initialData, isEdit }: { onSubmit: (data: Partial<Course>) => void; initialData?: Course; isEdit?: boolean }) {
  const [form, setForm] = useState({
    name: initialData?.name || '', description: initialData?.description || '',
    price: initialData?.price || 0, duration_weeks: initialData?.duration_weeks || '',
    modules: initialData?.modules?.join(', ') || '',
  });
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name: form.name, description: form.description, price: Number(form.price), duration_weeks: form.duration_weeks ? Number(form.duration_weeks) : null, modules: form.modules.split(',').map(m => m.trim()).filter(Boolean) });
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2"><Label>Course Name *</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
      <div className="space-y-2"><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2"><Label>Price (₹) *</Label><Input type="number" required min={0} value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })} /></div>
        <div className="space-y-2"><Label>Duration (weeks)</Label><Input type="number" min={1} value={form.duration_weeks} onChange={e => setForm({ ...form, duration_weeks: e.target.value })} /></div>
      </div>
      <div className="space-y-2"><Label>Modules (comma separated)</Label><Input value={form.modules} onChange={e => setForm({ ...form, modules: e.target.value })} placeholder="HTML, CSS, JavaScript, React" /></div>
      <Button type="submit" className="w-full">{isEdit ? 'Update Course' : 'Create Course'}</Button>
    </form>
  );
}
