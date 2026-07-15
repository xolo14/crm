import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  AlertCircle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  GraduationCap,
  Layers,
  Loader2,
  Mail,
  Phone,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type LeadEnrollDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Record<string, unknown> | null;
  /** Kept for callers; course/batch lists use the same API scope as the Courses page (JWT org / super_admin rules). */
  orgId?: string | null;
  onEnrolled: () => void;
};

type CourseRow = { id: string; name: string; is_active?: boolean | number | string };
type BatchRow = {
  id: string;
  name: string;
  course_id?: string | null;
  course_name?: string | null;
  start_date?: string | null;
  seat_limit?: number;
  enrolled?: number;
  status?: string | null;
};

function normUuid(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

function parseCourseList(res: unknown): CourseRow[] {
  const r = res as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== "object") return [];
  const d = r.data;
  if (Array.isArray(d)) return d as CourseRow[];
  if (Array.isArray(r.courses)) return r.courses as CourseRow[];
  return [];
}

function parseBatchList(res: unknown): BatchRow[] {
  const r = res as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== "object") return [];
  const d = r.data;
  if (Array.isArray(d)) return d as BatchRow[];
  if (Array.isArray(r.batches)) return r.batches as BatchRow[];
  return [];
}

function isCourseInactive(c: CourseRow): boolean {
  const v = c.is_active;
  if (v === false || v === 0 || v === "0") return true;
  if (typeof v === "string" && v.trim().toLowerCase() === "false") return true;
  return false;
}

