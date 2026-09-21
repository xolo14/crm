import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  Eye,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import syncpediaMark from "@/assets/syncpedia-mark.png";
import { ProtectedUploadImage } from "@/components/ProtectedUploadImage";
import { resolveUploadSrc } from "@/lib/resumeHref";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  eachDayInRange,
  defaultMonthAnchor,
  defaultWeekAnchor,
  formatDayLabel,
  formatPeriodLabel,
  formatTime12,
  mergePeriodOption,
  monthPeriodOptions,
  monthPeriodStart,
  periodBounds,
  toYmd,
  weekPeriodOptions,
  weekPeriodStart,
  type PeriodType,
} from "@/utils/timetableCalendar";

type TimetableSession = {
  id?: string;
  session_date: string;
  course_id?: string | null;
  course_name: string;
  start_time: string;
  end_time: string;
};

type TimetableRow = {
  id: string;
  title: string;
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  batch_id?: string | null;
  course_id?: string | null;
  batch_name?: string | null;
  course_name?: string | null;
  session_count?: number;
  send_count?: number;
  sessions?: TimetableSession[];
};

type BatchRow = { id: string; name?: string; course_id?: string; course_name?: string };
type TimetableRecipient = {
  email: string;
  name?: string;
  source: "batch" | "manual";
};

const EMPTY_SESSION = (): TimetableSession => ({
  session_date: "",
  course_name: "",
  start_time: "09:00",
  end_time: "11:00",
});

