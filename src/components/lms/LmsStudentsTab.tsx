import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { api } from "@/lib/api";
import { isSyncpediaOrganization } from "@/lib/orgFeatures";
import { normalizeAppRole } from "@/lib/roleUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, RefreshCw, Search } from "lucide-react";

type LmsStudent = {
  lms_id: string;
  name: string;
  email: string;
  phone: string;
  lms_course_id: string;
  lms_course_name: string;
  lms_batch_id: string;
  lms_batch_name: string;
};

type LmsCourse = { lms_id: string; name: string };
type LmsBatch = {
  lms_id: string;
  name: string;
  lms_course_id: string;
  lms_course_name: string;
};

export function canUseLmsStudentsTab(
  role: string | null | undefined,
  org: { slug?: string | null } | null,
): boolean {
  const r = normalizeAppRole(role);
  if (r === "super_admin") return true;
  if (!isSyncpediaOrganization(org)) return false;
  return r === "org" || r === "manager";
}

function errMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { message?: string; error?: string; hint?: string };
    const base = e.message || e.error || "Request failed";
    return e.hint ? `${base} — ${e.hint}` : base;
  }
  return "Request failed";
}

/** LMS students list + Add LMS Student (lmclasses.com; not CRM students). */
export function LmsStudentsTab() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [students, setStudents] = useState<LmsStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = (await api.lmsSync.lmsStudents()) as { data?: LmsStudent[] };
      setStudents(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      setStudents([]);
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) =>
      [s.name, s.email, s.phone, s.lms_course_name, s.lms_batch_name, s.lms_id]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [students, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Students on lmclasses.com — view and create here; not saved into CRM Students.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void loadStudents()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {!isMobile && " Refresh"}
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            {!isMobile && " Add LMS Student"}
          </Button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search name, email, course, batch…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error ? (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <p className="text-sm font-medium text-destructive">Could not load LMS students</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </Card>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading LMS students…
        </div>
      ) : filtered.length === 0 && !error ? (
        <p className="text-center py-12 text-muted-foreground text-sm">No LMS students found</p>
      ) : isMobile ? (
        <div className="space-y-3">
          {filtered.map((s) => (
            <Card key={s.lms_id} className="p-4 border-border/50 shadow-none">
              <p className="font-medium text-sm">{s.name || "—"}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.email || "—"}</p>
              <p className="text-xs text-muted-foreground">{s.phone || "—"}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {s.lms_course_name ? <Badge variant="secondary">{s.lms_course_name}</Badge> : null}
                {s.lms_batch_name ? <Badge variant="outline">{s.lms_batch_name}</Badge> : null}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>LMS Course</TableHead>
                <TableHead>LMS Batch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.lms_id}>
                  <TableCell className="font-medium">{s.name || "—"}</TableCell>
                  <TableCell>{s.email || "—"}</TableCell>
                  <TableCell>{s.phone || "—"}</TableCell>
                  <TableCell>{s.lms_course_name || "—"}</TableCell>
                  <TableCell>{s.lms_batch_name || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {!loading && !error ? (
        <p className="text-xs text-muted-foreground">
          {filtered.length} of {students.length} LMS students
        </p>
      ) : null}

      <AddLmsStudentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => {
          toast({ title: "LMS student added" });
          void loadStudents();
        }}
      />
    </div>
  );
}

function AddLmsStudentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [courses, setCourses] = useState<LmsCourse[]>([]);
  const [batches, setBatches] = useState<LmsBatch[]>([]);
  const [courseId, setCourseId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setEmail("");
    setPhone("");
    setCourseId("");
    setBatchId("");
    setMetaError(null);
    setLoadingMeta(true);
    void (async () => {
      const errors: string[] = [];
      try {
        const cRes = (await api.lmsSync.lmsCourses()) as { data?: LmsCourse[] };
        setCourses(Array.isArray(cRes?.data) ? cRes.data : []);
      } catch (err) {
        setCourses([]);
        errors.push(errMessage(err));
      }
      try {
        const bRes = (await api.lmsSync.lmsBatches()) as { data?: LmsBatch[] };
        setBatches(Array.isArray(bRes?.data) ? bRes.data : []);
      } catch (err) {
        setBatches([]);
        errors.push(errMessage(err));
      }
      setMetaError(errors.length ? errors.join(" ") : null);
      setLoadingMeta(false);
    })();
  }, [open]);

  const batchesForCourse = useMemo(() => {
    if (!courseId) return [];
    return batches.filter((b) => b.lms_course_id === courseId);
  }, [batches, courseId]);

  useEffect(() => {
    if (batchId && !batchesForCourse.some((b) => b.lms_id === batchId)) {
      setBatchId("");
    }
  }, [batchesForCourse, batchId]);

  const submit = async () => {
    if (!name.trim() || !email.trim() || !phone.trim()) {
      toast({ title: "Name, email, and phone are required", variant: "destructive" });
      return;
    }
    if (!courseId || !batchId) {
      toast({ title: "Select an LMS course and LMS batch", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await api.lmsSync.addLmsStudent({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        lms_course_id: courseId,
        lms_batch_id: batchId,
      });
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      toast({
        title: "Could not add LMS student",
        description: errMessage(err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add LMS Student</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Creates the student on lmclasses.com. Pick LMS course and LMS batch (not CRM).
          </p>
          {metaError ? (
            <Card className="p-3 border-destructive/40 bg-destructive/5">
              <p className="text-xs text-destructive">{metaError}</p>
            </Card>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="lms-stu-name">Full name</Label>
            <Input id="lms-stu-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lms-stu-email">Email</Label>
            <Input
              id="lms-stu-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lms-stu-phone">Phone</Label>
            <Input id="lms-stu-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>LMS course</Label>
            <Select
              value={courseId || undefined}
              onValueChange={(v) => {
                setCourseId(v);
                setBatchId("");
              }}
              disabled={loadingMeta || courses.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingMeta ? "Loading LMS courses…" : "Select LMS course"} />
              </SelectTrigger>
              <SelectContent>
                {courses
                  .filter((c) => String(c.lms_id || "").trim() !== "")
                  .map((c) => (
                    <SelectItem key={c.lms_id} value={c.lms_id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>LMS batch</Label>
            <Select
              value={batchId || undefined}
              onValueChange={setBatchId}
              disabled={!courseId || loadingMeta || batchesForCourse.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !courseId
                      ? "Select a course first"
                      : batchesForCourse.length === 0
                        ? "No LMS batches for this course"
                        : "Select LMS batch"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {batchesForCourse
                  .filter((b) => String(b.lms_id || "").trim() !== "")
                  .map((b) => (
                    <SelectItem key={b.lms_id} value={b.lms_id}>
                      {b.name}
                      {b.lms_course_name ? ` · ${b.lms_course_name}` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting || loadingMeta}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Add to LMS
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