function leadInitials(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

export function LeadEnrollDialog({ open, onOpenChange, lead, onEnrolled }: LeadEnrollDialogProps) {
  const { toast } = useToast();
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  /**
   * Do not pass `org_id` on these GETs: PHP only honors `?org_id=` for super_admin, so a lead's org_id could
   * differ from where courses were created (e.g. super_admin sees all courses on Courses, but scoped GET returned 0).
   * Enrollment is still validated server-side (batch vs lead org) on update.
   */
  const coursesQuery = useQuery({
    queryKey: ["lead-enroll-courses", "scope-token"],
    queryFn: async () => {
      const res = await api.courses.list();
      return parseCourseList(res);
    },
    enabled: open && !!lead,
  });

  const batchesQuery = useQuery({
    queryKey: ["lead-enroll-batches", "scope-token"],
    queryFn: async () => {
      const res = await api.batches.list();
      return parseBatchList(res);
    },
    enabled: open && !!lead,
  });

  useEffect(() => {
    if (!open) {
      setSelectedCourseId("");
      setSelectedBatchId("");
      setSubmitting(false);
    }
  }, [open]);

  const courses = useMemo(() => {
    const list = coursesQuery.data || [];
    return [...list].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
  }, [coursesQuery.data]);

  const batchesForCourse = useMemo(() => {
    if (!selectedCourseId) return [];
    const sel = normUuid(selectedCourseId);
    return (batchesQuery.data || []).filter((b) => normUuid(b.course_id) === sel);
  }, [batchesQuery.data, selectedCourseId]);

  const leadName = String(lead?.name || "Lead");
  const leadEmail = String(lead?.email || "").trim();
  const leadPhone = lead?.phone != null ? String(lead.phone) : "";

  const handleEnroll = async () => {
    if (!lead?.id) return;
    if (!leadEmail) {
      toast({ variant: "destructive", title: "Email required", description: "Add an email on the lead before enrolling." });
      return;
    }
    if (!selectedBatchId) {
      toast({ variant: "destructive", title: "Select a batch", description: "Choose a course and batch to continue." });
      return;
    }
    setSubmitting(true);
    try {
      await api.leads.update(String(lead.id), {
        status: "enrolled",
        batch_id: selectedBatchId,
      });
      toast({
        title: "Enrolled",
        description: `${leadName} was added to the student list and linked to the selected batch.`,
      });
      onOpenChange(false);
      onEnrolled();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Enrollment failed";
      toast({ variant: "destructive", title: "Could not enroll", description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const loading = coursesQuery.isLoading || batchesQuery.isLoading;
  const loadError = coursesQuery.isError || batchesQuery.isError;

  const step = !selectedCourseId ? 1 : !selectedBatchId ? 2 : 3;
  const canSubmit = !!leadEmail && !!selectedBatchId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,100%)] min-h-0 max-w-lg flex-col gap-0 overflow-hidden p-0 md:max-w-2xl">
        <DialogHeader className="relative shrink-0 space-y-0 border-b bg-gradient-to-b from-background to-muted/20 px-6 pb-5 pt-6 text-left">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Sales · Pipeline</p>
          <div className="flex flex-col gap-1 pr-8 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 space-y-1.5">
              <DialogTitle className="text-xl font-bold tracking-tight sm:text-2xl">Enroll lead</DialogTitle>
              <DialogDescription className="max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                Confirm the prospect, choose a programme, then a batch. The student record links to that batch and seat
                counts stay in sync.
              </DialogDescription>
            </div>
            <Badge variant="secondary" className="shrink-0 self-start font-medium">
              <GraduationCap className="mr-1 h-3.5 w-3.5" aria-hidden />
              Enrollment
            </Badge>
          </div>

          {/* Step rail */}
          <div className="mt-6 flex items-center gap-2 sm:gap-3">
            {[
              { n: 1, label: "Lead" },
              { n: 2, label: "Course" },
              { n: 3, label: "Batch" },
            ].map((s, i) => (
              <div key={s.n} className="flex min-w-0 flex-1 items-center gap-2">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                    step >= s.n ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground",
                  )}
                >
                  {step > s.n ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : s.n}
                </div>
                <span
                  className={cn(
                    "hidden truncate text-xs font-semibold uppercase tracking-wide sm:inline",
                    step >= s.n ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
                {i < 2 ? <div className="mx-1 hidden h-px min-w-[12px] flex-1 bg-border sm:block" aria-hidden /> : null}
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
          <div className="space-y-6 bg-muted/25 px-5 py-5 pb-8 sm:px-6">
            {lead && (
              <>
                {/* Lead summary */}
                <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
                  <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-3">
                    <User className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lead profile</span>
                  </div>
                  <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5">
                    <div
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-base font-bold text-primary"
                      aria-hidden
                    >
                      {leadInitials(leadName)}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="truncate text-lg font-semibold tracking-tight text-foreground">{leadName}</p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
                        {leadEmail ? (
                          <a
                            href={`mailto:${leadEmail}`}
                            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Mail className="h-4 w-4 shrink-0 text-primary/70" aria-hidden />
                            <span className="truncate">{leadEmail}</span>
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
                            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                            No email on file — add one to enroll
                          </span>
                        )}
                        {leadPhone ? (
                          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                            <Phone className="h-4 w-4 shrink-0 text-primary/70" aria-hidden />
                            {leadPhone}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Courses */}
                <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Programme</span>
                    </div>
                    {!loading && !loadError ? (
                      <Badge variant="outline" className="font-mono text-[10px] font-semibold uppercase tracking-wide">
                        {courses.length} course{courses.length === 1 ? "" : "s"}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="p-4">
                    {loadError ? (
                      <div className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                        <div>
                          <p className="font-semibold">Could not load catalog</p>
                          <p className="mt-1 text-xs opacity-90">Check your connection and try again.</p>
                        </div>
                      </div>
                    ) : loading ? (
                      <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
                        <Loader2 className="h-8 w-8 animate-spin text-primary/60" aria-hidden />
                        <p className="text-sm font-medium">Loading programmes and batches…</p>
                      </div>
                    ) : courses.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
                        <Layers className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" aria-hidden />
                        <p className="text-sm font-medium text-foreground">No courses in your scope</p>
                        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
                          Add courses on the Courses page. Super admins must pick a batch that matches this lead&apos;s
                          organisation — the server validates that on save.
                        </p>
                      </div>
                    ) : (
                      <RadioGroup
                        value={selectedCourseId}
                        onValueChange={(v) => {
                          setSelectedCourseId(v);
                          setSelectedBatchId("");
                        }}
                        className="grid gap-2 sm:grid-cols-2"
                      >
                        {courses.map((c) => {
                          const inactive = isCourseInactive(c);
                          const selected = selectedCourseId === c.id;
                          return (
                            <label
                              key={c.id}
                              className={cn(
                                "group relative flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all duration-200",
                                selected
                                  ? "border-primary bg-primary/[0.06] shadow-md ring-2 ring-primary/25"
                                  : "border-border/70 bg-background hover:border-primary/30 hover:bg-muted/30 hover:shadow-sm",
                                inactive && "opacity-75",
                              )}
                            >
                              <RadioGroupItem value={c.id} id={`course-${c.id}`} className="mt-1" />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold leading-snug text-foreground">{c.name}</span>
                                  {inactive ? (
                                    <Badge variant="secondary" className="text-[10px] font-semibold uppercase">
                                      Inactive
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="border-emerald-200/80 bg-emerald-50 text-[10px] font-semibold uppercase text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
                                      Active
                                    </Badge>
                                  )}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">Select to see available batches</p>
                              </div>
                            </label>
                          );
                        })}
                      </RadioGroup>
                    )}
                  </div>
                </section>

                {/* Batches */}
                {selectedCourseId ? (
                  <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Batch</span>
                      </div>
                      {batchesForCourse.length > 0 ? (
                        <Badge variant="outline" className="font-mono text-[10px] font-semibold uppercase tracking-wide">
                          {batchesForCourse.length} option{batchesForCourse.length === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="p-4">
                      {batchesForCourse.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
                          <CalendarDays className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" aria-hidden />
                          <p className="text-sm font-medium text-foreground">No batches for this programme</p>
                          <p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">
                            Create a batch for this course, then return here to enroll.
                          </p>
                        </div>
                      ) : (
                        <RadioGroup value={selectedBatchId} onValueChange={setSelectedBatchId} className="space-y-3">
                          {batchesForCourse.map((b) => {
                            const cap = Number(b.seat_limit ?? 30) || 30;
                            const enr = Number(b.enrolled ?? 0);
                            const full = enr >= cap;
                            const pct = cap > 0 ? Math.min(100, Math.round((enr / cap) * 100)) : 0;
                            const selected = selectedBatchId === b.id;
                            return (
                              <label
                                key={b.id}
                                className={cn(
                                  "block cursor-pointer rounded-xl border p-4 transition-all duration-200",
                                  full
                                    ? "cursor-not-allowed border-border/50 bg-muted/20 opacity-60"
                                    : selected
                                      ? "border-primary bg-primary/[0.06] shadow-md ring-2 ring-primary/25"
                                      : "border-border/70 bg-background hover:border-primary/30 hover:bg-muted/25 hover:shadow-sm",
                                )}
                              >
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="flex items-start gap-3">
                                    <RadioGroupItem value={b.id} id={`batch-${b.id}`} disabled={full} className="mt-1" />
                                    <div className="min-w-0">
                                      <p className="font-semibold text-foreground">{b.name}</p>
                                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                        <span className="inline-flex items-center gap-1">
                                          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                                          {b.start_date ? `Starts ${b.start_date}` : "Start TBD"}
                                        </span>
                                        {b.status ? (
                                          <>
                                            <Separator orientation="vertical" className="hidden h-3 sm:inline" />
                                            <span className="capitalize">{String(b.status)}</span>
                                          </>
                                        ) : null}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="shrink-0 pl-8 sm:pl-0 sm:text-right">
                                    {full ? (
                                      <Badge variant="destructive" className="font-semibold">
                                        Full
                                      </Badge>
                                    ) : (
                                      <span className="text-xs font-medium tabular-nums text-muted-foreground">
                                        {enr} / {cap} seats
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {!full ? (
                                  <div className="mt-3 pl-8 sm:pl-7">
                                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                      <div
                                        className="h-full rounded-full bg-primary/80 transition-[width] duration-500 ease-out"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>
                                ) : null}
                              </label>
                            );
                          })}
                        </RadioGroup>
                      )}
                    </div>
                  </section>
                ) : null}
              </>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-col gap-3 border-t bg-muted/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6">
          <p className="text-left text-xs text-muted-foreground sm:max-w-[55%]">
            {canSubmit ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Ready to enroll — student will appear with the selected batch.
              </span>
            ) : (
              <span>
                {!leadEmail
                  ? "Add an email to the lead before enrolling."
                  : !selectedCourseId
                    ? "Choose a programme to see batches."
                    : "Select a batch with available seats to continue."}
              </span>
            )}
          </p>
          <div className="flex w-full gap-2 sm:w-auto sm:justify-end">
            <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1 sm:flex-none sm:min-w-[7.5rem]"
              onClick={() => void handleEnroll()}
              disabled={submitting || !canSubmit}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Enrolling…
                </>
              ) : (
                <>
                  <GraduationCap className="mr-2 h-4 w-4" aria-hidden />
                  Enroll
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
