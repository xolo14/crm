import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Clock, ShieldAlert, Trophy } from "lucide-react";
import { assessmentsApi, type PeaklyyQuestion } from "@/services/assessments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import "./PeaklyyAssessment.css";

type Step = "register" | "instructions" | "test" | "result";

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
  const [searchParams] = useSearchParams();
  const accessKey = searchParams.get("key") || "";
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
  } | null>(null);

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const submittingRef = useRef(false);
  const stepRef = useRef(step);
  stepRef.current = step;

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
    const duration = Number(assessment.duration_minutes) || 15;
    const qCount = Number(assessment.question_count) || 15;
    const pass = Number(assessment.pass_score) || 70;
    return [
      `Duration: ${duration} minutes`,
      `${qCount} MCQ question${qCount === 1 ? "" : "s"}`,
      "Full screen required once the test starts",
      "No tab switching or leaving the page",
      "Copy and paste is disabled",
      "Leaving or switching tabs auto-submits the test",
      assessment.once_per_candidate
        ? "Test allowed only once per candidate"
        : "Multiple attempts may be allowed",
      `Score ${pass}+ to pass (1★ at 70, 2★ at 80, 3★ at 90, 4★ at 100). Below ${pass} = Not pass`,
    ];
  }, [assessment, data?.instructions]);

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
      exitFullscreenSafe();
      setResult({
        score: res.score,
        stars: res.stars,
        passed: res.passed,
        time_taken_seconds: res.time_taken_seconds,
        redirect_url: res.redirect_url,
      });
      setStep("result");
      if (res.passed && res.redirect_url) {
        window.setTimeout(() => {
          window.location.href = res.redirect_url!;
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
      if (document.hidden) forceSubmit("Tab / window switch detected");
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };

    const onFsChange = () => {
      if (!antiCheat) return;
      if (!document.fullscreenElement && stepRef.current === "test") {
        forceSubmit("Fullscreen exited");
      }
    };

    const block = (e: Event) => {
      e.preventDefault();
      return false;
    };
    const onKey = (e: KeyboardEvent) => {
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

  const brandPanel = (
    <aside className="pk-brand">
      <div className="pk-brand-logo">
        <span className="pk-brand-mark">P</span>
        <span>{assessment.brand_name || "Peaklyy"}</span>
      </div>
      <span className="pk-badge">AI-Powered Career Bridge</span>
      <h1>Build real career proof with domain screening.</h1>
      <p>
        {assessment.brand_tagline || "Learn · Earn · Grow"} —{" "}
        {isCustom
          ? "custom assessment with your questions, timed scoring, and star ratings."
          : "entry-level assessment for shortlisting student applicants across Web, UI/UX, Content, Marketing, and Video."}
      </p>
      <div className="pk-feature">
        <strong>Students</strong>
        <span>Show skills through scored MCQs — timed domain screening with star ratings.</span>
      </div>
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
                            description: "Allow fullscreen to start the timed test.",
                          });
                          setBusy(false);
                          return;
                        }
                        const res = await assessmentsApi.start(attemptToken);
                        setQuestions(res.questions);
                        setEndsAt(new Date(res.ends_at).getTime());
                        setDomainLabel(res.domain_label);
                        setAntiCheat(res.anti_cheat);
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
                    Start Test →
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
                Question {idx + 1} of {questions.length}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                {mm}:{ss}
              </span>
            </div>
            <div className="pk-progress">
              <div style={{ width: `${progress}%` }} />
            </div>
            <div className="pk-test-body">
              <p className="pk-subject">
                {domainLabel.toUpperCase()} · {current.level_key.toUpperCase()} · MCQ
              </p>
              <h2 className="pk-q">{current.prompt}</h2>

              {current.options ? (
                <div className="space-y-2.5 mt-5">
                  {Object.entries(current.options).map(([k, text]) => {
                    const selected = (answers[current.id] as string) === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        className={cn("pk-option", selected && "pk-option-active")}
                        onClick={() => setAnswers((a) => ({ ...a, [current.id]: k }))}
                      >
                        <span className="pk-opt-letter">{k.toUpperCase()}.</span>
                        <span>{text}</span>
                      </button>
                    );
                  })}
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
                    Submit assessment →
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
                      answers[q.id] != null && answers[q.id] !== "" && "answered",
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

      {step === "result" && result ? (
        <div className="pk-center-wrap">
          <div className="w-full max-w-md space-y-4">
            <div className="pk-card overflow-hidden">
              <div className="pk-header text-center py-5 space-y-1">
                <Trophy className="h-8 w-8 mx-auto text-white" />
                <div className="text-lg font-bold">Assessment Completed</div>
              </div>
              <div className="pk-body text-center space-y-3">
                <p className="text-4xl font-bold">{result.score} / 100</p>
                <p className="text-2xl pk-result-stars">{starRow}</p>
                <p
                  className="text-base font-semibold"
                  style={{ color: result.passed ? "var(--pk-caramel)" : "#9a3412" }}
                >
                  {result.passed ? "Passed" : `Not pass (below ${passScore})`}
                </p>
                <p className="text-sm" style={{ color: "var(--pk-muted)" }}>
                  Time taken: {Math.floor(result.time_taken_seconds / 60)}m {result.time_taken_seconds % 60}s
                </p>
                <div className="pt-2">
                  <p className="font-semibold">Thank you for completing the assessment!</p>
                  <p className="text-sm mt-1" style={{ color: "var(--pk-muted)" }}>
                    {result.passed
                      ? "You passed. Results are being sent to the partner website via API key. Redirecting…"
                      : `Score below ${passScore} is Not pass. Your responses have been recorded.`}
                  </p>
                </div>
              </div>
            </div>

            {result.passed && result.redirect_url ? (
              <div className="pk-card">
                <div className="pk-body text-center space-y-2">
                  <p className="font-semibold" style={{ color: "var(--pk-caramel)" }}>
                    Passed — opening partner website
                  </p>
                  <Button className="pk-btn w-full" asChild>
                    <a href={result.redirect_url}>Continue now →</a>
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
