import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock, ShieldAlert } from "lucide-react";
import { assessmentsApi, type PeaklyyQuestion } from "@/services/assessments";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getApiBase } from "@/lib/apiBase";
import {
  emptyIntegrity,
  isDevtoolsChromeGap,
  isExtensionInjection,
  isFastAnswer,
  pingIntegrityBeacon,
  type IntegritySnapshot,
} from "@/lib/assessmentIntegrity";
import "./SyncpediaFresherAssessment.css";

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

const SLUG = "syncpedia-fresher-basics";

/** Strip "[Topic · Easy/Medium]" labels from question prompts for candidates. */
function displayQuestionPrompt(prompt: string): string {
  return String(prompt || "")
    .replace(/^\s*\[[^\]]+\]\s*/u, "")
    .trim();
}

const GRADUATION_YEARS = [
  "First Year",
  "Second Year",
  "Third Year",
  "Fourth Year",
  "Graduated",
] as const;

/** Professional line art for desktop side panels (career / tech / learning). */
function FresherSideArt({ variant }: { variant: "left" | "right" }) {
  const mirrored = variant === "right";
  return (
    <svg
      className={cn("sf-side-art", mirrored && "sf-side-art--mirror")}
      viewBox="0 0 220 640"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Soft vertical guides */}
      <path d="M40 24 V616" stroke="currentColor" strokeWidth="1" opacity="0.18" />
      <path d="M110 48 V592" stroke="currentColor" strokeWidth="1" opacity="0.12" strokeDasharray="4 8" />
      <path d="M180 24 V616" stroke="currentColor" strokeWidth="1" opacity="0.18" />

      {/* Graduation / path node */}
      <circle cx="110" cy="96" r="28" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
      <path
        d="M86 96 H134 M110 72 V120 M94 84 L110 72 L126 84 M94 108 L110 120 L126 108"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Connecting spine */}
      <path d="M110 124 V220" stroke="currentColor" strokeWidth="1.25" opacity="0.35" />

      {/* Code brackets / assessment */}
      <rect x="62" y="220" width="96" height="72" rx="2" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
      <path
        d="M86 244 L74 256 L86 268 M134 244 L146 256 L134 268 M100 272 H120"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path d="M110 292 V360" stroke="currentColor" strokeWidth="1.25" opacity="0.35" />

      {/* Shield / integrity */}
      <path
        d="M110 360 L146 376 V412 C146 440 110 460 110 460 C110 460 74 440 74 412 V376 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.55"
        strokeLinejoin="round"
      />
      <path
        d="M96 412 L106 422 L126 396"
        stroke="currentColor"
        strokeWidth="1.6"
        opacity="0.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path d="M110 460 V520" stroke="currentColor" strokeWidth="1.25" opacity="0.35" />

      {/* Circuit nodes */}
      <circle cx="70" cy="520" r="6" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
      <circle cx="110" cy="540" r="8" stroke="currentColor" strokeWidth="1.4" opacity="0.65" />
      <circle cx="150" cy="520" r="6" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
      <path
        d="M76 520 H102 M118 540 H144 M110 528 V532 M70 526 V560 M150 526 V560"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.45"
        strokeLinecap="round"
      />
      <path d="M40 580 H180" stroke="currentColor" strokeWidth="1" opacity="0.2" />
      <path d="M70 600 H150" stroke="currentColor" strokeWidth="1" opacity="0.15" />
    </svg>
  );
}

interface SyncpediaFresherAssessmentPageProps {
  defaultSlug?: string;
}

/**
 * Syncpedia assessment — dedicated Syncpedia UI (not Peaklyy).
 */
