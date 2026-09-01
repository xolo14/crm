import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock, ShieldAlert } from "lucide-react";
import { assessmentsApi, type PeaklyyQuestion } from "@/services/assessments";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import "./SyncpediaFresherAssessment.css";

type Step = "register" | "instructions" | "test" | "interests" | "result";

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

/**
 * Syncpedia fresher basics assessment — dedicated Syncpedia UI (not Peaklyy).
 */
export default function SyncpediaFresherAssessmentPage() {
  const { slug = SLUG } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const accessKey = useMemo(() => {
    const fromQuery = searchParams.get("key") || "";
    let fromHash = "";
    if (typeof window !== "undefined" && window.location.hash) {
      const raw = window.location.hash.replace(/^#/, "");
      const hp = new URLSearchParams(raw.includes("=") ? raw : `key=${raw}`);
      fromHash = hp.get("key") || (raw.startsWith("key=") ? decodeURIComponent(raw.slice(4)) : "");
    }
    return fromHash || fromQuery || "syncpedia_fresher_basics_v1";
  }, [searchParams]);

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
    degree_branch: "",
    graduation_year: "",
    college_name: "",
  });
  const [busy, setBusy] = useState(false);
  const [questions, setQuestions] = useState<PeaklyyQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [idx, setIdx] = useState(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [interestOptions, setInterestOptions] = useState<string[]>([]);
  const [interestSelected, setInterestSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{
    score: number;
    stars: number;
    passed: boolean;
    time_taken_seconds: number;
  } | null>(null);
  const submittingRef = useRef(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["syncpedia-fresher-assessment", slug, accessKey],
    queryFn: () => assessmentsApi.publicGet(slug, accessKey || undefined),
    enabled: Boolean(slug),
    retry: 1,
  });

  const assessment = data?.data;

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

  const submitAll = async () => {
    if (!attemptToken || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const res = await assessmentsApi.submit(attemptToken, answers);
      setResult({
        score: res.score,
        stars: res.stars,
        passed: res.passed,
        time_taken_seconds: res.time_taken_seconds,
      });
      const opts =
        Array.isArray(res.interest_options) && res.interest_options.length > 0
          ? res.interest_options.map(String)
          : Array.isArray(assessment?.interest_options)
            ? assessment!.interest_options!.map(String)
            : ["Cybersecurity", "Ethical Hacking", "Artificial Intelligence"];
      setInterestOptions(opts);
      if (res.require_interests && opts.length > 0) {
        setStep("interests");
      } else {
        setStep("result");
      }
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

  useEffect(() => {
    if (step !== "test" || remainingSec == null || remainingSec > 0) return;
    void submitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-submit once at 0
  }, [remainingSec, step]);

  const toggleInterest = (topic: string) => {
    setInterestSelected((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  };

  const shell = (title: string, desc: string | undefined, body: ReactNode, eyebrow = "Fresher assessment") => (
    <div className="sf-page">
      <div className="sf-topbar">
        <span className="sf-topbar-brand">Syncpedia</span>
      </div>
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
        <aside className="sf-side sf-side--right" aria-hidden="true">
          <FresherSideArt variant="right" />
        </aside>
      </div>
    </div>
  );

  if (isLoading) {
    return shell("Loading…", "Preparing your assessment.", <p className="sf-card-desc">Please wait…</p>);
  }

  if (error || !assessment) {
    return shell(
      "Assessment unavailable",
      undefined,
      <p className="sf-card-desc" style={{ color: "#b91c1c" }}>
        {error instanceof Error ? error.message : "Invalid or inactive assessment link"}
      </p>,
    );
  }

  if (step === "register") {
    return shell(
      "Candidate registration",
      "Enter your details to begin. Required fields are marked. Topic interests are selected after the test.",
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
                domain_key: "custom",
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
              const res = await assessmentsApi.start(attemptToken);
              setQuestions(res.questions);
              setEndsAt(res.ends_at ? new Date(res.ends_at).getTime() : null);
              setAnswers({});
              setIdx(0);
              setStep("test");
            } catch (e) {
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
            {Object.entries(current.options).map(([k, text]) => {
              const selected = answers[current.id] === k;
              return (
                <button
                  key={k}
                  type="button"
                  className={cn("sf-option", selected && "active")}
                  onClick={() => setAnswers((a) => ({ ...a, [current.id]: k }))}
                >
                  <strong>{k.toUpperCase()}.</strong>
                  {text}
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
          {idx < questions.length - 1 ? (
            <button
              type="button"
              className="sf-btn"
              onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))}
            >
              Next
            </button>
          ) : (
            <button type="button" className="sf-btn" disabled={busy} onClick={() => void submitAll()}>
              Submit test
            </button>
          )}
        </div>
      </>,
    );
  }

  if (step === "interests" && result) {
    return shell(
      "Select your interests",
      "Test completed. Choose one or more topics, then submit.",
      <>
        {interestOptions.map((topic) => (
          <label key={topic} className={cn("sf-choice", interestSelected.has(topic) && "active")}>
            <input
              type="checkbox"
              checked={interestSelected.has(topic)}
              onChange={() => toggleInterest(topic)}
            />
            <span>{topic}</span>
          </label>
        ))}
        <button
          type="button"
          className="sf-btn"
          disabled={busy || interestSelected.size === 0}
          onClick={async () => {
            setBusy(true);
            try {
              await assessmentsApi.saveInterests(attemptToken, Array.from(interestSelected));
              toast({ title: "Interests saved" });
              setStep("result");
            } catch (e) {
              toast({
                variant: "destructive",
                title: e instanceof Error ? e.message : "Could not save interests",
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          Submit interests
        </button>
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
        <p className="sf-card-desc" style={{ marginBottom: 0 }}>
          Thank you for completing the assessment. Our team will review your submission.
        </p>
      </div>,
    );
  }

  return shell("Assessment", undefined, <p className="sf-card-desc">Something went wrong. Refresh and try again.</p>);
}
