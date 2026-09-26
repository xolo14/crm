import { useEffect, useRef, useState } from "react";

export default function MicLevelMeter({ stream }: { stream: MediaStream | null }) {
  const [level, setLevel] = useState(0);
  const [live, setLive] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setLive(false);
      setLevel(0);
      return;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      setLive(false);
      return;
    }
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    setLive(true);

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      setLevel(Math.min(1, rms * 4));
      raf.current = requestAnimationFrame(tick);
    };
    void ctx.resume();
    tick();
    return () => {
      cancelAnimationFrame(raf.current);
      source.disconnect();
      void ctx.close();
    };
  }, [stream]);

  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Microphone</span>
        <span>{live ? (level > 0.04 ? "Hearing you" : "Silent — speak to test") : "Not connected"}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
      >
        <div
          className="h-full rounded-full bg-emerald-500 motion-reduce:transition-none transition-[width] duration-75"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
    </div>
  );
}