export default function Timetables() {
  const { toast } = useToast();
  const { organization } = useAuth();
  const [tab, setTab] = useState("create");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<TimetableRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("Offline Class Timetable");
  const [periodType, setPeriodType] = useState<PeriodType>("week");
  const [anchorDate, setAnchorDate] = useState(defaultWeekAnchor);
  const [batchId, setBatchId] = useState<string>("");
  const [courseId, setCourseId] = useState<string>("");
  const [sessions, setSessions] = useState<TimetableSession[]>([]);

  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionDraft, setSessionDraft] = useState<TimetableSession>(EMPTY_SESSION());
  const [sessionEditIndex, setSessionEditIndex] = useState<number | null>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sendRow, setSendRow] = useState<TimetableRow | null>(null);
  const [sendBatchId, setSendBatchId] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [recipients, setRecipients] = useState<TimetableRecipient[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const period = useMemo(() => periodBounds(periodType, anchorDate), [periodType, anchorDate]);
  const calendarDays = useMemo(
    () => eachDayInRange(period.start, period.end),
    [period.start, period.end],
  );
  const periodOptions = useMemo(() => {
    const base = periodType === "month" ? monthPeriodOptions(12) : weekPeriodOptions(12);
    return mergePeriodOption(base, period.start, periodType);
  }, [periodType, period.start]);

  const courseNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of courses) m.set(c.id, c.name || "Course");
    for (const b of batches) {
      if (b.course_id && b.course_name) m.set(b.course_id, b.course_name);
    }
    return m;
  }, [courses, batches]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ttRes, bRes, cRes] = await Promise.all([
        api.timetables.list(),
        api.batches.list(),
        api.courses.list(),
      ]);
      setRows(((ttRes as { data?: TimetableRow[] })?.data || []) as TimetableRow[]);
      const bl = (bRes as { data?: BatchRow[] })?.data || bRes;
      setBatches(Array.isArray(bl) ? bl : []);
      const cl = (cRes as { data?: CourseRow[] })?.data || cRes;
      setCourses(Array.isArray(cl) ? cl : []);
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Failed to load timetables",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!batchId) return;
    const b = batches.find((x) => x.id === batchId);
    if (b?.course_id) setCourseId(b.course_id);
  }, [batchId, batches]);

  const resetBuilder = () => {
    setEditingId(null);
    setTitle("Offline Class Timetable");
    setPeriodType("week");
    setAnchorDate(defaultWeekAnchor());
    setBatchId("");
    setCourseId("");
    setSessions([]);
  };

  const loadForEdit = async (row: TimetableRow) => {
    try {
      const res = (await api.timetables.get(row.id)) as { data?: TimetableRow };
      const data = res?.data || row;
      setEditingId(data.id);
      setTitle(data.title || "Class Timetable");
      const pType = data.period_type === "month" ? "month" : "week";
      setPeriodType(pType);
      const rawStart = String(data.period_start || (pType === "month" ? defaultMonthAnchor() : defaultWeekAnchor())).slice(0, 10);
      setAnchorDate(pType === "month" ? monthPeriodStart(rawStart) : weekPeriodStart(rawStart));
      setBatchId(data.batch_id || "");
      setCourseId(data.course_id || "");
      setSessions(
        (data.sessions || []).map((s) => ({
          session_date: String(s.session_date).slice(0, 10),
          course_id: s.course_id,
          course_name: s.course_name || "",
          start_time: String(s.start_time).slice(0, 5),
          end_time: String(s.end_time).slice(0, 5),
        })),
      );
      setTab("create");
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Could not load timetable",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    }
  };

  const openAddSession = (dateYmd: string) => {
    const cName = courseId ? courseNameById.get(courseId) || "" : "";
    setSessionDraft({
      ...EMPTY_SESSION(),
      session_date: dateYmd,
      course_id: courseId || undefined,
      course_name: cName,
    });
    setSessionEditIndex(null);
    setSessionDialogOpen(true);
  };

  const openEditSession = (index: number) => {
    setSessionDraft({ ...sessions[index] });
    setSessionEditIndex(index);
    setSessionDialogOpen(true);
  };

  const saveSessionDraft = () => {
    if (!sessionDraft.session_date || !sessionDraft.start_time || !sessionDraft.end_time) {
      toast({ variant: "destructive", title: "Date and time are required" });
      return;
    }
    const name =
      sessionDraft.course_name.trim() ||
      (sessionDraft.course_id ? courseNameById.get(sessionDraft.course_id) : "") ||
      "Session";
    const next = { ...sessionDraft, course_name: name };
    setSessions((prev) => {
      if (sessionEditIndex === null) return [...prev, next];
      const copy = [...prev];
      copy[sessionEditIndex] = next;
      return copy;
    });
    setSessionDialogOpen(false);
  };

  const handleSaveTimetable = async () => {
    if (sessions.length === 0) {
      toast({ variant: "destructive", title: "Add at least one session on the calendar" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim() || "Class Timetable",
        period_type: periodType,
        period_start: period.start,
        batch_id: batchId || null,
        course_id: courseId || null,
        sessions: sessions.map((s) => ({
          session_date: s.session_date,
          course_id: s.course_id || courseId || null,
          course_name: s.course_name,
          start_time: s.start_time,
          end_time: s.end_time,
        })),
      };
      if (editingId) {
        await api.timetables.update(editingId, payload);
        toast({ title: "Timetable updated" });
      } else {
        await api.timetables.create(payload);
        toast({ title: "Timetable created" });
        resetBuilder();
      }
      await load();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.timetables.delete(deleteId);
      toast({ title: "Timetable deleted" });
      if (editingId === deleteId) resetBuilder();
      await load();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setDeleteId(null);
    }
  };

  const openSend = async (row: TimetableRow) => {
    setSendRow(row);
    const bid = row.batch_id || "";
    setSendBatchId(bid);
    setRecipients([]);
    setManualEmail("");
    setPreviewHtml("");
    setPreviewLoading(true);
    try {
      const res = (await api.timetables.preview(row.id)) as { html?: string };
      setPreviewHtml(res?.html || "");
    } catch {
      setPreviewHtml("");
    } finally {
      setPreviewLoading(false);
    }
    if (bid) {
      void loadBatchRecipients(bid, { replaceBatch: true });
    }
  };

  const loadBatchRecipients = async (
    bid: string,
    opts?: { replaceBatch?: boolean },
  ) => {
    if (!bid) return;
    setLoadingRecipients(true);
    try {
      const res = (await api.timetables.batchStudents(bid)) as {
        data?: { email?: string; name?: string }[];
      };
      const raw = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      const list: TimetableRecipient[] = (raw as { email?: string; name?: string }[])
        .map((s) => ({
          email: String(s.email || "").trim().toLowerCase(),
          name: s.name ? String(s.name).trim() : undefined,
          source: "batch" as const,
        }))
        .filter((s) => s.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email));

      setRecipients((prev) => {
        const manuals = opts?.replaceBatch !== false
          ? prev.filter((r) => r.source === "manual")
          : prev;
        const seen = new Set(manuals.map((r) => r.email.toLowerCase()));
        const merged = [...manuals];
        for (const r of list) {
          if (!seen.has(r.email)) {
            seen.add(r.email);
            merged.push(r);
          }
        }
        return merged;
      });

      if (list.length === 0) {
        toast({
          title: "No students with email in this batch",
          description: "Add emails on the Students page, or enter recipients manually.",
        });
      } else {
        toast({
          title: `Loaded ${list.length} student${list.length === 1 ? "" : "s"}`,
          description: "You can remove anyone before sending.",
        });
      }
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Could not load batch students",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setLoadingRecipients(false);
    }
  };

  const removeRecipient = (email: string) => {
    setRecipients((p) => p.filter((x) => x.email.toLowerCase() !== email.toLowerCase()));
  };

  const addManualRecipient = () => {
    const email = manualEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ variant: "destructive", title: "Enter a valid email address" });
      return;
    }
    if (recipients.some((r) => r.email.toLowerCase() === email)) {
      setManualEmail("");
      return;
    }
    setRecipients((p) => [...p, { email, source: "manual" }]);
    setManualEmail("");
  };

  const handleSend = async () => {
    if (!sendRow || recipients.length === 0) {
      toast({ variant: "destructive", title: "Add at least one recipient" });
      return;
    }
    setSending(true);
    try {
      const res = (await api.timetables.send(sendRow.id, {
        recipients: recipients.map((r) => ({ email: r.email, name: r.name || null })),
        batch_id: sendBatchId || null,
        subject: sendRow.title || "Offline Class Timetable",
      })) as { message?: string; sent?: number; failed?: { email: string; error: string }[] };
      toast({
        title: res?.message || "Timetable sent",
        description:
          res?.failed && res.failed.length > 0
            ? `${res.failed.length} failed — check SMTP settings`
            : undefined,
      });
      setSendRow(null);
      await load();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Send failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSending(false);
    }
  };

  const sessionsByDate = useMemo(() => {
    const m = new Map<string, TimetableSession[]>();
    for (const s of sessions) {
      const d = s.session_date;
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(s);
    }
    return m;
  }, [sessions]);

  const orgLogoPath = organization?.logo_url?.trim() || "";
  const orgLogoFallback = resolveUploadSrc(orgLogoPath) || syncpediaMark;

  return (
    <div className="space-y-6 pb-8">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-orange-500/10 via-background to-amber-500/5 p-6 sm:p-8">
        <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-orange-500/15 blur-2xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500 text-white shadow-lg shadow-orange-500/30">
              <CalendarRange className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Timetables</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Build weekly or monthly class schedules and send branded poster emails to students or any recipient.
              </p>
            </div>
          </div>
          {orgLogoPath ? (
            <ProtectedUploadImage
              path={orgLogoPath}
              alt=""
              className="hidden h-10 object-contain sm:block max-w-[140px]"
            />
          ) : (
            <img src={orgLogoFallback} alt="" className="hidden h-10 object-contain sm:block max-w-[140px]" />
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="create">Create timetable</TabsTrigger>
          <TabsTrigger value="send">Send timetable</TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="mt-6 space-y-6">
          <Card className="border-orange-500/10 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">
                {editingId ? "Edit timetable" : "New timetable"}
              </CardTitle>
              <CardDescription>
                {formatPeriodLabel(periodType, period.start, period.end)} · {sessions.length} session
                {sessions.length === 1 ? "" : "s"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Title</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Offline Class Timetable" />
                </div>
                <div className="space-y-1.5">
                  <Label>Period</Label>
                  <Select
                    value={periodType}
                    onValueChange={(v) => {
                      const next = v as PeriodType;
                      setPeriodType(next);
                      setAnchorDate(next === "month" ? defaultMonthAnchor() : defaultWeekAnchor());
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="week">Week</SelectItem>
                      <SelectItem value="month">Month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{periodType === "month" ? "Month" : "Week"}</Label>
                  <Select value={period.start} onValueChange={setAnchorDate}>
                    <SelectTrigger>
                      <SelectValue placeholder={periodType === "month" ? "Select month" : "Select week"} />
                    </SelectTrigger>
                    <SelectContent>
                      {periodOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Batch (optional)</Label>
                  <Select
                    value={batchId || "__none__"}
                    onValueChange={(v) => setBatchId(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No batch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No batch</SelectItem>
                      {batches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name || "Batch"} {b.course_name ? `· ${b.course_name}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Default course</Label>
                  <Select
                    value={courseId || "__none__"}
                    onValueChange={(v) => setCourseId(v === "__none__" ? "" : v)}
                    disabled={Boolean(batchId)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select course" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select manually per session</SelectItem>
                      {courses.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name || "Course"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <Label className="text-base">Calendar</Label>
                  <Badge variant="outline" className="font-normal">
                    {period.start} → {period.end}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
                  {calendarDays.map((day) => {
                    const daySessions = sessionsByDate.get(day) || [];
                    return (
                      <div
                        key={day}
                        className="flex min-h-[120px] flex-col rounded-xl border border-border/70 bg-card p-2 transition-colors hover:border-orange-400/50"
                      >
                        <button
                          type="button"
                          className="mb-2 text-left text-xs font-semibold text-muted-foreground"
                          onClick={() => openAddSession(day)}
                        >
                          {formatDayLabel(day)}
                        </button>
                        <div className="flex-1 space-y-1">
                          {daySessions.map((s, idx) => {
                            const globalIdx = sessions.findIndex(
                              (x) =>
                                x.session_date === s.session_date &&
                                x.start_time === s.start_time &&
                                x.course_name === s.course_name,
                            );
                            return (
                              <button
                                key={`${day}-${idx}`}
                                type="button"
                                onClick={() => openEditSession(globalIdx >= 0 ? globalIdx : idx)}
                                className="w-full rounded-lg bg-orange-500/10 px-2 py-1.5 text-left text-[10px] leading-tight hover:bg-orange-500/20"
                              >
                                <p className="font-bold uppercase text-foreground truncate">{s.course_name}</p>
                                <p className="text-muted-foreground">
                                  {formatTime12(s.start_time)} – {formatTime12(s.end_time)}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-1 h-7 w-full text-xs"
                          onClick={() => openAddSession(day)}
                        >
                          <Plus className="mr-1 h-3 w-3" /> Add
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button onClick={() => void handleSaveTimetable()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {editingId ? "Update timetable" : "Save timetable"}
                </Button>
                {editingId ? (
                  <Button type="button" variant="outline" onClick={resetBuilder}>
                    Cancel edit
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saved timetables</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex h-24 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No timetables yet.</p>
              ) : (
                <div className="space-y-2">
                  {rows.map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-col gap-2 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium">{r.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatPeriodLabel(r.period_type, r.period_start, r.period_end)}
                          {r.batch_name ? ` · ${r.batch_name}` : ""}
                          · {r.session_count ?? 0} sessions
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => void loadForEdit(r)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setDeleteId(r.id)}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="send" className="mt-6">
          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                Create a timetable first, then send it from here.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((r) => (
                <Card key={r.id} className="overflow-hidden transition-shadow hover:shadow-md">
                  <div className="h-1.5 bg-gradient-to-r from-orange-500 to-amber-400" />
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base leading-snug">{r.title}</CardTitle>
                    <CardDescription>
                      {formatPeriodLabel(r.period_type, r.period_start, r.period_end)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">{r.session_count ?? 0} sessions</Badge>
                      {r.batch_name ? <Badge variant="outline">{r.batch_name}</Badge> : null}
                      {(r.send_count ?? 0) > 0 ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">
                          Sent {r.send_count}×
                        </Badge>
                      ) : null}
                    </div>
                    <Button className="w-full" onClick={() => void openSend(r)}>
                      <Send className="mr-2 h-4 w-4" /> Send via email
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={sessionDialogOpen} onOpenChange={setSessionDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{sessionEditIndex !== null ? "Edit session" : "Add session"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={sessionDraft.session_date}
                onChange={(e) => setSessionDraft((p) => ({ ...p, session_date: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Course</Label>
              <Select
                value={sessionDraft.course_id || courseId || "__custom__"}
                onValueChange={(v) => {
                  if (v === "__custom__") return;
                  setSessionDraft((p) => ({
                    ...p,
                    course_id: v,
                    course_name: courseNameById.get(v) || p.course_name,
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__custom__">Custom name below</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={sessionDraft.course_name}
                onChange={(e) => setSessionDraft((p) => ({ ...p, course_name: e.target.value }))}
                placeholder="Course name (e.g. CYBERSECURITY)"
                className="mt-2 uppercase"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start</Label>
                <Input
                  type="time"
                  value={sessionDraft.start_time}
                  onChange={(e) => setSessionDraft((p) => ({ ...p, start_time: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End</Label>
                <Input
                  type="time"
                  value={sessionDraft.end_time}
                  onChange={(e) => setSessionDraft((p) => ({ ...p, end_time: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            {sessionEditIndex !== null ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setSessions((p) => p.filter((_, i) => i !== sessionEditIndex));
                  setSessionDialogOpen(false);
                }}
              >
                Remove
              </Button>
            ) : null}
            <Button onClick={saveSessionDraft}>Save session</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!sendRow} onOpenChange={(o) => !o && setSendRow(null)}>
        <DialogContent className="max-h-[92dvh] overflow-hidden flex flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Send timetable</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Load students from batch</Label>
                  <Select
                    value={sendBatchId || "__none__"}
                    onValueChange={(v) => {
                      const bid = v === "__none__" ? "" : v;
                      setSendBatchId(bid);
                      if (!bid) {
                        setRecipients((prev) => prev.filter((r) => r.source === "manual"));
                        return;
                      }
                      void loadBatchRecipients(bid, { replaceBatch: true });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a batch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No batch</SelectItem>
                      {batches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name || b.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Selecting a batch loads all enrolled students with an email.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Add email manually</Label>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      value={manualEmail}
                      onChange={(e) => setManualEmail(e.target.value)}
                      placeholder="candidate@email.com"
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addManualRecipient())}
                    />
                    <Button type="button" variant="secondary" onClick={addManualRecipient}>
                      Add
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Recipients ({recipients.length})</Label>
                    {recipients.length > 0 ? (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground hover:text-destructive"
                        onClick={() => setRecipients([])}
                      >
                        Clear all
                      </button>
                    ) : null}
                  </div>
                  <div className="max-h-52 overflow-y-auto rounded-lg border p-2 space-y-1">
                    {loadingRecipients ? (
                      <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading students…
                      </div>
                    ) : recipients.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-1 py-2">
                        No recipients yet — pick a batch or add an email.
                      </p>
                    ) : (
                      recipients.map((r) => (
                        <div
                          key={`${r.source}:${r.email}`}
                          className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs"
                        >
                          <span className="min-w-0 truncate">
                            <Mail className="inline h-3 w-3 mr-1 opacity-60" />
                            {r.name ? `${r.name} · ` : ""}
                            {r.email}
                            <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {r.source === "batch" ? "batch" : "manual"}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => removeRecipient(r.email)}
                            title="Remove recipient"
                          >
                            <X className="h-3.5 w-3.5" />
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" /> Email preview
                </Label>
                <div className="rounded-xl border bg-muted/30 overflow-hidden min-h-[240px]">
                  {previewLoading ? (
                    <div className="flex h-60 items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : previewHtml ? (
                    <iframe
                      title="Timetable preview"
                      srcDoc={previewHtml}
                      className="h-72 w-full border-0 bg-white"
                    />
                  ) : (
                    <p className="p-6 text-sm text-muted-foreground text-center">Preview unavailable</p>
                  )}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendRow(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSend()} disabled={sending || recipients.length === 0}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete timetable?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all sessions and send history for this timetable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