export default function SyncpediaFresherAssessmentPage({ defaultSlug = SLUG }: SyncpediaFresherAssessmentPageProps = {}) {
  const { slug: routeSlug } = useParams();
  const slug = routeSlug || defaultSlug;
  const [searchParams, setSearchParams] = useSearchParams();
  const accessKey = useMemo(() => {
    const fromQuery = searchParams.get("key") || "";
    let fromHash = "";
    if (typeof window !== "undefined" && window.location.hash) {
      const raw = window.location.hash.replace(/^#/, "");
      const hp = new URLSearchParams(raw.includes("=") ? raw : `key=${raw}`);
      fromHash = hp.get("key") || (raw.startsWith("key=") ? decodeURIComponent(raw.slice(4)) : "");
    }
    const defaultKey =
      slug === "syncpedia-assignment"
        ? "syncpedia_assignment_v1"
        : slug === "syncpedia-fresher-basics"
          ? "syncpedia_fresher_basics_v1"
          : "";
    return fromHash || fromQuery || defaultKey;
  }, [searchParams, slug]);

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
  const isBasics = slug === SLUG;
  const [reg, setReg] = useState({
    full_name: "",
    email: "",
    phone: "",
    degree_branch: "",
    graduation_year: "",
    college_name: "",
    domain_key: "",
  });
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<PeaklyyQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [visited, setVisited] = useState<Record<string, true>>({});
  const [idx, setIdx] = useState(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState<{
    score: number;
    stars: number;
    passed: boolean;
    time_taken_seconds: number;
  } | null>(null);
  const submittingRef = useRef(false);
  const [leaveWarn, setLeaveWarn] = useState(false);
  const integrityRef = useRef<IntegritySnapshot>(emptyIntegrity());
  const shownAtRef = useRef<Record<string, number>>({});
  const firstAnswerAtRef = useRef<Record<string, true>>({});
  const attemptTokenRef = useRef(attemptToken);
  useEffect(() => {
    attemptTokenRef.current = attemptToken;
  }, [attemptToken]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["syncpedia-fresher-assessment", slug, accessKey],
    queryFn: () => assessmentsApi.publicGet(slug, accessKey || undefined),
    enabled: Boolean(slug),
    retry: 1,
  });

  const assessment = data?.data;
  const domainEntries = Object.entries(data?.domains || {});

  useEffect(() => {
    if (!endsAt || step !== "test") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [endsAt, step]);

  const remainingMs = endsAt ? Math.max(0, endsAt - now) : null;
  const remainingSec = remainingMs != null ? Math.ceil(remainingMs / 1000) : null;
  const mm = remainingSec != null ? String(Math.floor(remainingSec / 60)).padStart(2, "0") : "--";
  const ss = remainingSec != null ? String(remainingSec % 60).padStart(2, "0") : "--";

  const current = questions[idx];
  const progress = questions.length ? Math.round(((idx + 1) / questions.length) * 100) : 0;

  useEffect(() => {
    if (step !== "test" || !current?.id) return;
    const id = current.id;
    setVisited((v) => (v[id] ? v : { ...v, [id]: true }));
    if (!shownAtRef.current[id]) {
      shownAtRef.current[id] = Date.now();
    }
  }, [step, current?.id]);

  const stepRef = useRef<Step>(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const submitAll = async () => {
    if (!attemptToken || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    exitFullscreenSafe();
    try {
      const res = await assessmentsApi.submit(attemptToken, answersRef.current, { ...integrityRef.current });
      setResult({
        score: res.score,
        stars: res.stars,
        passed: res.passed,
        time_taken_seconds: res.time_taken_seconds,
      });
      setStep("result");
    } catch (e) {
      toast({
        variant: "destructive",
        title: e instanceof Error ? e.message : "Submit failed",
      });
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  const forceSubmit = (reason: string) => {
    if (submittingRef.current || stepRef.current !== "test") return;
    toast({
      variant: "destructive",
      title: "Fullscreen required",
      description: `${reason}. Test auto-submitted.`,
    });
    void submitAll();
  };

  useEffect(() => {
    if (step !== "test") {
      exitFullscreenSafe();
      setLeaveWarn(false);
      return;
    }

    try {
      document.body.style.userSelect = "none";
      (document.body.style as unknown as Record<string, string>).webkitUserSelect = "none";
    } catch {}

    const apiBase = getApiBase();
    const snap = () => ({ ...integrityRef.current });
    const ping = (eventType: string, extra?: Record<string, unknown>) => {
      pingIntegrityBeacon(apiBase, attemptTokenRef.current, {
        ...snap(),
        event: { type: eventType, at: new Date().toISOString(), ...extra },
      });
    };

    let hiddenStarted = 0;
    let firstHide = true;
    let lastBlurAt = 0;
    let lastWide = isDevtoolsChromeGap(window.outerWidth, window.innerWidth, window.outerHeight, window.innerHeight);

    const onVis = () => {
      if (stepRef.current !== "test") return;
      if (document.hidden) {
        hiddenStarted = Date.now();
        integrityRef.current.tab_hides += 1;
        if (firstHide) {
          firstHide = false;
          setLeaveWarn(true);
        }
        ping("tab_hide");
      } else if (hiddenStarted) {
        integrityRef.current.hidden_ms += Date.now() - hiddenStarted;
        hiddenStarted = 0;
        ping("tab_visible");
      }
    };

    const flushIntegrity = () => {
      pingIntegrityBeacon(apiBase, attemptTokenRef.current, snap());
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      flushIntegrity();
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    const onPageHide = () => {
      flushIntegrity();
    };

    const onFsChange = () => {
      if (!document.fullscreenElement && stepRef.current === "test") {
        forceSubmit("Fullscreen exited");
      }
    };

    const clearSelection = () => {
      try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          sel.removeAllRanges();
        }
      } catch {}
    };

    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      clearSelection();
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    const onBlur = () => {
      if (stepRef.current !== "test") return;
      const now = Date.now();
      if (now - lastBlurAt < 2000) return;
      lastBlurAt = now;
      integrityRef.current.blurs += 1;
      ping("blur");
    };

    const onResize = () => {
      if (stepRef.current !== "test") return;
      const wide = isDevtoolsChromeGap(window.outerWidth, window.innerWidth, window.outerHeight, window.innerHeight);
      if (wide && !lastWide) {
        integrityRef.current.resize_devtools += 1;
        ping("resize_devtools");
      }
      lastWide = wide;
    };

    const onClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("a")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const extObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue;
          if (!isExtensionInjection(node)) continue;
          integrityRef.current.extension_dom += 1;
          ping("extension_dom");
          try {
            node.remove();
          } catch {
            node.style.display = "none";
            node.style.pointerEvents = "none";
          }
        }
      }
    });

    try {
      extObserver.observe(document.body, { childList: true, subtree: true });
    } catch {}

    const heartbeat = window.setInterval(() => {
      if (stepRef.current === "test") ping("heartbeat");
    }, 30000);

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("copy", block, true);
    document.addEventListener("paste", block, true);
    document.addEventListener("cut", block, true);
    document.addEventListener("contextmenu", block, true);
    document.addEventListener("selectstart", block, true);
    document.addEventListener("selectionchange", clearSelection, true);
    document.addEventListener("dragstart", block, true);
    document.addEventListener("drop", block, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("keypress", onKey, true);

    return () => {
      window.clearInterval(heartbeat);
      try {
        document.body.style.userSelect = "";
        (document.body.style as unknown as Record<string, string>).webkitUserSelect = "";
      } catch {}
      try {
        extObserver.disconnect();
      } catch {}
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("click", onClickCapture, true);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("copy", block, true);
      document.removeEventListener("paste", block, true);
      document.removeEventListener("cut", block, true);
      document.removeEventListener("contextmenu", block, true);
      document.removeEventListener("selectstart", block, true);
      document.removeEventListener("selectionchange", clearSelection, true);
      document.removeEventListener("dragstart", block, true);
      document.removeEventListener("drop", block, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("keypress", onKey, true);
    };
    // forceSubmit / submitAll stay stable enough for fullscreen-exit only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step !== "test" || remainingSec == null || remainingSec > 0) return;
    void submitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-submit once at 0
  }, [remainingSec, step]);

  const defaultEyebrow = slug === "syncpedia-assignment" ? "Syncpedia assignment" : "Fresher assignment";
  const questionHasAnswer = (id: string) => {
    const value = answers[id];
    return value != null && String(value).trim() !== "";
  };
  const questionNav =
    step === "test" && questions.length ? (
      <div className="sf-qnav">
        <div className="sf-qnav-grid" role="navigation" aria-label="Question numbers">
          {questions.map((q, i) => {
            const answered = questionHasAnswer(q.id);
            const seen = Boolean(visited[q.id]);
            return (
              <button
                key={q.id}
                type="button"
                className={cn(
                  "sf-qnav-num",
                  answered && "is-answered",
                  !answered && seen && "is-seen",
                  i === idx && "is-current",
                )}
                onClick={() => setIdx(i)}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <ul className="sf-qnav-legend" aria-label="Question colors">
          <li>
            <span className="sf-qnav-legend-swatch" aria-hidden="true" />
            White — not opened
          </li>
          <li>
            <span className="sf-qnav-legend-swatch is-seen" aria-hidden="true" />
            Gray — opened, not answered
          </li>
          <li>
            <span className="sf-qnav-legend-swatch is-answered" aria-hidden="true" />
            Black — answered
          </li>
        </ul>
        <button
          type="button"
          className="sf-btn sf-qnav-submit"
          disabled={busy}
          onClick={() => void submitAll()}
        >
          Submit
        </button>
      </div>
    ) : null;
  const shell = (title: string, desc: string | undefined, body: ReactNode, eyebrow = defaultEyebrow) => (
    <div className={cn("sf-page", step === "test" && "sf-page--test notranslate")} translate="no">
      <div className="sf-topbar">
        <span className="sf-topbar-brand">Syncpedia</span>
      </div>
      {leaveWarn && step === "test" ? (
        <div className="sf-leave-warn" role="alertdialog" aria-modal="true">
          <div className="sf-leave-warn-card">
            <p>Stay on this page. Further switches are logged for review.</p>
            <button type="button" className="sf-btn" onClick={() => setLeaveWarn(false)}>
              Continue
            </button>
          </div>
        </div>
      ) : null}
      <div className="sf-stage">
        <aside className="sf-side sf-side--left" aria-hidden="true">
          <FresherSideArt variant="left" />
        </aside>
        <div className="sf-shell">
          <main className="sf-card">
            {eyebrow ? <p className="sf-eyebrow">{eyebrow}</p> : null}
            <h2 className="sf-card-title">{title}</h2>
            {desc ? <p className="sf-card-desc">{desc}</p> : null}
            {body}
          </main>
        </div>
        <aside
          className={cn("sf-side sf-side--right", questionNav && "sf-side--nav")}
          aria-hidden={questionNav ? undefined : true}
        >
          {questionNav ?? <FresherSideArt variant="right" />}
        </aside>
      </div>
    </div>
  );

  if (isLoading) {
    return shell("Loading…", "Preparing your assignment.", <p className="sf-card-desc">Please wait…</p>);
  }

  if (error || !assessment) {
    return shell(
      "Assignment unavailable",
      undefined,
      <p className="sf-card-desc" style={{ color: "#b91c1c" }}>
        {error instanceof Error ? error.message : "Invalid or inactive assignment link"}
      </p>,
    );
  }

  if (step === "register") {
    return shell(
      "Candidate registration",
      isBasics
        ? "Enter your details and choose a domain. You will answer 10 aptitude + 20 domain questions in 20 minutes."
        : "Enter your details to begin. Required fields are marked.",
      <div className="sf-fields">
        <div className="sf-field sf-field--half">
          <label className="sf-label">Full name *</label>
          <input
            className="sf-input"
            value={reg.full_name}
            onChange={(e) => setReg((r) => ({ ...r, full_name: e.target.value }))}
            placeholder="Enter your full name"
            autoComplete="name"
          />
        </div>
        <div className="sf-field sf-field--half">
          <label className="sf-label">Email *</label>
          <input
            className="sf-input"
            type="email"
            value={reg.email}
            onChange={(e) => setReg((r) => ({ ...r, email: e.target.value }))}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        <div className="sf-field sf-field--half">
          <label className="sf-label">Phone *</label>
          <input
            className="sf-input"
            value={reg.phone}
            onChange={(e) => setReg((r) => ({ ...r, phone: e.target.value }))}
            placeholder="10-digit mobile"
            autoComplete="tel"
          />
        </div>
        <div className="sf-field sf-field--half">
          <label className="sf-label">Graduation year *</label>
          <select
            className="sf-input"
            value={reg.graduation_year}
            onChange={(e) => setReg((r) => ({ ...r, graduation_year: e.target.value }))}
          >
            <option value="">Select year</option>
            {GRADUATION_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="sf-field">
          <label className="sf-label">College *</label>
          <input
            className="sf-input"
            value={reg.college_name}
            onChange={(e) => setReg((r) => ({ ...r, college_name: e.target.value }))}
            placeholder="Enter your college name"
            autoComplete="organization"
          />
        </div>
        <div className="sf-field">
          <label className="sf-label">Degree / Branch</label>
          <select
            className="sf-input"
            value={reg.degree_branch}
            onChange={(e) => setReg((r) => ({ ...r, degree_branch: e.target.value }))}
          >
            <option value="">Select degree/branch</option>
            {(data?.degrees || []).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        {isBasics ? (
          <div className="sf-field">
            <label className="sf-label">Domain *</label>
            <select
              className="sf-input"
              value={reg.domain_key}
              onChange={(e) => setReg((r) => ({ ...r, domain_key: e.target.value }))}
            >
              <option value="">Select domain</option>
              {domainEntries.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <p className="sf-card-desc" style={{ marginTop: 8 }}>
              The paper is 10 quantitative aptitude + 20 from this domain, in 20 minutes. Questions are chosen at random from 100-question banks.
            </p>
          </div>
        ) : null}
        <button
          type="button"
          className="sf-btn"
          disabled={busy}
          onClick={async () => {
            if (!reg.full_name.trim() || !reg.email.trim() || !reg.phone.trim()) {
              toast({ variant: "destructive", title: "Name, email, and phone are required" });
              return;
            }
            if (!reg.graduation_year) {
              toast({ variant: "destructive", title: "Select your graduation year" });
              return;
            }
            if (!reg.college_name.trim()) {
              toast({ variant: "destructive", title: "College name is required" });
              return;
            }
            if (isBasics && !reg.domain_key) {
              toast({ variant: "destructive", title: "Select a domain" });
              return;
            }
            setBusy(true);
            try {
              const degreeParts = [reg.degree_branch.trim(), reg.graduation_year.trim()].filter(Boolean);
              const res = await assessmentsApi.register({
                slug,
                full_name: reg.full_name.trim(),
                email: reg.email.trim(),
                phone: reg.phone.trim(),
                college_name: reg.college_name.trim(),
                degree_branch: degreeParts.join(" · "),
                graduation_year: reg.graduation_year.trim(),
                domain_key: isBasics ? reg.domain_key : "custom",
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
          Register & continue
        </button>
      </div>,
    );
  }

  if (step === "instructions") {
    return shell(
      assessment.title,
      "Please review before starting.",
      <>
        <ul className="sf-list">
          <li key="fs-rule">
            <ShieldAlert className="h-4 w-4" />
            <span>Full screen is required. Exiting full screen auto-submits the test. Switching tabs does not end the test, but it is logged for review.</span>
          </li>
          <li key="mouse-only-rule">
            <ShieldAlert className="h-4 w-4" />
            <span>Keyboard, text selection, and browser extensions are strictly disabled. Only the mouse can be used to select answers and navigate during the test.</span>
          </li>
          {(data?.instructions || []).map((line) => (
            <li key={line}>
              <ShieldAlert className="h-4 w-4" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="sf-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const ok = await enterFullscreen();
              if (!ok) {
                toast({
                  variant: "destructive",
                  title: "Fullscreen required",
                  description: "Please allow fullscreen mode to start the test without disturbances.",
                });
                setBusy(false);
                return;
              }
              const res = await assessmentsApi.start(attemptToken);
              setQuestions(res.questions);
              setEndsAt(res.ends_at ? new Date(res.ends_at).getTime() : null);
              setAnswers({});
              setVisited({});
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
          Start test
        </button>
      </>,
    );
  }

  if (step === "test" && current) {
    return shell(
      `Question ${idx + 1} of ${questions.length}`,
      undefined,
      <>
        <div className="sf-meta">
          <span>
            {idx + 1} / {questions.length}
          </span>
          {endsAt ? (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Clock className="h-4 w-4" />
              {mm}:{ss}
            </span>
          ) : null}
        </div>
        <div className="sf-progress">
          <span style={{ width: `${progress}%` }} />
        </div>
        <h3 className="sf-q">{displayQuestionPrompt(String(current.prompt || ""))}</h3>
        {current.q_type === "mcq" && current.options ? (
          <div className="sf-options">
            {(current.option_order?.length
              ? current.option_order.filter((k) => current.options?.[k] != null)
              : Object.keys(current.options)
            ).map((k) => {
              const text = current.options?.[k];
              const selected = answers[current.id] === k;
              return (
                <button
                  key={k}
                  type="button"
                  className={cn("sf-option", selected && "active")}
                  onClick={() => {
                    const now = Date.now();
                    const qid = current.id;
                    if (!firstAnswerAtRef.current[qid]) {
                      firstAnswerAtRef.current[qid] = true;
                      if (isFastAnswer(shownAtRef.current[qid] || now, now)) {
                        integrityRef.current.fast_answers += 1;
                        pingIntegrityBeacon(getApiBase(), attemptTokenRef.current, {
                          ...integrityRef.current,
                          event: { type: "fast_answer", at: new Date().toISOString(), question_id: qid },
                        });
                      }
                    }
                    setAnswers((a) => ({ ...a, [qid]: k }));
                  }}
                >
                  <strong>{k.toUpperCase()}.</strong>
                  <span>{text}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="sf-btn-row">
          <button
            type="button"
            className="sf-btn sf-btn-ghost"
            disabled={idx === 0}
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
          >
            Previous
          </button>
          <button
            type="button"
            className="sf-btn"
            disabled={idx >= questions.length - 1}
            onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))}
          >
            Next
          </button>
        </div>
      </>,
    );
  }

  if (step === "result" && result) {
    return shell(
      "Test completed",
      undefined,
      <div className="sf-result">
        <p style={{ fontWeight: 800, fontSize: "1.25rem", marginTop: 4, marginBottom: 10 }}>
          Your test is completed
        </p>
        <p className="sf-card-desc" style={{ marginBottom: 8 }}>
          Thank you for completing the assignment. Our team will review your submission.
        </p>
      </div>,
    );
  }

  return shell("Assignment", undefined, <p className="sf-card-desc">Something went wrong. Refresh and try again.</p>);
}
