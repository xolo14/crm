import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Camera, CheckCircle2, Loader2, Mic, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { setPageMeta } from "@/lib/seo";
import MicLevelMeter from "@/components/videoIntro/MicLevelMeter";
import {
  bothTracksLive,
  formatClock,
  permissionErrorMessage,
  pickRecorderMime,
  recordingSupported,
  stopMediaStream,
} from "@/lib/videoIntroMedia";
import {
  videoIntroOrgLogoUrl,
  videoIntroPublicAction,
  videoIntroPublicPreview,
  videoIntroUploadChunks,
  type VideoIntroPublicDto,
} from "@/lib/videoIntroPublic";
import { canRetryTake } from "@/lib/videoIntroState";
import syncpediaLogo from "@/assets/syncpedia-logo-transparent.png";

type Step =
  | "load"
  | "welcome"
  | "consent"
  | "devices"
  | "countdown"
  | "record"
  | "review"
  | "uploading"
  | "success"
  | "blocked";

export default function PublicVideoIntroPage() {
  const { token = "" } = useParams();
  const [step, setStep] = useState<Step>("load");
  const [invite, setInvite] = useState<VideoIntroPublicDto | null>(null);
  const [consentCopy, setConsentCopy] = useState<{ reviewers: string; storage: string; camera: string } | null>(null);
  const [error, setError] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [deviceError, setDeviceError] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [sessionId, setSessionId] = useState("");
  const [hidWhileRecording, setHidWhileRecording] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [mimeType, setMimeType] = useState("video/webm");
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number>(0);
  const startedAtRef = useRef(0);
  const elapsedRef = useRef(0);
  const maxSecRef = useRef(90);
  const dirtyRef = useRef(false);
  const skipZeroStartRef = useRef(false);
  const startingRecRef = useRef(false);

  useEffect(() => {
    setPageMeta({
      title: "Video introduction — Syncpedia",
      description: "Record a short video introduction for a hiring team.",
      robots: "noindex, nofollow",
    });
  }, []);

  const load = useCallback(async () => {
    setError("");
    setStep("load");
    try {
      const res = await videoIntroPublicPreview(token);
      setInvite(res.data);
      setConsentCopy(res.consent);
      setLogoFailed(false);
      maxSecRef.current = res.data.max_duration_sec || 90;
      if (res.data.status === "submitted") setStep("success");
      else if (res.data.status === "expired") {
        setError("This invitation has expired.");
        setStep("blocked");
      } else if (res.data.status === "revoked") {
        setError("This invitation has been revoked.");
        setStep("blocked");
      } else {
        setStep("welcome");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "This link is not valid.");
      setStep("blocked");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    dirtyRef.current = !!(blob && step !== "success");
  }, [blob, step]);

  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  useEffect(() => {
    return () => {
      stopMediaStream(streamRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useEffect(() => {
    const el = previewRef.current;
    if (el && stream && (step === "devices" || step === "countdown" || step === "record")) {
      el.srcObject = stream;
      void el.play().catch(() => undefined);
    }
  }, [stream, step]);

  const finishRecorder = useCallback((hidden = false) => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") {
      if (hidden) setHidWhileRecording(true);
      rec.stop();
    }
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden && step === "record") {
        finishRecorder(true);
      }
    };
    const onTrackEnd = () => {
      if (step === "record") finishRecorder(false);
    };
    document.addEventListener("visibilitychange", onVis);
    stream?.getTracks().forEach((t) => t.addEventListener("ended", onTrackEnd));
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stream?.getTracks().forEach((t) => t.removeEventListener("ended", onTrackEnd));
    };
  }, [step, stream, finishRecorder]);

  async function onConsent() {
    setError("");
    try {
      const res = await videoIntroPublicAction({ action: "consent", token, agreed: true });
      setInvite(res.data as VideoIntroPublicDto);
      setStep("devices");
      await enableDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue");
    }
  }

  async function enableDevices(): Promise<MediaStream | null> {
    setDeviceError("");
    const support = recordingSupported();
    if (!support.ok) {
      if (support.reason === "insecure") {
        setDeviceError("Camera access needs HTTPS. Open this link in your browser’s address bar, not an in-app preview.");
      } else {
        setDeviceError("This browser cannot record video. Use the latest Chrome, Edge, or Safari.");
      }
      return null;
    }
    try {
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      setStream(null);
      await new Promise((r) => window.setTimeout(r, 150));
      const next = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (!bothTracksLive(next)) {
        stopMediaStream(next);
        setDeviceError("Camera and microphone must both be available. Check permissions and hardware, then retry.");
        return null;
      }
      streamRef.current = next;
      setStream(next);
      setMimeType(pickRecorderMime() || "video/webm");
      return next;
    } catch (err) {
      setDeviceError(permissionErrorMessage(err));
      return null;
    }
  }

  async function beginCountdown(liveStream?: MediaStream | null) {
    const ready = liveStream || streamRef.current || stream;
    if (!bothTracksLive(ready)) {
      setDeviceError("Camera and microphone must both stay on before you record.");
      setError("Camera and microphone must both stay on before you record.");
      setStep("devices");
      return;
    }
    setError("");
    try {
      const start = await videoIntroPublicAction({
        action: "start",
        token,
        mime_type: pickRecorderMime() || mimeType,
      });
      setInvite(start.data as VideoIntroPublicDto);
      setSessionId(String(start.upload_session_id || ""));
      skipZeroStartRef.current = true;
      setCountdown(3);
      setStep("countdown");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not start recording";
      setDeviceError(msg);
      setError(msg);
    }
  }

  useEffect(() => {
    if (step !== "countdown") return;
    if (countdown <= 0) {
      if (skipZeroStartRef.current) {
        skipZeroStartRef.current = false;
        setCountdown(3);
        return;
      }
      startRecording();
      return;
    }
    skipZeroStartRef.current = false;
    const t = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
    // startRecording is local to this page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, countdown]);

  function abortRecorder() {
    const rec = recRef.current;
    if (rec) {
      rec.ondataavailable = null;
      rec.onstop = null;
      rec.onerror = null;
      if (rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      recRef.current = null;
    }
    window.clearInterval(timerRef.current);
    startingRecRef.current = false;
  }

  function startRecording() {
    const live = streamRef.current || stream;
    if (!live || !bothTracksLive(live)) {
      setDeviceError("Camera or microphone stopped. Re-check devices.");
      setError("Camera or microphone stopped. Re-check devices.");
      setStep("devices");
      return;
    }
    if (startingRecRef.current) return;
    abortRecorder();
    startingRecRef.current = true;
    chunksRef.current = [];
    setHidWhileRecording(false);
    try {
      const mime = pickRecorderMime();
      const rec = mime ? new MediaRecorder(live, { mimeType: mime }) : new MediaRecorder(live);
      setMimeType(rec.mimeType || mime || "video/webm");
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onerror = () => {
        window.clearInterval(timerRef.current);
        recRef.current = null;
        startingRecRef.current = false;
        setError("Recording failed. Check camera access and try again.");
        setStep("devices");
      };
      rec.onstop = () => {
        window.clearInterval(timerRef.current);
        startingRecRef.current = false;
        const type = rec.mimeType || mimeType || "video/webm";
        const file = new Blob(chunksRef.current, { type });
        setBlob(file);
        setBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(file);
        });
        recRef.current = null;
        setStep("review");
      };
      recRef.current = rec;
      rec.start(250);
      startedAtRef.current = Date.now();
      elapsedRef.current = 0;
      setElapsed(0);
      setStep("record");
      window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        const s = (Date.now() - startedAtRef.current) / 1000;
        elapsedRef.current = s;
        setElapsed(s);
        if (s >= maxSecRef.current) {
          finishRecorder(false);
        }
      }, 200);
    } catch (err) {
      startingRecRef.current = false;
      recRef.current = null;
      const msg = err instanceof Error ? err.message : "Could not start the recorder.";
      setDeviceError(msg);
      setError(msg);
      setStep("devices");
    }
  }

  async function onRetry() {
    if (!canRetryTake(invite)) {
      setError("No retries remaining. Submit this take, or ask for a new invitation.");
      return;
    }
    setError("");
    setHidWhileRecording(false);
    abortRecorder();
    setBlob(null);
    setBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setSessionId("");
    elapsedRef.current = 0;
    setElapsed(0);
    const live = await enableDevices();
    if (!live) {
      setStep("devices");
      return;
    }
    await beginCountdown(live);
  }

  async function onSubmit() {
    if (!blob || !sessionId) {
      setError("Recording session missing. Retry the take, then submit.");
      return;
    }
    setError("");
    setStep("uploading");
    setProgress(0);
    try {
      await videoIntroUploadChunks({
        token,
        sessionId,
        blob,
        chunkMax: 4 * 1024 * 1024,
        onProgress: setProgress,
      });
      await videoIntroPublicAction({
        action: "complete",
        token,
        upload_session_id: sessionId,
        duration_ms: Math.round(elapsedRef.current * 1000),
      });
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      setStream(null);
      dirtyRef.current = false;
      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Your recording is still on this device — retry submit.");
      setStep("review");
    }
  }

  const remaining = Math.max(0, maxSecRef.current - elapsed);
  const support = recordingSupported();
  const orgLogoHref = videoIntroOrgLogoUrl(invite);
  const headerLogo = !logoFailed && orgLogoHref ? orgLogoHref : syncpediaLogo;

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-50">
      <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col px-4 py-6 sm:py-10">
        <header className="mb-8 flex items-center gap-3">
          <img
            src={headerLogo}
            alt={invite?.org_name || ""}
            className="h-8 w-auto max-w-[7rem] object-contain"
            onError={() => setLogoFailed(true)}
          />
          <div>
            <p className="text-sm font-medium">Video introduction</p>
            <p className="text-xs text-zinc-400">
              {invite?.org_name
                ? `${invite.org_name} · Private recording for the hiring team`
                : "Private recording for the hiring team"}
            </p>
          </div>
        </header>

        {step === "load" ? (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading invitation
          </div>
        ) : null}

        {step === "blocked" ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h1 className="text-xl font-semibold">You cannot record on this link</h1>
            <p className="mt-2 text-sm text-zinc-400">{error}</p>
          </div>
        ) : null}

        {step === "welcome" && invite ? (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Hello, {invite.candidate_name}</h1>
              {invite.position ? <p className="mt-1 text-zinc-400">{invite.position}</p> : null}
            </div>
            <ul className="space-y-3 text-sm text-zinc-300">
              <li className="flex gap-3"><Camera className="mt-0.5 h-4 w-4 shrink-0" /> Record a short self-introduction on camera, up to {invite.max_duration_sec} seconds.</li>
              <li className="flex gap-3"><Mic className="mt-0.5 h-4 w-4 shrink-0" /> Camera and microphone are both required. You will preview them before recording.</li>
              <li className="flex gap-3"><Shield className="mt-0.5 h-4 w-4 shrink-0" /> You can review and retry before sending. Closing this tab does not submit anything.</li>
            </ul>
            <p className="text-xs text-zinc-500">
              This page cannot stop you switching apps. If you leave during a recording, we stop the take so you can review it.
            </p>
            <Button className="w-full" size="lg" onClick={() => setStep("consent")}>
              Continue
            </Button>
          </div>
        ) : null}

        {step === "consent" && invite && consentCopy ? (
          <div className="space-y-5">
            <h1 className="text-xl font-semibold">Before we use your camera</h1>
            <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
              <p>{consentCopy.reviewers}</p>
              <p>{consentCopy.storage}</p>
              <p>{consentCopy.camera}</p>
            </div>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
              <span>I understand this will record my camera and microphone, and I agree to submit a take to the organisation that invited me.</span>
            </label>
            {error ? <p className="text-sm text-rose-400">{error}</p> : null}
            <Button className="w-full" size="lg" disabled={!agreed} onClick={() => void onConsent()}>
              I agree — check my camera
            </Button>
          </div>
        ) : null}

        {step === "devices" ? (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold">Check camera and microphone</h1>
            <div className="overflow-hidden rounded-2xl bg-black">
              <video ref={previewRef} className="aspect-[3/4] w-full object-cover sm:aspect-video" playsInline muted autoPlay />
            </div>
            <MicLevelMeter stream={stream} />
            {deviceError ? <p className="text-sm text-rose-400">{deviceError}</p> : null}
            {!support.ok ? <p className="text-sm text-rose-400">Recording is not supported in this browser.</p> : null}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => void enableDevices()}>
                Retry devices
              </Button>
              <Button className="flex-1" disabled={!bothTracksLive(stream)} onClick={() => void beginCountdown()}>
                I’m ready
              </Button>
            </div>
          </div>
        ) : null}

        {step === "countdown" || step === "record" ? (
          <div className="space-y-4">
            <div className="relative overflow-hidden rounded-2xl bg-black">
              <video ref={previewRef} className="aspect-[3/4] w-full object-cover sm:aspect-video" playsInline muted autoPlay />
              {step === "countdown" ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-7xl font-semibold">
                  {countdown}
                </div>
              ) : null}
              {step === "record" ? (
                <div className="absolute left-3 top-3 rounded-full bg-red-600 px-3 py-1 text-xs font-semibold">
                  REC {formatClock(elapsed)} · left {formatClock(remaining)}
                </div>
              ) : null}
            </div>
            <MicLevelMeter stream={stream} />
            {step === "record" ? (
              <Button className="h-14 w-full text-base" variant="destructive" onClick={() => finishRecorder(false)}>
                Stop
              </Button>
            ) : (
              <p className="text-center text-sm text-zinc-400">Recording starts after the countdown.</p>
            )}
          </div>
        ) : null}

        {step === "review" || step === "uploading" ? (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold">Review your take</h1>
            {hidWhileRecording ? (
              <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-200">
                Recording stopped because this page was hidden. We cannot block other apps — play it back and retry if needed.
              </p>
            ) : null}
            {blobUrl ? (
              <video className="aspect-video w-full rounded-2xl bg-black" controls playsInline src={blobUrl} />
            ) : null}
            {step === "uploading" ? (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-center text-sm text-zinc-400">Uploading… {progress}%</p>
              </div>
            ) : null}
            {error ? <p className="text-sm text-rose-400">{error}</p> : null}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                disabled={step === "uploading" || !canRetryTake(invite)}
                onClick={() => void onRetry()}
              >
                Retry {canRetryTake(invite) ? `(${invite?.retries_remaining ?? invite?.max_retries ?? 0} left)` : "(none left)"}
              </Button>
              <Button className="flex-1" disabled={step === "uploading" || !blob} onClick={() => void onSubmit()}>
                Submit
              </Button>
            </div>
          </div>
        ) : null}

        {step === "success" ? (
          <div className="flex flex-1 flex-col items-center justify-center space-y-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            <h1 className="text-2xl font-semibold">It’s in</h1>
            <p className="max-w-sm text-sm text-zinc-400">
              Your introduction uploaded successfully. You can close this page. The hiring team will review it in their CRM — not on a public link.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
