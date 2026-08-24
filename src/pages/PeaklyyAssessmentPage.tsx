import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Clock, ShieldAlert, Trophy } from "lucide-react";
import { assessmentsApi, type PeaklyyQuestion } from "@/services/assessments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import "./PeaklyyAssessment.css";

type Step = "register" | "instructions" | "test" | "mcq_result" | "task_instructions" | "result";

async function enterFullscreen(): Promise<boolean> {
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  try {
    if (document.fullscreenElement) return true;
    if (el.requestFullscreen) {
      await el.requestFullscreen();
      return true;
    }
    if (el.webkitRequestFullscreen) {
      await Promise.resolve(el.webkitRequestFullscreen());
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function exitFullscreenSafe() {
  if (!document.fullscreenElement) return;
  void document.exitFullscreen?.().catch(() => undefined);
}

export default function PeaklyyAssessmentPage() {
  const { slug = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const accessKey = useMemo(() => {
    const fromQuery = searchParams.get("key") || "";
    let fromHash = "";
    if (typeof window !== "undefined" && window.location.hash) {
      const raw = window.location.hash.replace(/^#/, "");
      const hp = new URLSearchParams(raw.includes("=") ? raw : `key=${raw}`);
      fromHash = hp.get("key") || (raw.startsWith("key=") ? decodeURIComponent(raw.slice(4)) : "");
    }
    return fromHash || fromQuery || "";
  }, [searchParams]);

  // Migrate legacy ?key= into #key= so the secret never stays in query/access logs.
  useEffect(() => {
    const qKey = searchParams.get("key");
    if (!qKey) return;
    const next = new URLSearchParams(searchParams);
    next.delete("key");
    setSearchParams(next, { replace: true });
    const hash = `#key=${encodeURIComponent(qKey)}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    }
  }, [searchParams, setSearchParams]);

  const { toast } = useToast();
  const [step, setStep] = useState<Step>("register");
  const [attemptToken, setAttemptToken] = useState("");
  const [reg, setReg] = useState({
    full_name: "",
    email: "",
    phone: "",
    domain_key: "",
    degree_branch: "",
    college_name: "",
  });
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<PeaklyyQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [savingQ, setSavingQ] = useState(false);
  const [idx, setIdx] = useState(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [domainLabel, setDomainLabel] = useState("");
  const [antiCheat, setAntiCheat] = useState(true);
  const [result, setResult] = useState<{
    score: number;
    stars: number;
    passed: boolean;
    time_taken_seconds: number;
    redirect_url: string | null;
    phase?: string;
    tasks_submitted?: boolean;
  } | null>(null);
  const [testPhase, setTestPhase] = useState<"mcq" | "task" | "single">("mcq");
  const [partTitle, setPartTitle] = useState("");
  const pendingRedirectRef = useRef<string | null>(null);

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const submittingRef = useRef(false);
  const stepRef = useRef(step);
  stepRef.current = step;
  /** Native file dialog exits fullscreen / may hide the tab — do not treat as cheating. */
  const filePickerGraceRef = useRef(false);
  const filePickerCleanupRef = useRef<(() => void) | null>(null);
  const antiCheatRef = useRef(antiCheat);
  antiCheatRef.current = antiCheat;

  const { data, isLoading, error } = useQuery({
    queryKey: ["peaklyy-public", slug, accessKey],
    queryFn: () => assessmentsApi.publicGet(slug, accessKey || undefined),
    enabled: !!slug,
  });

  const assessment = data?.data;
  const domains = data?.domains ?? {};
  const degrees = data?.degrees ?? [];
  const isCustom = (assessment?.source_mode || "domain_bank") === "custom";
  const passScore = Number(assessment?.pass_score) || 70;

  const displayInstructions = useMemo(() => {
    if (!assessment) return data?.instructions ?? [];
    if (data?.instructions?.length) return data.instructions;
    const duration = Number(assessment.duration_minutes) || 0;
    const qCount = Number(assessment.question_count) || 30;
    const pass = Number(assessment.pass_score) || 70;
    const lines: string[] = [];
    if (duration > 0) {
      lines.push(`Duration: ${duration} minutes`);
    } else {
      lines.push("No time limit — submit when you finish");
    }
    if (isCustom) {
      lines.push(`${qCount} MCQ question${qCount === 1 ? "" : "s"}`);
    } else {
      lines.push("15 beginner MCQ questions + 1 practical task for your domain");
      lines.push("MCQs are auto-scored; practical tasks are recorded for review");
    }
    lines.push(
      "Full screen required once the test starts",
      "No tab switching or leaving the page",
      "Copy and paste is disabled",
      "Leaving or switching tabs auto-submits the test",
      "Uploading a task file stays in the test — it does not submit the whole assessment",
      assessment.once_per_candidate
        ? "Test allowed only once per candidate"
        : "Multiple attempts may be allowed",
      `Score ${pass}+ to pass (1★ at 70, 2★ at 80, 3★ at 90, 4★ at 100). Below ${pass} = Not pass`,
    );
    return lines;
  }, [assessment, data?.instructions, isCustom]);

  useEffect(() => {
    if (isCustom) {
      setReg((r) => (r.domain_key === "custom" ? r : { ...r, domain_key: "custom" }));
    }
  }, [isCustom]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const remaining = endsAt ? Math.max(0, Math.floor((endsAt - now) / 1000)) : 0;
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  const submitAll = useCallback(async () => {
    if (!attemptToken || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const res = await assessmentsApi.submit(attemptToken, answersRef.current);
      if (res.next_phase === "task") {
        exitFullscreenSafe();
        pendingRedirectRef.current = res.redirect_url;
        setResult({
          score: res.score,
          stars: res.stars,
          passed: res.passed,
          time_taken_seconds: res.time_taken_seconds,
          redirect_url: res.redirect_url,
          phase: "mcq",
        });
        if (res.task_questions?.length) {
          (window as unknown as { __pkTaskQs?: PeaklyyQuestion[] }).__pkTaskQs = res.task_questions;
        }
        setStep("mcq_result");
        submittingRef.current = false;
        return;
      }
      exitFullscreenSafe();
      setResult({
        score: res.score,
        stars: res.stars,
        passed: res.passed,
        time_taken_seconds: res.time_taken_seconds,
        redirect_url: res.redirect_url || pendingRedirectRef.current,
        phase: res.phase,
        tasks_submitted: res.tasks_submitted,
      });
      setStep("result");
      const redirectTo = res.redirect_url || pendingRedirectRef.current;
      if (res.passed && redirectTo && !res.tasks_submitted && res.phase !== "task") {
        window.setTimeout(() => {
          window.location.href = redirectTo;
        }, 2500);
      }
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Submit failed" });
      submittingRef.current = false;
    } finally {
      setBusy(false);
    }
  }, [attemptToken, toast]);

  useEffect(() => {
    if (step !== "test" || !endsAt) return;
    if (remaining <= 0) void submitAll();
  }, [remaining, endsAt, step, submitAll]);

  useEffect(() => {
    if (step !== "test") return;

    const forceSubmit = (reason: string) => {
      if (stepRef.current !== "test" || submittingRef.current) return;
      if (filePickerGraceRef.current) return;
      void assessmentsApi.violation(attemptToken).catch(() => undefined);
      toast({
        variant: "destructive",
        title: reason,
        description: "Test is being submitted.",
      });
      void submitAll();
    };

    const onVis = () => {
      if (!antiCheat) return;
      if (filePickerGraceRef.current) return;
      if (document.hidden) forceSubmit("Tab / window switch detected");
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };

    const onFsChange = () => {
      if (!antiCheat) return;
      if (filePickerGraceRef.current) return;
      if (!document.fullscreenElement && stepRef.current === "test") {
        forceSubmit("Fullscreen exited");
      }
    };

    const isAnswerField = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === "TEXTAREA" || tag === "INPUT" || !!t.closest("textarea, input");
    };
    const block = (e: Event) => {
      if (isAnswerField(e.target)) return;
      e.preventDefault();
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (isAnswerField(e.target)) {
        if (e.key === "F5" || e.key === "Escape") e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ["c", "v", "x", "a", "C", "V", "X", "A", "w", "W", "r", "R"].includes(e.key)) {
        e.preventDefault();
      }
      if (e.key === "F5" || e.key === "Escape") {
        e.preventDefault();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("copy", block);
    document.addEventListener("paste", block);
    document.addEventListener("cut", block);
    document.addEventListener("contextmenu", block);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("copy", block);
      document.removeEventListener("paste", block);
      document.removeEventListener("cut", block);
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("keydown", onKey);
    };
  }, [step, antiCheat, attemptToken, toast, submitAll]);

  useEffect(() => {
    if (step !== "test") exitFullscreenSafe();
  }, [step]);

  const current = questions[idx];
  const progress = questions.length ? ((idx + 1) / questions.length) * 100 : 0;
  const showNotepad = !!(current && (current.allow_notepad || current.q_type === "task"));
  const showUpload = !!(current && current.allow_upload);

  const currentAnswerObj = useMemo(() => {
    if (!current) return { text: "", option: "", file_path: "", file_name: "" };
    const raw = answers[current.id];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const o = raw as Record<string, unknown>;
      return {
        text: String(o.text ?? ""),
        option: String(o.option ?? o.answer_option ?? ""),
        file_path: String(o.file_path ?? ""),
        file_name: String(o.file_name ?? ""),
      };
    }
    if (typeof raw === "string") {
      if (current.q_type === "mcq" && ["a", "b", "c", "d"].includes(raw)) {
        return { text: "", option: raw, file_path: "", file_name: "" };
      }
      return { text: raw, option: "", file_path: "", file_name: "" };
    }
    return { text: "", option: "", file_path: "", file_name: "" };
  }, [answers, current]);

  const patchCurrentAnswer = (patch: Record<string, unknown>) => {
    if (!current) return;
    setAnswers((prev) => {
      const raw = prev[current.id];
      const base =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? { ...(raw as Record<string, unknown>) }
          : typeof raw === "string" && current.q_type === "mcq"
            ? { option: raw }
            : typeof raw === "string"
              ? { text: raw }
              : {};
      return { ...prev, [current.id]: { ...base, ...patch } };
    });
    setSavedIds((s) => ({ ...s, [current.id]: false }));
  };

  const endFilePickerGrace = useCallback(() => {
    filePickerCleanupRef.current?.();
    filePickerCleanupRef.current = null;
    // Keep grace until after we restore fullscreen so late exit events cannot auto-submit
    window.setTimeout(() => {
      void (async () => {
        if (stepRef.current === "test" && antiCheatRef.current && !document.fullscreenElement) {
          await enterFullscreen().catch(() => undefined);
        }
        filePickerGraceRef.current = false;
      })();
    }, 600);
  }, []);

  const beginFilePickerGrace = useCallback(() => {
    filePickerCleanupRef.current?.();
    filePickerGraceRef.current = true;
    const onFocus = () => endFilePickerGrace();
    const onVis = () => {
      if (!document.hidden) endFilePickerGrace();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    const timeout = window.setTimeout(() => endFilePickerGrace(), 120_000);
    filePickerCleanupRef.current = () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.clearTimeout(timeout);
    };
  }, [endFilePickerGrace]);

  const saveCurrentQuestion = async (opts?: { file?: File | null; advance?: boolean }) => {
    if (!current || !attemptToken) return false;
    const fileToUpload = opts?.file !== undefined ? opts.file : pendingFile;
    setSavingQ(true);
    try {
      if (showUpload && fileToUpload) {
        const res = await assessmentsApi.uploadAnswer(
          attemptToken,
          current.id,
          fileToUpload,
          showNotepad ? currentAnswerObj.text : undefined,
        );
        patchCurrentAnswer({
          text: currentAnswerObj.text,
          file_path: res.file_path,
          file_name: res.file_name,
          ...(currentAnswerObj.option ? { option: currentAnswerObj.option } : {}),
        });
        setPendingFile(null);
      } else {
        await assessmentsApi.saveAnswer(attemptToken, {
          question_id: current.id,
          text: showNotepad ? currentAnswerObj.text : undefined,
          option: current.q_type === "mcq" ? currentAnswerObj.option || undefined : undefined,
        });
      }
      if (current.q_type === "mcq" && currentAnswerObj.option) {
        await assessmentsApi.saveAnswer(attemptToken, {
          question_id: current.id,
          option: currentAnswerObj.option,
          text: showNotepad ? currentAnswerObj.text : undefined,
        });
      }
      setSavedIds((s) => ({ ...s, [current.id]: true }));
      toast({ title: opts?.file ? "File uploaded" : "Answer saved" });
      if (opts?.advance && idx < questions.length - 1) {
        setIdx((i) => Math.min(questions.length - 1, i + 1));
      }
      return true;
    } catch (e) {
      toast({
        variant: "destructive",
        title: e instanceof Error ? e.message : "Could not save answer",
      });
      return false;
    } finally {
      setSavingQ(false);
    }
  };

  const onTaskFileChosen = async (file: File | null) => {
    endFilePickerGrace();
    if (!file || !current) {
      setPendingFile(null);
      return;
    }
    setPendingFile(file);
    setSavedIds((s) => ({ ...s, [current.id]: false }));
    // Upload immediately and move to next task (do not submit the whole test)
    await saveCurrentQuestion({ file, advance: true });
  };

  // Clear pending file when navigating questions
  useEffect(() => {
    setPendingFile(null);
  }, [idx]);

  const starRow = useMemo(() => {
    const n = result?.stars ?? 0;
    return "★".repeat(n) + "☆".repeat(Math.max(0, 4 - n));
  }, [result]);

  if (isLoading) {
    return (
      <div className="pk-page pk-center-wrap">
        <div className="pk-card">
          <div className="pk-body text-center text-sm" style={{ color: "var(--pk-muted)" }}>
            Loading assessment…
          </div>
        </div>
      </div>
    );
  }
  if (error || !assessment) {
    return (
      <div className="pk-page pk-center-wrap">
        <div className="pk-card">
          <div className="pk-body text-center space-y-2">
            <p className="font-semibold">Assessment not found</p>
            <p className="text-sm" style={{ color: "var(--pk-muted)" }}>
              {error instanceof Error ? error.message : "Invalid link"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const brandName = assessment.brand_name || "Peaklyy";
  const brandPeak = brandName.toLowerCase().startsWith("peak") ? brandName.slice(0, 4) : brandName.slice(0, Math.max(1, Math.ceil(brandName.length / 2)));
  const brandLyy = brandName.slice(brandPeak.length);

  const brandPanel = (
    <aside className="pk-brand">
      <div className="pk-brand-logo" aria-label={brandName}>
        <span className="pk-brand-peak">{brandPeak}</span>
        <span className="pk-brand-lyy">{brandLyy || "lyy"}</span>
      </div>
      <span className="pk-badge">AI-Powered Career Bridge</span>
      <h1>Build real career proof with domain screening.</h1>
      <p>
        {assessment.brand_tagline || "Learn · Earn · Grow"} —{" "}
        {isCustom
          ? "custom assessment with your questions, timed scoring, and star ratings."
          : "beginner-friendly domain screening with 15 MCQs + 1 practical task."}
      </p>
      <div className="pk-social-row">
        <span className="pk-social-dot" aria-hidden />
        <span className="pk-social-label">Assessment portal</span>
      </div>
      <div className="pk-feature">
        <strong>Candidates</strong>
        <span>Show skills through scored MCQs and practical domain tasks.</span>
      </div>
      <div className="pk-footer-strip">Start your career journey today</div>
    </aside>
  );

  return (
    <div className={cn("pk-page", step === "test" && "pk-page-exam")}>
      {step === "register" || step === "instructions" ? (
        <div className="pk-shell">
          {brandPanel}
          <div className="pk-main">
            {step === "register" ? (
              <div className="pk-card overflow-hidden">
                <div className="pk-header">Candidate Registration</div>
                <div className="pk-body space-y-3">
                  <p className="text-xs text-center font-medium" style={{ color: "var(--pk-muted)" }}>
                    {isCustom ? "Custom assessment · Peaklyy" : "Domain screening · Peaklyy"}
                  </p>
                  <Field label="Full Name">
                    <Input
                      placeholder="Enter your full name"
                      value={reg.full_name}
                      onChange={(e) => setReg((r) => ({ ...r, full_name: e.target.value }))}
                    />
                  </Field>
                  <Field label="Email Address">
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      value={reg.email}
                      onChange={(e) => setReg((r) => ({ ...r, email: e.target.value }))}
                    />
                  </Field>
                  <Field label="Phone Number">
                    <Input
                      placeholder="10-digit number"
                      value={reg.phone}
                      onChange={(e) => setReg((r) => ({ ...r, phone: e.target.value }))}
                    />
                  </Field>
                  {!isCustom ? (
                    <Field label="Domain">
                      <Select value={reg.domain_key} onValueChange={(v) => setReg((r) => ({ ...r, domain_key: v }))}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select domain" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(domains).map(([k, label]) => (
                            <SelectItem key={k} value={k}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : null}
                  <Field label="Degree / Branch">
                    <Select value={reg.degree_branch} onValueChange={(v) => setReg((r) => ({ ...r, degree_branch: v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select degree/branch" />
                      </SelectTrigger>
                      <SelectContent>
                        {degrees.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="College Name">
                    <Input
                      placeholder="Enter your college name"
                      value={reg.college_name}
                      onChange={(e) => setReg((r) => ({ ...r, college_name: e.target.value }))}
                    />
                  </Field>
                  <Button
                    className="w-full pk-btn mt-2"
                    disabled={busy}
                    onClick={async () => {
                      if (!isCustom && !reg.domain_key) {
                        toast({ variant: "destructive", title: "Please select a domain" });
                        return;
                      }
                      setBusy(true);
                      try {
                        const res = await assessmentsApi.register({
                          slug,
                          ...reg,
                          domain_key: isCustom ? "custom" : reg.domain_key,
                        });
                        setAttemptToken(res.attempt_token);
                        setStep("instructions");
                      } catch (e) {
                        toast({
                          variant: "destructive",
                          title: e instanceof Error ? e.message : "Registration failed",
                        });
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Begin Assessment →
                  </Button>
                </div>
              </div>
            ) : (
              <div className="pk-card overflow-hidden">
                <div className="pk-header">Before you start</div>
                <div className="pk-body space-y-5">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">
                      {assessment.title || "Domain Screening Assessment"}
                    </h2>
                    <p className="text-sm mt-1" style={{ color: "var(--pk-muted)" }}>
                      Please review the instructions below before proceeding.
                    </p>
                  </div>
                  <ul className="pk-instr-list">
                    {displayInstructions.map((line) => (
                      <li key={line}>
                        <ShieldAlert className="h-4 w-4" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full pk-btn"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const ok = await enterFullscreen();
                        if (!ok) {
                          toast({
                            variant: "destructive",
                            title: "Fullscreen required",
                            description: "Allow fullscreen to start the assessment.",
                          });
                          setBusy(false);
                          return;
                        }
                        const res = await assessmentsApi.start(attemptToken);
                        setQuestions(res.questions);
                        setEndsAt(res.ends_at ? new Date(res.ends_at).getTime() : null);
                        setDomainLabel(res.domain_label);
                        setAntiCheat(res.anti_cheat);
                        const p = (res.phase === "task" ? "task" : res.phase === "single" ? "single" : "mcq") as
                          | "mcq"
                          | "task"
                          | "single";
                        setTestPhase(p);
                        setPartTitle(res.title || (p === "mcq" ? "Part 1 — MCQ test" : "Assessment"));
                        setAnswers({});
                        setSavedIds({});
                        setIdx(0);
                        setStep("test");
                      } catch (e) {
                        exitFullscreenSafe();
                        toast({
                          variant: "destructive",
                          title: e instanceof Error ? e.message : "Could not start",
                        });
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {isCustom ? "Start Test →" : "Start Part 1 — MCQ Test →"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {step === "test" && current ? (
        <div className="pk-center-wrap pk-exam-wrap">
          <div className="pk-test">
            <div className="pk-test-top">
              <span>
                {partTitle ? `${partTitle} · ` : ""}
                Question {idx + 1} of {questions.length}
              </span>
              {endsAt ? (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  {mm}:{ss}
                </span>
              ) : (
                <span className="text-sm" style={{ color: "var(--pk-muted)" }}>
                  Untimed
                </span>
              )}
            </div>
            <div className="pk-progress">
              <div style={{ width: `${progress}%` }} />
            </div>
            <div className="pk-test-body">
              <p className="pk-subject">
                {domainLabel.toUpperCase()} · {(current.level_key || "custom").toUpperCase()} ·{" "}
                {(current.q_type || "mcq").toUpperCase()}
                {showNotepad ? " · NOTEPAD" : ""}
                {showUpload ? " · UPLOAD" : ""}
              </p>
              <h2 className="pk-q" style={{ whiteSpace: "pre-wrap" }}>
                {current.prompt}
              </h2>

              {current.q_type === "mcq" && current.options ? (
                <div className="space-y-2.5 mt-5">
                  {Object.entries(current.options).map(([k, text]) => {
                    const selected = currentAnswerObj.option === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        className={cn("pk-option", selected && "pk-option-active")}
                        onClick={() => {
                          if (showNotepad || showUpload) {
                            patchCurrentAnswer({ option: k });
                          } else {
                            setAnswers((a) => ({ ...a, [current.id]: k }));
                            setSavedIds((s) => ({ ...s, [current.id]: false }));
                          }
                        }}
                      >
                        <span className="pk-opt-letter">{k.toUpperCase()}.</span>
                        <span>{text}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {showNotepad ? (
                <div className="mt-5 space-y-2">
                  <Label htmlFor="pk-task-answer">Notepad — type your answer</Label>
                  <Textarea
                    id="pk-task-answer"
                    rows={10}
                    className="min-h-[180px] text-sm"
                    placeholder="Type or paste your solution here…"
                    value={currentAnswerObj.text}
                    onChange={(e) => patchCurrentAnswer({ text: e.target.value })}
                  />
                </div>
              ) : null}

              {showUpload ? (
                <div className="mt-4 space-y-2">
                  <Label htmlFor="pk-task-file">Upload file (PDF, Word, image, text, or ZIP · max 5MB)</Label>
                  <Input
                    id="pk-task-file"
                    type="file"
                    accept=".pdf,.doc,.docx,.txt,.zip,.jpg,.jpeg,.png,.webp"
                    disabled={savingQ || busy}
                    onClick={() => beginFilePickerGrace()}
                    onKeyDown={() => beginFilePickerGrace()}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      e.target.value = "";
                      void onTaskFileChosen(f);
                    }}
                  />
                  <p className="text-xs" style={{ color: "var(--pk-muted)" }}>
                    Choosing a file uploads it and moves to the next task. It does not submit the whole test.
                  </p>
                  {pendingFile ? (
                    <p className="text-xs" style={{ color: "var(--pk-muted)" }}>
                      Uploading: {pendingFile.name}…
                    </p>
                  ) : null}
                  {currentAnswerObj.file_path ? (
                    <p className="text-xs font-medium text-emerald-700">
                      Saved file: {currentAnswerObj.file_name || "uploaded"}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {showNotepad || showUpload ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    className="pk-btn"
                    disabled={savingQ || busy}
                    onClick={() => void saveCurrentQuestion()}
                  >
                    {savingQ ? "Saving…" : "Save answer"}
                  </Button>
                  {savedIds[current.id] ? (
                    <span className="text-xs font-medium text-emerald-700">Saved — we received this answer</span>
                  ) : (
                    <span className="text-xs" style={{ color: "var(--pk-muted)" }}>
                      Save notepad text, or upload a file to auto-save and continue
                    </span>
                  )}
                </div>
              ) : null}

              <div className="flex items-center justify-between mt-6 gap-2">
                <Button
                  disabled={idx === 0}
                  onClick={() => setIdx((i) => Math.max(0, i - 1))}
                  className="gap-1 pk-btn-ghost"
                >
                  <ArrowLeft className="h-4 w-4" /> Previous
                </Button>
                {idx < questions.length - 1 ? (
                  <Button className="pk-btn gap-1" onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))}>
                    Next <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button className="pk-btn" disabled={busy} onClick={() => void submitAll()}>
                    {testPhase === "task"
                      ? "Submit tasks →"
                      : testPhase === "mcq"
                        ? "Submit MCQ test →"
                        : "Submit assessment →"}
                  </Button>
                )}
              </div>

              <div className="pk-grid mt-6">
                {questions.map((q, i) => (
                  <button
                    key={q.id}
                    type="button"
                    className={cn(
                      "pk-grid-btn",
                      i === idx && "active",
                      (() => {
                        const v = answers[q.id];
                        if (v == null || v === "") return false;
                        if (typeof v === "object" && !Array.isArray(v)) {
                          const o = v as Record<string, unknown>;
                          return !!(o.text || o.option || o.file_path || o.answer_option);
                        }
                        return true;
                      })() && "answered",
                    )}
                    onClick={() => setIdx(i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {step === "mcq_result" && result ? (
        <div className="pk-center-wrap">
          <div className="w-full max-w-md space-y-4">
            <div className="pk-card overflow-hidden">
              <div className="pk-header text-center py-5 space-y-1">
                <Trophy className="h-8 w-8 mx-auto text-white" />
                <div className="text-lg font-bold">Part 1 complete — MCQ results</div>
              </div>
              <div className="pk-body text-center space-y-3">
                <p className="text-4xl font-bold">{result.score} / 100</p>
                <p className="text-2xl pk-result-stars">{starRow}</p>
                <p
                  className="text-base font-semibold"
                  style={{ color: result.passed ? "var(--pk-red)" : "#ff6b6b" }}
                >
                  {result.passed ? "Passed (MCQ)" : `Not pass (below ${passScore})`}
                </p>
                <p className="text-sm" style={{ color: "var(--pk-muted)" }}>
                  These MCQ results {result.passed ? "are sent to the partner website" : "were recorded"}. Next:
                  complete 1 practical task (notepad / file upload) for manual grading.
                </p>
                <Button
                  className="w-full pk-btn"
                  onClick={() => {
                    setStep("task_instructions");
                  }}
                >
                  Continue to Part 2 — Tasks →
                </Button>
                {result.passed && result.redirect_url ? (
                  <Button variant="outline" className="w-full" asChild>
                    <a href={result.redirect_url}>Open partner website now</a>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {step === "task_instructions" ? (
        <div className="pk-center-wrap">
          <div className="pk-card overflow-hidden w-full max-w-lg">
            <div className="pk-header">Part 2 — Practical tasks</div>
            <div className="pk-body space-y-4">
              <p className="text-sm" style={{ color: "var(--pk-muted)" }}>
                Answer each task in the notepad and/or upload your file, then click <strong>Save answer</strong>. When
                finished, submit the task test. Reviewers will grade uploads separately from your MCQ score.
              </p>
              <ul className="pk-instr-list">
                <li>
                  <ShieldAlert className="h-4 w-4" />
                  <span>5 domain tasks · notepad and file upload</span>
                </li>
                <li>
                  <ShieldAlert className="h-4 w-4" />
                  <span>Not auto-scored — saved for manual grading</span>
                </li>
                <li>
                  <ShieldAlert className="h-4 w-4" />
                  <span>Fullscreen and anti-cheat still apply</span>
                </li>
              </ul>
              <Button
                className="w-full pk-btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const ok = await enterFullscreen();
                    if (!ok) {
                      toast({
                        variant: "destructive",
                        title: "Fullscreen required",
                        description: "Allow fullscreen to start the task test.",
                      });
                      setBusy(false);
                      return;
                    }
                    const cached = (window as unknown as { __pkTaskQs?: PeaklyyQuestion[] }).__pkTaskQs;
                    const res = await assessmentsApi.start(attemptToken, "task");
                    setQuestions(res.questions?.length ? res.questions : cached || []);
                    setEndsAt(res.ends_at ? new Date(res.ends_at).getTime() : null);
                    setDomainLabel(res.domain_label);
                    setAntiCheat(res.anti_cheat);
                    setTestPhase("task");
                    setPartTitle(res.title || "Part 2 — Practical tasks");
                    setAnswers({});
                    setSavedIds({});
                    setIdx(0);
                    setStep("test");
                    submittingRef.current = false;
                  } catch (e) {
                    exitFullscreenSafe();
                    toast({
                      variant: "destructive",
                      title: e instanceof Error ? e.message : "Could not start tasks",
                    });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Start Part 2 — Tasks →
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {step === "result" && result ? (
        <div className="pk-center-wrap">
          <div className="w-full max-w-md space-y-4">
            <div className="pk-card overflow-hidden">
              <div className="pk-header text-center py-5 space-y-1">
                <Trophy className="h-8 w-8 mx-auto text-white" />
                <div className="text-lg font-bold">
                  {result.tasks_submitted ? "All parts completed" : "Assessment Completed"}
                </div>
              </div>
              <div className="pk-body text-center space-y-3">
                <p className="text-4xl font-bold">{result.score} / 100</p>
                <p className="text-2xl pk-result-stars">{starRow}</p>
                <p
                  className="text-base font-semibold"
                  style={{ color: result.passed ? "var(--pk-red)" : "#ff6b6b" }}
                >
                  {result.passed ? "MCQ Passed" : `MCQ Not pass (below ${passScore})`}
                </p>
                <p className="text-sm" style={{ color: "var(--pk-muted)" }}>
                  Time taken: {Math.floor(result.time_taken_seconds / 60)}m {result.time_taken_seconds % 60}s
                </p>
                <div className="pt-2">
                  <p className="font-semibold">Thank you!</p>
                  <p className="text-sm mt-1" style={{ color: "var(--pk-muted)" }}>
                    {result.tasks_submitted
                      ? "Your practical tasks and uploads are saved for reviewer grading. MCQ results were sent to the partner website when Part 1 was completed."
                      : result.passed
                        ? "You passed. Results are being sent to the partner website via API key. Redirecting…"
                        : `Score below ${passScore} is Not pass. Your responses have been recorded.`}
                  </p>
                </div>
              </div>
            </div>

            {(result.redirect_url || pendingRedirectRef.current) && result.passed ? (
              <div className="pk-card">
                <div className="pk-body text-center space-y-2">
                  <p className="font-semibold" style={{ color: "var(--pk-red)" }}>
                    Continue to partner website
                  </p>
                  <Button className="pk-btn w-full" asChild>
                    <a href={result.redirect_url || pendingRedirectRef.current || "#"}>Continue now →</a>
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
