import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  Calendar,
  ClipboardCheck,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  GraduationCap,
  Mail,
  Phone,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import {
  assessmentsApi,
  type PeaklyyAssessment,
  type PeaklyyAttemptAnswerDetail,
  type PeaklyyAttemptRow,
  type PeaklyyCustomQuestionInput,
  type PeaklyyResponseMode,
  type PeaklyySourceMode,
} from "@/services/assessments";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { downloadProtectedUpload } from "@/lib/resumeHref";
import { Checkbox } from "@/components/ui/checkbox";
import AssignedAssignmentsCard from "@/components/assignments/AssignedAssignmentsCard";

function downloadTextFile(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function notepadDownloadName(attemptName: string | undefined, a: PeaklyyAttemptAnswerDetail): string {
  if (a.notepad_file_name) return a.notepad_file_name;
  const base = (attemptName || "Candidate").trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_") || "Candidate";
  const q = a.question_number || 1;
  return `${base}_Q${q}.txt`;
}

function emptyQuestion(mode: PeaklyyResponseMode = "mcq"): PeaklyyCustomQuestionInput {
  const isMcq = mode === "mcq";
  return {
    q_type: isMcq ? "mcq" : "task",
    response_mode: mode,
    prompt: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct_option: "a",
    points: isMcq ? 5 : 0,
    allow_notepad: mode === "notepad" || mode === "notepad_upload",
    allow_upload: mode === "upload" || mode === "notepad_upload",
  };
}

function resolveMode(q: PeaklyyCustomQuestionInput): PeaklyyResponseMode {
  if (q.response_mode) return q.response_mode;
  if (q.q_type === "task") {
    if (q.allow_notepad && q.allow_upload) return "notepad_upload";
    if (q.allow_upload) return "upload";
    return "notepad";
  }
  return "mcq";
}

function csvEscape(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function parseAttemptDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw.includes("T") || raw.includes("Z") || raw.includes("+") ? raw : raw.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatAttemptDate(at?: string | null): string {
  const d = parseAttemptDate(at);
  if (!d) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type AttemptPeriod =
  | "all"
  | "today"
  | "last_7"
  | "last_week"
  | "last_30"
  | "this_month"
  | "custom";

const PERIOD_LABELS: Record<AttemptPeriod, string> = {
  all: "All time",
  today: "Today",
  last_7: "Last 7 days",
  last_week: "Last week",
  last_30: "Last 30 days",
  this_month: "This month",
  custom: "Custom range",
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Inclusive [from, to] for the selected period. Null bounds = unbounded. */
function periodBounds(
  period: AttemptPeriod,
  customFrom?: string,
  customTo?: string,
): { from: Date | null; to: Date | null } {
  const now = new Date();
  const todayStart = startOfDay(now);

  if (period === "all") return { from: null, to: null };
  if (period === "today") return { from: todayStart, to: endOfDay(now) };
  if (period === "last_7") {
    const from = startOfDay(now);
    from.setDate(from.getDate() - 6);
    return { from, to: endOfDay(now) };
  }
  if (period === "last_week") {
    // Previous calendar week (Mon–Sun)
    const day = now.getDay(); // 0 Sun … 6 Sat
    const daysSinceMonday = (day + 6) % 7;
    const thisMonday = startOfDay(now);
    thisMonday.setDate(thisMonday.getDate() - daysSinceMonday);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(lastMonday.getDate() - 7);
    const lastSunday = endOfDay(new Date(thisMonday));
    lastSunday.setDate(lastSunday.getDate() - 1);
    return { from: lastMonday, to: lastSunday };
  }
  if (period === "last_30") {
    const from = startOfDay(now);
    from.setDate(from.getDate() - 29);
    return { from, to: endOfDay(now) };
  }
  if (period === "this_month") {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0), to: endOfDay(now) };
  }
  // custom
  const from = customFrom ? startOfDay(new Date(customFrom)) : null;
  const to = customTo ? endOfDay(new Date(customTo)) : null;
  return {
    from: from && !Number.isNaN(from.getTime()) ? from : null,
    to: to && !Number.isNaN(to.getTime()) ? to : null,
  };
}

function attemptInPeriod(row: PeaklyyAttemptRow, from: Date | null, to: Date | null): boolean {
  const d = parseAttemptDate(row.created_at || row.started_at || row.submitted_at);
  if (!d) return from == null && to == null;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function exportAttemptsCsv(
  rows: PeaklyyAttemptRow[],
  opts: { assessmentSlug: string; domains: Record<string, string>; periodLabel: string; periodSlug: string },
) {
  const headers = [
    "Name",
    "Email",
    "Phone",
    "College / Institution",
    "Degree / Branch",
    "Graduation Year",
    "Interests / Domain",
    "Domain Key",
    "MCQ Score",
    "Stars",
    "Passed",
    "Status",
    "Phase",
    "Time Taken (sec)",
    "Webhook",
    "Attempted At",
    "Started At",
    "MCQ Submitted At",
    "Completed At",
    "Attempt ID",
    "Period",
  ];
  const csvRows = rows.map((r) => [
    r.full_name,
    r.email,
    r.phone || "",
    r.college_name || "",
    r.degree_branch || "",
    r.graduation_year || "",
    r.interest_topics?.length
      ? r.interest_topics.join(", ")
      : r.domain_key === "custom"
        ? "Custom"
        : opts.domains[r.domain_key] || r.domain_key,
    r.domain_key,
    r.score ?? "",
    r.stars ?? "",
    r.passed == null ? "" : Number(r.passed) ? "Yes" : "No",
    r.status,
    r.attempt_phase || "",
    r.time_taken_seconds ?? "",
    r.webhook_status || "",
    r.created_at || "",
    r.started_at || "",
    r.mcq_submitted_at || "",
    r.submitted_at || "",
    r.id,
    opts.periodLabel,
  ]);
  const csv = [headers.map(csvEscape).join(","), ...csvRows.map((row) => row.map(csvEscape).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = (opts.assessmentSlug || "assessment").replace(/[^a-z0-9_-]+/gi, "-");
  const periodPart = opts.periodSlug.replace(/[^a-z0-9_-]+/gi, "-") || "all";
  a.download = `peaklyy-attempts-${periodPart}-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function isSyncpediaAssessment(a: PeaklyyAssessment): boolean {
  const theme = String(a.ui_theme || "").toLowerCase();
  const slug = String(a.slug || "").toLowerCase();
  return theme === "syncpedia" || slug.includes("syncpedia");
}

function isSystemAssignment(a: PeaklyyAssessment): boolean {
  const slug = String(a.slug || "").toLowerCase();
  return slug === "syncpedia-fresher-basics" || slug === "syncpedia-assignment";
}

function assignmentUserId(value: unknown): string {
  return String(value ?? "").trim();
}

function assessmentPublicPath(a: PeaklyyAssessment | null | undefined): string {
  if (!a) return "";
  if (a.open_url) return a.open_url;
  const key = a.result_api_key ? `#key=${encodeURIComponent(a.result_api_key)}` : "";
  return `${window.location.origin}/assessment/${a.slug}${key}`;
}

export default function AssessmentsAdminPage() {
  const { role } = useAuth();
  const isSuperAdmin = role === "super_admin";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkDialogId, setLinkDialogId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "Syncpedia Assignment",
    duration_minutes: 0,
    question_count: 30,
    result_webhook_url: "",
    once_per_candidate: true,
    anti_cheat: true,
    source_mode: "domain_bank" as PeaklyySourceMode,
  });
  const [customQuestions, setCustomQuestions] = useState<PeaklyyCustomQuestionInput[]>([emptyQuestion()]);
  const [detailAttemptId, setDetailAttemptId] = useState<string | null>(null);
  const [attemptPeriod, setAttemptPeriod] = useState<AttemptPeriod>("last_7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [adminTab, setAdminTab] = useState<"assessments" | "peaklyy" | "syncpedia">("assessments");
  const [zipBusy, setZipBusy] = useState(false);
  const [confirmDeleteAttempt, setConfirmDeleteAttempt] = useState<PeaklyyAttemptRow | null>(null);
  const [confirmDeleteAssessment, setConfirmDeleteAssessment] = useState<PeaklyyAssessment | null>(null);

  const deleteAttemptMut = useMutation({
    mutationFn: (attemptId: string) => assessmentsApi.deleteAttempt(attemptId),
    onSuccess: () => {
      toast({ title: "Candidate attempt deleted" });
      setConfirmDeleteAttempt(null);
      if (detailAttemptId) setDetailAttemptId(null);
      qc.invalidateQueries({ queryKey: ["peaklyy", "attempts"] });
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: err?.message || "Could not delete attempt",
      });
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["peaklyy", "assessments"],
    queryFn: assessmentsApi.list,
  });
  const list = data?.data ?? [];
  const domains = data?.domains ?? {};

  const peaklyyList = useMemo(() => list.filter((a) => !isSyncpediaAssessment(a)), [list]);
  const syncpediaList = useMemo(() => list.filter((a) => isSyncpediaAssessment(a)), [list]);
  const activeList = useMemo(() => list.filter((a) => !!a.is_active), [list]);

  const selected = useMemo(
    () => list.find((a) => a.id === selectedId) || null,
    [list, selectedId],
  );

  const linkDialogAssessment = useMemo(
    () => list.find((a) => a.id === linkDialogId) || null,
    [list, linkDialogId],
  );

  // Keep selection valid for the active brand tab
  const brandList = adminTab === "syncpedia" ? syncpediaList : adminTab === "peaklyy" ? peaklyyList : list;
  const selectedForAttempts = useMemo(() => {
    if (!isSuperAdmin) {
      if (selected && list.some((a) => a.id === selected.id)) return selected;
      return list[0] || null;
    }
    if (adminTab === "assessments") return selected;
    if (selected && brandList.some((a) => a.id === selected.id)) return selected;
    return brandList[0] || null;
  }, [isSuperAdmin, adminTab, selected, brandList, list]);

  const { data: attemptsRes } = useQuery({
    queryKey: ["peaklyy", "attempts", selectedForAttempts?.id],
    queryFn: () => assessmentsApi.attempts(selectedForAttempts!.id),
    enabled: !!selectedForAttempts?.id && (!isSuperAdmin || adminTab === "peaklyy" || adminTab === "syncpedia"),
  });

  // Super Admin: Team members & assignments query
  const { data: teamData } = useQuery({
    queryKey: ["team", "list"],
    queryFn: () => api.team.list(),
    enabled: isSuperAdmin && !!linkDialogId,
  });
  const teamMembers = useMemo(() => teamData?.data ?? [], [teamData]);

  const {
    data: assignedUsersData,
    refetch: refetchAssignedUsers,
    isFetching: assignedUsersFetching,
    isSuccess: assignedUsersSuccess,
  } = useQuery({
    queryKey: ["assessment", "assigned_users", linkDialogId],
    queryFn: () => assessmentsApi.assignedUsers(linkDialogId!),
    enabled: isSuperAdmin && !!linkDialogId,
  });

  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [assignSearch, setAssignSearch] = useState("");
  const assignDirtyRef = useRef(false);

  const assignMut = useMutation({
    mutationFn: (userIds: string[]) =>
      assessmentsApi.assignUsers(linkDialogAssessment!.id, userIds.map(assignmentUserId).filter(Boolean)),
    onSuccess: (res, userIds) => {
      assignDirtyRef.current = false;
      const saved = (Array.isArray(res.user_ids) ? res.user_ids : userIds)
        .map(assignmentUserId)
        .filter(Boolean);
      setAssignedUserIds(saved);
      qc.setQueryData(["peaklyy", "assessments"], (old: { data?: PeaklyyAssessment[] } | undefined) => {
        if (!old?.data || !linkDialogId) return old;
        return {
          ...old,
          data: old.data.map((a) =>
            a.id === linkDialogId ? { ...a, assigned_user_ids: saved } : a,
          ),
        };
      });
      toast({ title: "Assignments saved", description: `${res.count ?? saved.length} team member(s) assigned.` });
      void refetchAssignedUsers();
      qc.invalidateQueries({ queryKey: ["assessment", "assigned_users", linkDialogId] });
      qc.invalidateQueries({ queryKey: ["peaklyy", "assessments"] });
      qc.invalidateQueries({ queryKey: ["my_assignments"] });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", title: "Could not save assignments", description: err?.message });
    },
  });

  useEffect(() => {
    if (!linkDialogId) {
      assignDirtyRef.current = false;
      setAssignedUserIds([]);
      setAssignSearch("");
      return;
    }
    assignDirtyRef.current = false;
    setAssignedUserIds((linkDialogAssessment?.assigned_user_ids || []).map(assignmentUserId).filter(Boolean));
    setAssignSearch("");
  }, [linkDialogId]);

  useEffect(() => {
    if (!linkDialogId || assignDirtyRef.current || assignMut.isPending || assignedUsersFetching) return;
    if (!assignedUsersSuccess || !assignedUsersData) return;
    const rows = Array.isArray(assignedUsersData.data) ? assignedUsersData.data : [];
    const fromApi = rows.map((u) => assignmentUserId(u.user_id)).filter(Boolean);
    const fromList = (linkDialogAssessment?.assigned_user_ids || []).map(assignmentUserId).filter(Boolean);
    setAssignedUserIds(fromApi.length ? fromApi : fromList);
  }, [
    linkDialogId,
    assignedUsersData,
    assignedUsersFetching,
    assignedUsersSuccess,
    assignMut.isPending,
    linkDialogAssessment?.assigned_user_ids,
  ]);

  const filteredTeamMembers = useMemo(() => {
    if (!assignSearch.trim()) return teamMembers;
    const q = assignSearch.toLowerCase();
    return teamMembers.filter(
      (m: any) =>
        (m.full_name && m.full_name.toLowerCase().includes(q)) ||
        (m.email && m.email.toLowerCase().includes(q)) ||
        (m.role && m.role.toLowerCase().includes(q)),
    );
  }, [teamMembers, assignSearch]);

  const { data: attemptDetail, isFetching: detailLoading } = useQuery({
    queryKey: ["peaklyy", "attempt-detail", detailAttemptId],
    queryFn: () => assessmentsApi.attemptDetail(detailAttemptId!),
    enabled: !!detailAttemptId,
  });

  const allAttemptRows = attemptsRes?.data ?? [];
  const { from: periodFrom, to: periodTo } = useMemo(
    () => periodBounds(attemptPeriod, customFrom, customTo),
    [attemptPeriod, customFrom, customTo],
  );
  const attemptRows = useMemo(
    () => allAttemptRows.filter((r) => attemptInPeriod(r, periodFrom, periodTo)),
    [allAttemptRows, periodFrom, periodTo],
  );
  const periodLabel =
    attemptPeriod === "custom" && (customFrom || customTo)
      ? `Custom ${customFrom || "…"} → ${customTo || "…"}`
      : PERIOD_LABELS[attemptPeriod];
  const periodSlug =
    attemptPeriod === "custom"
      ? `custom-${customFrom || "start"}-to-${customTo || "end"}`
      : attemptPeriod;

  const handleExportAttempts = () => {
    if (!selectedForAttempts) return;
    if (attemptRows.length === 0) {
      toast({ variant: "destructive", title: "No attempts in this period", description: periodLabel });
      return;
    }
    exportAttemptsCsv(attemptRows, {
      assessmentSlug: selectedForAttempts.slug,
      domains,
      periodLabel,
      periodSlug,
    });
    toast({
      title: "Attempts exported",
      description: `${attemptRows.length} row(s) for ${periodLabel}`,
    });
  };

  const handleDownloadTasksZip = async () => {
    if (!detailAttemptId) return;
    setZipBusy(true);
    try {
      await assessmentsApi.downloadTasksZip(detailAttemptId);
      toast({ title: "ZIP downloaded", description: "All task notepad + upload files for this candidate" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: e instanceof Error ? e.message : "ZIP download failed",
      });
    } finally {
      setZipBusy(false);
    }
  };

  const createMut = useMutation({
    mutationFn: () => {
      if (form.source_mode === "custom") {
        const cleaned = customQuestions
          .map((q) => {
            const mode = resolveMode(q);
            const isMcq = mode === "mcq";
            return {
              ...q,
              prompt: q.prompt.trim(),
              response_mode: mode,
              q_type: (isMcq ? "mcq" : "task") as "mcq" | "task",
              allow_notepad: mode === "notepad" || mode === "notepad_upload",
              allow_upload: mode === "upload" || mode === "notepad_upload" || (!!q.allow_upload && isMcq),
              points: isMcq ? Number(q.points) || 5 : 0,
            };
          })
          .filter((q) => q.prompt.length > 0);
        if (cleaned.length < 1) {
          return Promise.reject(new Error("Add at least one question with a prompt"));
        }
        for (const q of cleaned) {
          if (q.response_mode === "mcq") {
            if (![q.option_a, q.option_b, q.option_c, q.option_d].every((o) => (o || "").trim())) {
              return Promise.reject(new Error("Each MCQ needs options A–D filled in"));
            }
          }
        }
        return assessmentsApi.create({
          title: form.title,
          duration_minutes: form.duration_minutes,
          question_count: cleaned.length,
          result_webhook_url: form.result_webhook_url || null,
          once_per_candidate: form.once_per_candidate,
          anti_cheat: form.anti_cheat,
          source_mode: "custom",
          ui_theme: "syncpedia",
          brand_name: "Syncpedia",
          brand_tagline: "Cybersecurity · Ethical Hacking · AI — basics",
          questions: cleaned,
        });
      }
      return assessmentsApi.create({
        title: form.title,
        duration_minutes: 0,
        question_count: 30,
        result_webhook_url: form.result_webhook_url || null,
        once_per_candidate: form.once_per_candidate,
        anti_cheat: form.anti_cheat,
        source_mode: "domain_bank",
        ui_theme: "syncpedia",
        brand_name: "Syncpedia",
        brand_tagline: "Cybersecurity · Ethical Hacking · AI — basics",
      });
    },
    onSuccess: (r) => {
      toast({
        title: "Assignment created",
        description: `${r.source_mode === "custom" ? "Custom" : "Domain bank"} · permanent API key · ${
          r.source_mode === "domain_bank" || !r.duration_minutes ? "untimed" : `${r.duration_minutes} min`
        } · ${r.question_count} questions`,
      });
      qc.invalidateQueries({ queryKey: ["peaklyy"] });
      setSelectedId(r.id);
      setAdminTab("syncpedia");
      if (form.source_mode === "custom") {
        setCustomQuestions([emptyQuestion()]);
      }
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });

  const regenMut = useMutation({
    mutationFn: (id: string) => assessmentsApi.regenerateApiKey(id),
    onSuccess: (r) => {
      toast({ title: "API key regenerated" });
      qc.invalidateQueries({ queryKey: ["peaklyy"] });
      void navigator.clipboard.writeText(r.result_api_key);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });

  const updateMut = useMutation({
    mutationFn: (body: Partial<PeaklyyAssessment> & { id: string }) => assessmentsApi.update(body),
    onSuccess: () => {
      toast({ title: "Saved" });
      qc.invalidateQueries({ queryKey: ["peaklyy"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });

  const deleteAssessmentMut = useMutation({
    mutationFn: (id: string) => assessmentsApi.delete(id),
    onSuccess: (_, id) => {
      toast({ title: "Assignment deleted" });
      setConfirmDeleteAssessment(null);
      if (linkDialogId === id) setLinkDialogId(null);
      if (selectedId === id) setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["peaklyy"] });
      qc.invalidateQueries({ queryKey: ["my_assignments"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });

  const updateQuestion = (index: number, patch: Partial<PeaklyyCustomQuestionInput>) => {
    setCustomQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  };

  const renderBrandAttemptsPanel = (label: string, brandAssessments: PeaklyyAssessment[]) => {
    const current = selectedForAttempts && brandAssessments.some((a) => a.id === selectedForAttempts.id)
      ? selectedForAttempts
      : brandAssessments[0] || null;
    const isSyncpedia = current ? isSyncpediaAssessment(current) : label.toLowerCase().includes("syncpedia");

    if (brandAssessments.length === 0) {
      return (
        <Card>
          <CardContent className="py-10 text-sm text-muted-foreground text-center">
            {isSuperAdmin
              ? `No ${label} assignments yet.`
              : "No assignments have been assigned to your account yet. Please contact a Super Admin."}
          </CardContent>
        </Card>
      );
    }

    return (
      <>
        {brandAssessments.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {brandAssessments.map((a) => (
              <Button
                key={a.id}
                type="button"
                size="sm"
                variant={current?.id === a.id ? "default" : "outline"}
                className={current?.id === a.id ? "bg-emerald-800 hover:bg-emerald-900" : ""}
                onClick={() => setSelectedId(a.id)}
              >
                {a.title}
              </Button>
            ))}
          </div>
        ) : null}

        {current ? (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="text-base">
                  {current.title} — Candidates
                </CardTitle>
                <CardDescription>
                  Everyone who took {current.title}. Showing {attemptRows.length}
                  {allAttemptRows.length !== attemptRows.length ? ` of ${allAttemptRows.length}` : ""}{" "}
                  ({periodLabel}). Click a row for full details.
                </CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5 shrink-0"
                disabled={attemptRows.length === 0}
                onClick={handleExportAttempts}
              >
                <Download className="h-3.5 w-3.5" />
                Export candidates
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5 min-w-[180px]">
                  <Label className="text-xs text-muted-foreground">Timeline</Label>
                  <Select value={attemptPeriod} onValueChange={(v) => setAttemptPeriod(v as AttemptPeriod)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PERIOD_LABELS) as AttemptPeriod[]).map((key) => (
                        <SelectItem key={key} value={key}>
                          {PERIOD_LABELS[key]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {attemptPeriod === "custom" ? (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">From</Label>
                      <Input
                        type="date"
                        className="h-9 w-[150px]"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">To</Label>
                      <Input
                        type="date"
                        className="h-9 w-[150px]"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                      />
                    </div>
                  </>
                ) : null}
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead>College / Institution</TableHead>
                      <TableHead>{isSyncpedia ? "Degree / Domain" : "Domain / Track"}</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Stars</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Attempted</TableHead>
                      {isSuperAdmin ? <TableHead className="text-right">Actions</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attemptRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isSuperAdmin ? 8 : 7} className="text-muted-foreground text-sm">
                          {allAttemptRows.length === 0
                            ? "No candidates have taken this assignment yet."
                            : `No candidates in ${periodLabel}. Try All time or another timeline.`}
                        </TableCell>
                      </TableRow>
                    ) : (
                      attemptRows.map((r) => (
                        <TableRow
                          key={r.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setDetailAttemptId(r.id)}
                        >
                          <TableCell>
                            <div className="font-medium text-sm">{r.full_name}</div>
                            <div className="text-xs text-muted-foreground">{r.email}</div>
                            {r.phone ? (
                              <div className="text-[11px] text-muted-foreground">{r.phone}</div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm font-medium max-w-[200px] truncate" title={r.college_name || "—"}>
                              {r.college_name || <span className="text-muted-foreground font-normal">—</span>}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            <div>{r.degree_branch || "—"}</div>
                            {r.graduation_year ? (
                              <div className="text-xs text-muted-foreground">Year: {r.graduation_year}</div>
                            ) : null}
                            {r.domain_key && r.domain_key !== "custom" ? (
                              <Badge variant="outline" className="text-[10px] mt-0.5">
                                {domains[r.domain_key] || r.domain_key}
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <span className="font-semibold">{r.score ?? "—"}</span>
                            {r.integrity_flag === "review" || r.integrity?.flag === "review" ? (
                              <div className="text-[10px] text-amber-700 font-medium">Review</div>
                            ) : null}
                          </TableCell>
                          <TableCell>{r.stars != null ? "★".repeat(r.stars) || "—" : "—"}</TableCell>
                          <TableCell>
                            <Badge variant={r.status === "submitted" ? "secondary" : "outline"}>{r.status}</Badge>
                            {r.attempt_phase ? (
                              <span className="ml-1 text-[10px] text-muted-foreground">{r.attempt_phase}</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {formatAttemptDate(r.created_at || r.started_at || r.submitted_at)}
                          </TableCell>
                          {isSuperAdmin ? (
                            <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                title="Delete candidate attempt"
                                disabled={deleteAttemptMut.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteAttempt(r);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-emerald-700" />
          Assignments
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isSuperAdmin
            ? "Assignments tab: create and open link/API keys. Peaklyy and Syncpedia Basics tabs: candidate lists for people who took those assignments."
            : "Assignments assigned to you: copy the candidate link and view details. Candidate rows appear below when people take the test."}
        </p>
      </div>

      {!isSuperAdmin ? (
        <div className="space-y-4">
          <AssignedAssignmentsCard variant="page" />
          {list.length > 0 ? renderBrandAttemptsPanel("Candidates", list) : null}
        </div>
      ) : (
        <Tabs
          value={adminTab}
          onValueChange={(v) => {
            const next = v as "assessments" | "peaklyy" | "syncpedia";
            setAdminTab(next);
            if (next === "peaklyy" && peaklyyList[0]) {
              setSelectedId(peaklyyList[0].id);
              setAttemptPeriod("all");
            }
            if (next === "syncpedia" && syncpediaList[0]) {
              setSelectedId(syncpediaList[0].id);
              setAttemptPeriod("all");
            }
          }}
          className="space-y-4"
        >
        <TabsList>
          <TabsTrigger value="assessments">Assignments</TabsTrigger>
          <TabsTrigger value="peaklyy">Peaklyy</TabsTrigger>
          <TabsTrigger value="syncpedia">Syncpedia Basics</TabsTrigger>
        </TabsList>

        <TabsContent value="assessments" className="space-y-4 mt-0">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create assignment</CardTitle>
            <CardDescription>
              New assignments use the Syncpedia candidate theme. Domain bank uses MCQs + practical tasks. Custom lets you add MCQs and/or notepad / file-upload questions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Question source</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={form.source_mode === "domain_bank" ? "default" : "outline"}
                  className={form.source_mode === "domain_bank" ? "bg-emerald-800 hover:bg-emerald-900" : ""}
                  onClick={() => setForm((f) => ({ ...f, source_mode: "domain_bank", title: "Syncpedia Assignment" }))}
                >
                  Domain bank
                </Button>
                <Button
                  type="button"
                  variant={form.source_mode === "custom" ? "default" : "outline"}
                  className={form.source_mode === "custom" ? "bg-emerald-800 hover:bg-emerald-900" : ""}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      source_mode: "custom",
                      title: f.title === "Syncpedia Assignment" ? "Custom Assignment" : f.title,
                    }))
                  }
                >
                  Custom questions
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {form.source_mode === "custom" ? (
                <div className="space-y-1.5">
                  <Label>Duration (minutes)</Label>
                  <Input
                    type="number"
                    min={5}
                    value={form.duration_minutes || 30}
                    onChange={(e) => setForm((f) => ({ ...f, duration_minutes: Number(e.target.value) || 30 }))}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Duration</Label>
                  <Input readOnly value="No time limit" />
                </div>
              )}
              {form.source_mode === "domain_bank" ? (
                <div className="space-y-1.5">
                  <Label>Questions per attempt</Label>
                  <Input type="number" readOnly value={30} />
                  <p className="text-[11px] text-muted-foreground">15 beginner MCQs + 1 practical task · untimed</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Questions</Label>
                  <Input readOnly value={`${customQuestions.filter((q) => q.prompt.trim()).length} custom`} />
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Result website URL (receives results + redirect after pass)</Label>
              <Input
                placeholder="https://peaklyy.com/assessment-callback"
                value={form.result_webhook_url}
                onChange={(e) => setForm((f) => ({ ...f, result_webhook_url: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Permanent API key + open link are auto-generated. Click an assignment on the right to view them.
              </p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label>Once per candidate</Label>
              <Switch
                checked={form.once_per_candidate}
                onCheckedChange={(v) => setForm((f) => ({ ...f, once_per_candidate: v }))}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label>Anti-cheat (tab / copy)</Label>
              <Switch checked={form.anti_cheat} onCheckedChange={(v) => setForm((f) => ({ ...f, anti_cheat: v }))} />
            </div>

            {form.source_mode === "custom" ? (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label className="text-sm font-medium">Custom questions</Label>
                  <div className="flex gap-1.5">
                    <Button type="button" size="sm" variant="outline" onClick={() => setCustomQuestions((q) => [...q, emptyQuestion("mcq")])}>
                      + MCQ
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setCustomQuestions((q) => [...q, emptyQuestion("notepad_upload")])}>
                      + Notepad / Upload
                    </Button>
                  </div>
                </div>
                <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                  {customQuestions.map((q, i) => {
                    const mode = resolveMode(q);
                    const isMcq = mode === "mcq";
                    return (
                      <div key={i} className="rounded-md border bg-muted/20 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline">Q{i + 1}</Badge>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive"
                            disabled={customQuestions.length <= 1}
                            onClick={() => setCustomQuestions((prev) => prev.filter((_, j) => j !== i))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <Textarea
                          placeholder="Question prompt"
                          value={q.prompt}
                          onChange={(e) => updateQuestion(i, { prompt: e.target.value })}
                          rows={2}
                        />
                        <div className="space-y-1.5">
                          <Label className="text-xs">Answer type</Label>
                          <Select
                            value={mode}
                            onValueChange={(v: PeaklyyResponseMode) => {
                              const next = emptyQuestion(v);
                              updateQuestion(i, {
                                ...next,
                                prompt: q.prompt,
                                points: v === "mcq" ? q.points || 5 : 0,
                              });
                            }}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="mcq">Multiple choice</SelectItem>
                              <SelectItem value="notepad">Notepad only</SelectItem>
                              <SelectItem value="upload">File upload only</SelectItem>
                              <SelectItem value="notepad_upload">Notepad + file upload</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {isMcq ? (
                          <>
                            <div className="grid grid-cols-2 gap-2">
                              {(["a", "b", "c", "d"] as const).map((key) => (
                                <Input
                                  key={key}
                                  placeholder={`Option ${key.toUpperCase()}`}
                                  value={q[`option_${key}`] || ""}
                                  onChange={(e) => updateQuestion(i, { [`option_${key}`]: e.target.value })}
                                />
                              ))}
                              <div className="col-span-2 flex items-center gap-2 flex-wrap">
                                <Label className="text-xs shrink-0">Correct</Label>
                                <Select
                                  value={q.correct_option || "a"}
                                  onValueChange={(v: "a" | "b" | "c" | "d") => updateQuestion(i, { correct_option: v })}
                                >
                                  <SelectTrigger className="h-8 w-[80px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(["a", "b", "c", "d"] as const).map((k) => (
                                      <SelectItem key={k} value={k}>
                                        {k.toUpperCase()}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Label className="text-xs shrink-0 ml-2">Points</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  className="h-8 w-20"
                                  value={q.points ?? 5}
                                  onChange={(e) => updateQuestion(i, { points: Number(e.target.value) || 5 })}
                                />
                              </div>
                            </div>
                            <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
                              <Checkbox
                                checked={!!q.allow_upload}
                                onCheckedChange={(v) => updateQuestion(i, { allow_upload: !!v })}
                              />
                              Enable file upload beside this question
                            </label>
                          </>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">
                            {mode === "notepad" && "Candidates type their answer in a notepad and click Save."}
                            {mode === "upload" && "Candidates upload a file for this question and click Save."}
                            {mode === "notepad_upload" &&
                              "Candidates type in a notepad, optionally upload a file, then click Save. Answers are stored for your review."}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Domains: {Object.values(domains).join(" · ") || "…"} — Part 1: 15 beginner MCQs (website score) · Part 2: 1
                task (notepad/upload, manual grading)
              </p>
            )}

            <Button
              className="w-full bg-emerald-800 hover:bg-emerald-900 gap-1.5"
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
            >
              <Plus className="h-4 w-4" /> Create
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active assignments</CardTitle>
            <CardDescription>Click an assignment to view its permanent link and API key.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : activeList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active assignments yet.</p>
            ) : (
              <div className="space-y-2 max-h-[520px] overflow-y-auto">
                {activeList.map((a) => (
                  <div
                    key={a.id}
                    className="w-full text-left rounded-lg border p-3 transition-colors hover:bg-muted/40 hover:border-emerald-600/50"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(a.id);
                        setLinkDialogId(a.id);
                      }}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-sm truncate">{a.title}</p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="outline">
                            {isSyncpediaAssessment(a) ? "Syncpedia" : a.source_mode === "custom" ? "Custom" : "Domain"}
                          </Badge>
                          <Badge variant="default">Active</Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {a.question_count} Q ·{" "}
                        {a.source_mode === "domain_bank" || !a.duration_minutes
                          ? "untimed"
                          : `${a.duration_minutes} min`}{" "}
                        · /{a.slug}
                      </p>
                    </button>
                    {isSuperAdmin && !isSystemAssignment(a) ? (
                      <div className="flex justify-end mt-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteAssessment(a);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {list.some((a) => !a.is_active) ? (
              <p className="text-[11px] text-muted-foreground">
                {list.filter((a) => !a.is_active).length} inactive assignment(s) hidden — open Peaklyy / Syncpedia tabs
                to manage attempts.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
        </TabsContent>

        <TabsContent value="peaklyy" className="mt-0 space-y-4">
          {renderBrandAttemptsPanel("Peaklyy", peaklyyList)}
        </TabsContent>

        <TabsContent value="syncpedia" className="mt-0 space-y-4">
          {renderBrandAttemptsPanel("Syncpedia Basics", syncpediaList)}
        </TabsContent>
      </Tabs>
      )}

      <Dialog open={!!linkDialogId} onOpenChange={(open) => { if (!open) setLinkDialogId(null); }}>
        <DialogContent className="max-w-lg w-[min(32rem,calc(100vw-1.25rem))] overflow-x-hidden overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-6 break-words">{linkDialogAssessment?.title || "Assignment link"}</DialogTitle>
            <DialogDescription className="break-words">
              Permanent candidate link and partner API key
              {linkDialogAssessment ? ` · /${linkDialogAssessment.slug}` : ""}
            </DialogDescription>
          </DialogHeader>
          {linkDialogAssessment ? (
            <div className="space-y-4 min-w-0">
              <div className="space-y-1.5 min-w-0">
                <Label className="text-xs">Permanent assessment link</Label>
                <div className="flex items-center gap-2 min-w-0">
                  <Input
                    readOnly
                    value={assessmentPublicPath(linkDialogAssessment)}
                    className="min-w-0 flex-1 text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => {
                      void navigator.clipboard.writeText(assessmentPublicPath(linkDialogAssessment));
                      toast({ title: "Link copied" });
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" className="shrink-0" asChild>
                    <a href={assessmentPublicPath(linkDialogAssessment)} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5 min-w-0">
                <Label className="text-xs">Permanent API key</Label>
                <div className="flex items-center gap-2 min-w-0">
                  <Input
                    readOnly
                    value={linkDialogAssessment.result_api_key || "(none — regenerate)"}
                    className="min-w-0 flex-1 text-xs font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    disabled={!linkDialogAssessment.result_api_key}
                    onClick={() => {
                      void navigator.clipboard.writeText(String(linkDialogAssessment.result_api_key || ""));
                      toast({ title: "API key copied" });
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                {linkDialogAssessment.result_api_key ? (
                  <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground space-y-1.5 leading-relaxed overflow-hidden">
                    <p className="font-medium text-foreground">Partner website</p>
                    <p className="break-all">
                      Header:{" "}
                      <code className="text-[10px]">X-Assessment-Api-Key: {linkDialogAssessment.result_api_key}</code>
                    </p>
                    <p className="break-all">
                      List attempts:{" "}
                      <code className="text-[10px]">GET /api/assessments.php?action=partner_attempts</code>
                    </p>
                    <p className="break-all">
                      Score JSON:{" "}
                      <code className="text-[10px]">
                        GET /api/assessments.php?action=partner_result&amp;attempt_id=…
                      </code>
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No API key yet — regenerate to create one.</p>
                )}
              </div>

              {isSuperAdmin && (
                <div className="space-y-2 border-t pt-3 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Label className="text-xs font-semibold flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                        Assign to Team Members
                      </Label>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Assigned members stay ticked until you uncheck and save. They see this assignment on their dashboard and Assignments page.
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[11px] font-mono shrink-0">
                      {assignedUserIds.length} assigned
                    </Badge>
                  </div>

                  <div className="relative min-w-0">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search team member by name, email, or role..."
                      value={assignSearch}
                      onChange={(e) => setAssignSearch(e.target.value)}
                      className="h-8 pl-8 text-xs"
                    />
                  </div>

                  <div className="max-h-56 overflow-y-auto overflow-x-hidden space-y-1 rounded-md border p-2 bg-muted/20">
                    {filteredTeamMembers.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        {teamMembers.length === 0 ? "Loading or no team members found" : "No matches found"}
                      </p>
                    ) : (
                      filteredTeamMembers.map((m: any) => {
                        const mId = assignmentUserId(m.id ?? m.user_id);
                        const checked = assignedUserIds.some((id) => assignmentUserId(id) === mId);
                        return (
                          <div
                            key={mId || m.email}
                            className="flex items-start gap-2 p-1.5 rounded hover:bg-muted/60 text-xs min-w-0"
                          >
                            <Checkbox
                              checked={checked}
                              className="mt-0.5 shrink-0"
                              onCheckedChange={(c) => {
                                if (!mId) return;
                                assignDirtyRef.current = true;
                                setAssignedUserIds((prev) =>
                                  !!c
                                    ? Array.from(new Set([...prev.map(assignmentUserId).filter(Boolean), mId]))
                                    : prev.map(assignmentUserId).filter((id) => id && id !== mId),
                                );
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-foreground truncate">
                                {m.full_name || m.email || "Team member"}
                              </p>
                              {m.email ? (
                                <p className="text-[10px] text-muted-foreground truncate">{m.email}</p>
                              ) : null}
                            </div>
                            <Badge variant="secondary" className="text-[10px] capitalize shrink-0 max-w-[38%] truncate">
                              {m.role ? String(m.role).replace(/_/g, " ") : "staff"}
                            </Badge>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button
                      type="button"
                      size="sm"
                      disabled={assignMut.isPending || !linkDialogAssessment}
                      className="bg-emerald-800 hover:bg-emerald-900 text-xs"
                      onClick={() => assignMut.mutate(assignedUserIds)}
                    >
                      {assignMut.isPending ? "Saving..." : "Save assignments"}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateMut.mutate({
                      id: linkDialogAssessment.id,
                      is_active: linkDialogAssessment.is_active ? 0 : 1,
                    })
                  }
                >
                  {linkDialogAssessment.is_active ? "Deactivate" : "Activate"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateMut.mutate({
                      id: linkDialogAssessment.id,
                      once_per_candidate: linkDialogAssessment.once_per_candidate ? 0 : 1,
                    })
                  }
                >
                  {linkDialogAssessment.once_per_candidate ? "Allow Re-attempts" : "Single Attempt Only"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={regenMut.isPending}
                  onClick={() => regenMut.mutate(linkDialogAssessment.id)}
                >
                  Regenerate API key
                </Button>
                {!isSystemAssignment(linkDialogAssessment) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                    onClick={() => setConfirmDeleteAssessment(linkDialogAssessment)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  className="bg-emerald-800 hover:bg-emerald-900"
                  onClick={() => {
                    setSelectedId(linkDialogAssessment.id);
                    setLinkDialogId(null);
                    setAdminTab(isSyncpediaAssessment(linkDialogAssessment) ? "syncpedia" : "peaklyy");
                  }}
                >
                  View attempts
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailAttemptId} onOpenChange={(open) => { if (!open) setDetailAttemptId(null); }}>
        <DialogContent className="max-w-3xl max-h-[90dvh] overflow-hidden flex flex-col p-0 gap-0">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-3 border-b space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
              <div className="min-w-0 space-y-1">
                <DialogTitle className="truncate">
                  {attemptDetail?.data?.full_name || "Candidate details"}
                </DialogTitle>
                <DialogDescription className="truncate">
                  {attemptDetail?.data?.email || "Loading attempt…"}
                  {attemptDetail?.data?.phone ? ` · ${attemptDetail.data.phone}` : ""}
                </DialogDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isSuperAdmin ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5 shrink-0 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                    disabled={deleteAttemptMut.isPending || !detailAttemptId}
                    onClick={() => {
                      if (attemptDetail?.data) setConfirmDeleteAttempt(attemptDetail.data);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete attempt
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className="gap-1.5 shrink-0"
                  disabled={zipBusy || detailLoading || !detailAttemptId}
                  onClick={() => void handleDownloadTasksZip()}
                >
                  <Download className="h-3.5 w-3.5" />
                  {zipBusy ? "Preparing ZIP…" : "Download all tasks (ZIP)"}
                </Button>
              </div>
            </div>
            {attemptDetail?.data ? (
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">Score {attemptDetail.data.score ?? "—"}</Badge>
                {attemptDetail.data.integrity_flag === "review" || attemptDetail.data.integrity?.flag === "review" ? (
                  <Badge variant="destructive">Review recommended</Badge>
                ) : null}
                <Badge variant="outline">
                  {attemptDetail.data.stars != null ? "★".repeat(attemptDetail.data.stars) || "0★" : "—"}
                </Badge>
                <Badge variant="outline">{attemptDetail.data.status}</Badge>
                {attemptDetail.data.passed != null ? (
                  <Badge variant={Number(attemptDetail.data.passed) ? "default" : "destructive"}>
                    {Number(attemptDetail.data.passed) ? "Passed" : "Not pass"}
                  </Badge>
                ) : null}
                <Badge variant="secondary">
                  {domains[attemptDetail.data.domain_key] || attemptDetail.data.domain_key}
                </Badge>
              </div>
            ) : null}
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {attemptDetail?.data && !detailLoading ? (
              <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-primary" />
                    Candidate Form & Registration Details
                  </h4>
                  {attemptDetail.data.attempt_phase ? (
                    <Badge variant="outline" className="text-xs capitalize">
                      Phase: {attemptDetail.data.attempt_phase}
                    </Badge>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground/70" />
                      College / University
                    </span>
                    <p className="font-medium text-foreground">
                      {attemptDetail.data.college_name || <span className="text-muted-foreground font-normal">Not specified</span>}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <GraduationCap className="h-3.5 w-3.5 text-muted-foreground/70" />
                      Degree & Branch
                    </span>
                    <p className="font-medium text-foreground">
                      {attemptDetail.data.degree_branch || <span className="text-muted-foreground font-normal">Not specified</span>}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground/70" />
                      Graduation Year
                    </span>
                    <p className="font-medium text-foreground">
                      {attemptDetail.data.graduation_year || <span className="text-muted-foreground font-normal">—</span>}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground/70" />
                      Phone Number
                    </span>
                    <p className="font-medium text-foreground">
                      {attemptDetail.data.phone ? (
                        <a href={`tel:${attemptDetail.data.phone}`} className="text-primary hover:underline">
                          {attemptDetail.data.phone}
                        </a>
                      ) : (
                        <span className="text-muted-foreground font-normal">—</span>
                      )}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground/70" />
                      Email Address
                    </span>
                    <p className="font-medium text-foreground truncate" title={attemptDetail.data.email}>
                      <a href={`mailto:${attemptDetail.data.email}`} className="text-primary hover:underline">
                        {attemptDetail.data.email}
                      </a>
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground/70" />
                      Time Taken
                    </span>
                    <p className="font-medium text-foreground">
                      {attemptDetail.data.time_taken_seconds != null
                        ? `${Math.floor(attemptDetail.data.time_taken_seconds / 60)}m ${attemptDetail.data.time_taken_seconds % 60}s`
                        : "—"}
                    </p>
                  </div>
                </div>

                {attemptDetail.data.interest_topics && attemptDetail.data.interest_topics.length > 0 ? (
                  <div className="pt-2 border-t space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      Selected Interest Topics
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {attemptDetail.data.interest_topics.map((topic, i) => (
                        <Badge key={i} variant="secondary" className="text-xs font-normal">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                {attemptDetail.data.integrity ? (
                  <div className="pt-2 border-t space-y-1.5 text-xs">
                    <p className="font-semibold text-foreground">
                      Integrity{" "}
                      {attemptDetail.data.integrity.flag === "review" ? (
                        <span className="text-amber-700">— review (two or more signals)</span>
                      ) : (
                        <span className="text-muted-foreground font-normal">— no combined flag</span>
                      )}
                    </p>
                    <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                      <li>Tab hides: {attemptDetail.data.integrity.tab_hides ?? 0}</li>
                      <li>
                        Hidden: {Math.round((attemptDetail.data.integrity.hidden_ms ?? 0) / 1000)}s
                      </li>
                      <li>Window blurs: {attemptDetail.data.integrity.blurs ?? 0}</li>
                      <li>Fast answers: {attemptDetail.data.integrity.fast_answers ?? 0}</li>
                      <li>Extension DOM: {attemptDetail.data.integrity.extension_dom ?? 0}</li>
                      <li>Chrome gap: {attemptDetail.data.integrity.resize_devtools ?? 0}</li>
                    </ul>
                    <p className="text-[11px] text-muted-foreground">
                      Flag is for manual review. It does not auto-fail the score.
                    </p>
                  </div>
                ) : null}

                {attemptDetail.data.violation_count ? (
                  <div className="pt-2 border-t flex items-center gap-2 text-xs text-amber-700 bg-amber-50 p-2 rounded">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>
                      <strong>{attemptDetail.data.violation_count} disturbance violation(s)</strong> detected during test (tab switches / focus lost).
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {(attemptDetail?.timeline?.length || attemptDetail?.data) && !detailLoading ? (
              <div className="rounded-md border bg-muted/10 p-3 space-y-2">
                <p className="text-sm font-semibold">Timeline</p>
                <ol className="relative border-l border-border ml-2 space-y-3">
                  {(attemptDetail?.timeline?.length
                    ? attemptDetail.timeline
                    : [
                        attemptDetail?.data?.created_at && {
                          at: attemptDetail.data.created_at,
                          event: "registered",
                          label: "Registered",
                        },
                        attemptDetail?.data?.started_at && {
                          at: attemptDetail.data.started_at,
                          event: "started",
                          label: "Started",
                        },
                        attemptDetail?.data?.mcq_submitted_at && {
                          at: attemptDetail.data.mcq_submitted_at,
                          event: "mcq_submitted",
                          label: "MCQ submitted",
                        },
                        attemptDetail?.data?.submitted_at && {
                          at: attemptDetail.data.submitted_at,
                          event: "completed",
                          label: "Completed",
                        },
                      ].filter(Boolean) as { at: string; event: string; label: string }[]
                  ).map((ev, i) => (
                    <li key={`${ev.event}-${i}`} className="relative ml-4">
                      <span className="absolute -left-[1.4rem] top-1.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-600" />
                      <p className="text-sm font-medium leading-tight">{ev.label}</p>
                      <p className="text-[11px] text-muted-foreground">{formatAttemptDate(ev.at)}</p>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {detailLoading ? (
              <p className="text-sm text-muted-foreground">Loading answers…</p>
            ) : (attemptDetail?.answers ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved answers for this attempt yet.</p>
            ) : (
              <div className="space-y-4">
                {([
                  {
                    title: "Part 1 — MCQ (website score)",
                    rows: attemptDetail?.mcq_answers ?? (attemptDetail?.answers ?? []).filter((a) => a.part !== "task"),
                  },
                  {
                    title: "Part 2 — Tasks (notepad .txt + uploads)",
                    rows: attemptDetail?.task_answers ?? (attemptDetail?.answers ?? []).filter((a) => a.part === "task"),
                  },
                ] as const).map((section) =>
                  section.rows.length === 0 ? null : (
                    <div key={section.title} className="space-y-2">
                      <p className="text-sm font-semibold">{section.title}</p>
                      {section.rows.map((a, idx) => {
                        const qLabel = a.question_number || idx + 1;
                        const npName = notepadDownloadName(attemptDetail?.data?.full_name, a);
                        return (
                          <div key={a.question_id} className="rounded-md border bg-muted/20 p-3 space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground">
                              Q{qLabel} · {a.q_type}
                            </p>
                            <p className="text-sm whitespace-pre-wrap">{a.prompt || "(no prompt)"}</p>
                            {a.answer_option ? (
                              <p className="text-sm">
                                <span className="text-muted-foreground">Selected: </span>
                                <span className="font-medium uppercase">{a.answer_option}</span>
                                {a.is_correct ? (
                                  <Badge className="ml-2" variant="default">
                                    Correct
                                  </Badge>
                                ) : null}
                              </p>
                            ) : null}
                            {a.text ? (
                              <div className="rounded-md bg-[#fffef5] border border-amber-200/80 p-3 shadow-sm">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <p className="text-[11px] uppercase tracking-wide text-amber-800/80 font-medium flex items-center gap-1">
                                    <FileText className="h-3.5 w-3.5" />
                                    Notepad · {npName}
                                  </p>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1 text-xs"
                                    onClick={() => {
                                      if (a.notepad_file_path) {
                                        void downloadProtectedUpload(a.notepad_file_path, npName).catch((e) =>
                                          toast({
                                            variant: "destructive",
                                            title: e instanceof Error ? e.message : "Download failed",
                                          }),
                                        );
                                      } else {
                                        downloadTextFile(a.text, npName);
                                      }
                                    }}
                                  >
                                    <FileDown className="h-3 w-3" />
                                    .txt
                                  </Button>
                                </div>
                                <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-foreground/90 max-h-48 overflow-y-auto">
                                  {a.text}
                                </pre>
                              </div>
                            ) : null}
                            {a.file_path ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                onClick={() =>
                                  void downloadProtectedUpload(a.file_path, a.file_name || undefined).catch((e) =>
                                    toast({
                                      variant: "destructive",
                                      title: e instanceof Error ? e.message : "Download failed",
                                    }),
                                  )
                                }
                              >
                                <FileDown className="h-3.5 w-3.5" />
                                {a.file_name || "Download upload"}
                              </Button>
                            ) : null}
                            {!a.answer_option && !a.text && !a.file_path ? (
                              <p className="text-xs text-muted-foreground">No answer recorded</p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmDeleteAttempt}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteAttempt(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Candidate Attempt</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the attempt for{" "}
              <span className="font-semibold text-foreground">
                {confirmDeleteAttempt?.full_name || "this candidate"}
              </span>{" "}
              ({confirmDeleteAttempt?.email})? All test submissions, task uploads, and recorded answers will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmDeleteAttempt(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleteAttemptMut.isPending}
              onClick={() => {
                if (confirmDeleteAttempt) {
                  deleteAttemptMut.mutate(confirmDeleteAttempt.id);
                }
              }}
            >
              {deleteAttemptMut.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmDeleteAssessment}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteAssessment(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete assignment</DialogTitle>
            <DialogDescription>
              Delete{" "}
              <span className="font-semibold text-foreground">
                {confirmDeleteAssessment?.title || "this assignment"}
              </span>
              ? Candidate attempts and team assignments for it will be removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDeleteAssessment(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleteAssessmentMut.isPending || !confirmDeleteAssessment}
              onClick={() => {
                if (confirmDeleteAssessment) {
                  deleteAssessmentMut.mutate(confirmDeleteAssessment.id);
                }
              }}
            >
              {deleteAssessmentMut.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
