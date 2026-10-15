import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { isSyncpediaOrganization } from "@/lib/orgFeatures";
import { normalizeAppRole } from "@/lib/roleUtils";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
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
import { ExternalLink, Loader2, Pencil, Plus, RefreshCw, Search, Video } from "lucide-react";

type LmsLiveClass = {
  lms_id: string;
  title: string;
  lms_course_id: string;
  lms_course_name: string;
  lms_batch_id: string;
  mentor_id: string;
  scheduled_at: string | null;
  status: string;
  meeting_link: string;
  duration_minutes: number;
};

type LmsCourse = { lms_id: string; name: string };
type LmsBatch = { lms_id: string; name: string; lms_course_id: string; lms_course_name: string };

const STATUS_OPTIONS = ["scheduled", "live", "completed", "cancelled", "upcoming"];

function canUseLiveClasses(
  role: string | null | undefined,
  org: { slug?: string | null } | null,
): boolean {
  const r = normalizeAppRole(role);
  if (r === "super_admin") return true;
  if (!isSyncpediaOrganization(org)) return false;
  // Must match php-backend/api/lms-sync.php lmsRequireAccess roles.
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

/** Convert ISO / LMS datetime to datetime-local value. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local → ISO string for LMS. */
function fromLocalInput(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return local;
  return d.toISOString();
}

function formatSchedule(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type FormState = {
  title: string;
  lms_course_id: string;
  lms_batch_id: string;
  mentor_id: string;
  scheduled_local: string;
  duration_minutes: string;
  status: string;
  meeting_link: string;
};

const emptyForm = (): FormState => ({
  title: "",
  lms_course_id: "",
  lms_batch_id: "",
  mentor_id: "",
  scheduled_local: "",
  duration_minutes: "60",
  status: "scheduled",
  meeting_link: "",
});

export default function LiveClasses() {
  const { role, organization } = useAuth();
  const allowed = canUseLiveClasses(role, organization);
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const [rows, setRows] = useState<LmsLiveClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [courses, setCourses] = useState<LmsCourse[]>([]);
  const [batches, setBatches] = useState<LmsBatch[]>([]);
  const [metaLoading, setMetaLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LmsLiveClass | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = (await api.lmsSync.lmsLiveClasses()) as { data?: LmsLiveClass[] };
      setRows(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      setRows([]);
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMeta = useCallback(async () => {
    setMetaLoading(true);
    try {
      const [cRes, bRes] = await Promise.all([
        api.lmsSync.lmsCourses() as Promise<{ data?: LmsCourse[] }>,
        api.lmsSync.lmsBatches() as Promise<{ data?: LmsBatch[] }>,
      ]);
      setCourses(Array.isArray(cRes?.data) ? cRes.data : []);
      setBatches(Array.isArray(bRes?.data) ? bRes.data : []);
    } catch {
      setCourses([]);
      setBatches([]);
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.title, r.lms_course_name, r.status, r.meeting_link, r.mentor_id, r.scheduled_at]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  const batchesForCourse = useMemo(() => {
    if (!form.lms_course_id) return batches;
    return batches.filter((b) => b.lms_course_id === form.lms_course_id);
  }, [batches, form.lms_course_id]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
    void loadMeta();
  };

  const openEdit = (row: LmsLiveClass) => {
    setEditing(row);
    setForm({
      title: row.title,
      lms_course_id: row.lms_course_id,
      lms_batch_id: row.lms_batch_id || "",
      mentor_id: row.mentor_id,
      scheduled_local: toLocalInput(row.scheduled_at),
      duration_minutes: String(row.duration_minutes || 60),
      status: row.status || "scheduled",
      meeting_link: row.meeting_link || "",
    });
    setDialogOpen(true);
    void loadMeta();
  };

  const submit = async () => {
    if (!form.title.trim() || !form.lms_course_id || !form.mentor_id.trim() || !form.scheduled_local) {
      toast({
        title: "Missing fields",
        description: "Title, course, mentor id, and schedule are required.",
        variant: "destructive",
      });
      return;
    }
    const duration = Number(form.duration_minutes);
    const payload = {
      title: form.title.trim(),
      lms_course_id: form.lms_course_id,
      mentor_id: form.mentor_id.trim(),
      scheduled_at: fromLocalInput(form.scheduled_local),
      lms_batch_id: form.lms_batch_id || undefined,
      meeting_link: form.meeting_link.trim() || undefined,
      duration_minutes: Number.isFinite(duration) && duration > 0 ? duration : undefined,
      status: form.status || undefined,
    };
    setSubmitting(true);
    try {
      if (editing) {
        await api.lmsSync.updateLmsLiveClass({ lms_id: editing.lms_id, ...payload });
        toast({ title: "Live class updated" });
      } else {
        await api.lmsSync.createLmsLiveClass(payload);
        toast({ title: "Live class created" });
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      toast({
        title: editing ? "Update failed" : "Create failed",
        description: errMessage(err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!allowed) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold tracking-tight mb-2">Live Classes</h1>
        <p className="text-sm text-muted-foreground">
          Live Classes from LMS are only available for the Syncpedia organization.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Live Classes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            LMS Classes schedule ({rows.length} classes)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {!isMobile && " Refresh"}
          </Button>
          <Button size="sm" className="gap-1.5" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {!isMobile && " Create"}
          </Button>
        </div>
      </div>

      <div className="relative max-w-md mb-4">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search title, course, status…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error ? (
        <Card className="p-4 border-destructive/40 bg-destructive/5 mb-4">
          <p className="text-sm font-medium text-destructive">Could not load live classes</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </Card>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading live classes…
        </div>
      ) : filtered.length === 0 && !error ? (
        <p className="text-center py-12 text-muted-foreground text-sm">No live classes found</p>
      ) : isMobile ? (
        <div className="space-y-3">
          {filtered.map((r) => (
            <Card key={r.lms_id} className="p-4 border-border/50 shadow-none">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Video className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <p className="font-medium text-sm truncate">{r.title}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => openEdit(r)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{r.lms_course_name || "—"}</p>
              <div className="flex flex-wrap gap-2 items-center text-xs">
                <span>{formatSchedule(r.scheduled_at)}</span>
                <span className="text-muted-foreground">{r.duration_minutes || "—"} min</span>
                {r.status ? <Badge variant="secondary">{r.status}</Badge> : null}
                {r.meeting_link ? (
                  <a
                    href={r.meeting_link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary"
                  >
                    Join <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Meeting</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.lms_id}>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell className="text-muted-foreground">{r.lms_course_name || "—"}</TableCell>
                  <TableCell>{formatSchedule(r.scheduled_at)}</TableCell>
                  <TableCell>{r.duration_minutes ? `${r.duration_minutes} min` : "—"}</TableCell>
                  <TableCell>
                    {r.status ? <Badge variant="secondary">{r.status}</Badge> : "—"}
                  </TableCell>
                  <TableCell>
                    {r.meeting_link ? (
                      <a
                        href={r.meeting_link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        Link <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit live class" : "Create live class"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Changes are saved on lmclasses.com (not stored in CRM).
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="lc-title">Title *</Label>
              <Input
                id="lc-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>LMS course *</Label>
              <Select
                value={form.lms_course_id || undefined}
                onValueChange={(v) => setForm((f) => ({ ...f, lms_course_id: v, lms_batch_id: "" }))}
                disabled={metaLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={metaLoading ? "Loading courses…" : "Select course"} />
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
              <Label>LMS batch (optional)</Label>
              <Select
                value={form.lms_batch_id || "__none__"}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, lms_batch_id: v === "__none__" ? "" : v }))
                }
                disabled={metaLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No batch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No batch</SelectItem>
                  {batchesForCourse
                    .filter((b) => String(b.lms_id || "").trim() !== "")
                    .map((b) => (
                      <SelectItem key={b.lms_id} value={b.lms_id}>
                        {b.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lc-mentor">Mentor ID *</Label>
              <Input
                id="lc-mentor"
                placeholder="UUID from LMS"
                value={form.mentor_id}
                onChange={(e) => setForm((f) => ({ ...f, mentor_id: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lc-when">Scheduled at *</Label>
              <Input
                id="lc-when"
                type="datetime-local"
                value={form.scheduled_local}
                onChange={(e) => setForm((f) => ({ ...f, scheduled_local: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="lc-dur">Duration (min)</Label>
                <Input
                  id="lc-dur"
                  type="number"
                  min={1}
                  value={form.duration_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={form.status || "scheduled"}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                    {form.status && !STATUS_OPTIONS.includes(form.status) ? (
                      <SelectItem value={form.status}>{form.status}</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lc-link">Meeting link</Label>
              <Input
                id="lc-link"
                type="url"
                placeholder="https://meet.google.com/…"
                value={form.meeting_link}
                onChange={(e) => setForm((f) => ({ ...f, meeting_link: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={submitting || metaLoading}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
