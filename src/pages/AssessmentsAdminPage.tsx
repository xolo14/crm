import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Copy, Download, ExternalLink, FileDown, FileText, Plus, Trash2 } from "lucide-react";
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
    "Domain",
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
    r.domain_key === "custom" ? "Custom" : opts.domains[r.domain_key] || r.domain_key,
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

export default function AssessmentsAdminPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "Peaklyy Domain Screening",
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
  const [adminTab, setAdminTab] = useState<"assessments" | "attempts">("assessments");
  const [zipBusy, setZipBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["peaklyy", "assessments"],
    queryFn: assessmentsApi.list,
  });
  const list = data?.data ?? [];
  const domains = data?.domains ?? {};

  const selected = useMemo(
    () => list.find((a) => a.id === selectedId) || list[0] || null,
    [list, selectedId],
  );

  const { data: attemptsRes } = useQuery({
    queryKey: ["peaklyy", "attempts", selected?.id],
    queryFn: () => assessmentsApi.attempts(selected!.id),
    enabled: !!selected?.id,
  });

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
    if (!selected) return;
    if (attemptRows.length === 0) {
      toast({ variant: "destructive", title: "No attempts in this period", description: periodLabel });
      return;
    }
    exportAttemptsCsv(attemptRows, {
      assessmentSlug: selected.slug,
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
      });
    },
    onSuccess: (r) => {
      toast({
        title: "Assessment created",
        description: `${r.source_mode === "custom" ? "Custom" : "Domain bank"} · permanent API key · ${
          r.source_mode === "domain_bank" || !r.duration_minutes ? "untimed" : `${r.duration_minutes} min`
        } · ${r.question_count} questions`,
      });
      qc.invalidateQueries({ queryKey: ["peaklyy"] });
      setSelectedId(r.id);
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

  const publicPath =
    selected?.open_url ||
    (selected
      ? `${window.location.origin}/assessment/${selected.slug}${selected.result_api_key ? `#key=${encodeURIComponent(selected.result_api_key)}` : ""}`
      : "");
  const apiKey = selected?.result_api_key || "";

  const updateQuestion = (index: number, patch: Partial<PeaklyyCustomQuestionInput>) => {
    setCustomQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-emerald-700" />
          Peaklyy Assessments
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Keep domain-bank assessments (15 beginner MCQs + 1 task, untimed), or create timed custom MCQ assessments. Pass 70★ ·
          80★★ · 90★★★ · 100★★★★
        </p>
      </div>

      <Tabs value={adminTab} onValueChange={(v) => setAdminTab(v as "assessments" | "attempts")} className="space-y-4">
        <TabsList>
          <TabsTrigger value="assessments">Assessments</TabsTrigger>
          <TabsTrigger value="attempts" disabled={!selected}>
            Attempts{selected ? ` · ${selected.title}` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assessments" className="space-y-4 mt-0">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create assessment</CardTitle>
            <CardDescription>
              Domain bank uses Peaklyy MCQs + practical tasks. Custom lets you add MCQs and/or notepad / file-upload questions.
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
                  onClick={() => setForm((f) => ({ ...f, source_mode: "domain_bank", title: "Peaklyy Domain Screening" }))}
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
                      title: f.title === "Peaklyy Domain Screening" ? "Custom Assessment" : f.title,
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
                Permanent API key + open link are auto-generated. The key can fetch MCQ score and task uploads. On MCQ
                pass and again when tasks finish, results POST here (include score + uploads).
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
            <CardTitle className="text-base">Assessments</CardTitle>
            <CardDescription>Share the permanent link with candidates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : list.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assessments yet.</p>
            ) : (
              <div className="space-y-2 max-h-[360px] overflow-y-auto">
                {list.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(a.id);
                      setAdminTab("attempts");
                    }}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      selected?.id === a.id ? "border-emerald-600 bg-emerald-50" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm truncate">{a.title}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline">{a.source_mode === "custom" ? "Custom" : "Domain"}</Badge>
                        <Badge variant={a.is_active ? "default" : "secondary"}>{a.is_active ? "Active" : "Off"}</Badge>
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
                ))}
              </div>
            )}

            {selected ? (
              <div className="rounded-lg border p-3 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Permanent assessment link (opens test directly)</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={publicPath} className="text-xs" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        void navigator.clipboard.writeText(publicPath);
                        toast({ title: "Link copied" });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="outline" size="icon" asChild>
                      <a href={publicPath} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Permanent API key</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={apiKey || "(none — regenerate)"} className="text-xs font-mono" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={!apiKey}
                      onClick={() => {
                        void navigator.clipboard.writeText(apiKey);
                        toast({ title: "API key copied" });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground space-y-1.5 leading-relaxed">
                    <p className="font-medium text-foreground">Partner website — score + uploads via this key</p>
                    <p>
                      Header: <code className="text-[10px]">X-Assessment-Api-Key: {apiKey || "pkly_…"}</code> (or{" "}
                      <code className="text-[10px]">Authorization: Bearer …</code>)
                    </p>
                    <p>
                      List attempts:{" "}
                      <code className="text-[10px] break-all">GET /api/assessments.php?action=partner_attempts</code>
                    </p>
                    <p>
                      Score + uploads JSON:{" "}
                      <code className="text-[10px] break-all">
                        GET /api/assessments.php?action=partner_result&amp;attempt_id=…
                      </code>
                    </p>
                    <p>
                      Download a file:{" "}
                      <code className="text-[10px] break-all">
                        GET /api/assessments.php?action=partner_file&amp;attempt_id=…&amp;question_id=…
                      </code>{" "}
                      (same header)
                    </p>
                    <p>
                      Webhooks POST <code className="text-[10px]">score</code> after MCQ pass, then{" "}
                      <code className="text-[10px]">score + uploads[]</code> when tasks are submitted.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      updateMut.mutate({
                        id: selected.id,
                        is_active: selected.is_active ? 0 : 1,
                      })
                    }
                  >
                    {selected.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={regenMut.isPending}
                    onClick={() => regenMut.mutate(selected.id)}
                  >
                    Regenerate API key
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
        </TabsContent>

        <TabsContent value="attempts" className="mt-0 space-y-4">
      {selected ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Attempts — {selected.title}</CardTitle>
              <CardDescription>
                Click a candidate to open full details. Showing {attemptRows.length}
                {allAttemptRows.length !== attemptRows.length ? ` of ${allAttemptRows.length}` : ""} for{" "}
                {periodLabel}.
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
              Export this period
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5 min-w-[180px]">
                <Label className="text-xs text-muted-foreground">Timeline</Label>
                <Select
                  value={attemptPeriod}
                  onValueChange={(v) => setAttemptPeriod(v as AttemptPeriod)}
                >
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
                    <TableHead>Domain</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Stars</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempted</TableHead>
                    <TableHead>Webhook</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attemptRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-muted-foreground text-sm">
                        {allAttemptRows.length === 0
                          ? "No attempts yet."
                          : `No attempts in ${periodLabel}. Try another timeline.`}
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
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.domain_key === "custom" ? "Custom" : domains[r.domain_key] || r.domain_key}
                        </TableCell>
                        <TableCell>{r.score ?? "—"}</TableCell>
                        <TableCell>{r.stars != null ? "★".repeat(r.stars) || "—" : "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{r.status}</Badge>
                          {r.attempt_phase ? (
                            <span className="ml-1 text-[10px] text-muted-foreground">{r.attempt_phase}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatAttemptDate(r.created_at || r.started_at || r.submitted_at)}
                        </TableCell>
                        <TableCell className="text-xs">{r.webhook_status || "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10 text-sm text-muted-foreground text-center">
            Select an assessment first (Assessments tab).
          </CardContent>
        </Card>
      )}
        </TabsContent>
      </Tabs>

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
            {attemptDetail?.data ? (
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">Score {attemptDetail.data.score ?? "—"}</Badge>
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
    </div>
  );
}
