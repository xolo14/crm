import { describe, expect, it } from "vitest";
import { formatClock, pickRecorderMime, recordingSupported } from "../videoIntroMedia";

describe("video intro media helpers", () => {
  it("formats elapsed time", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(-3)).toBe("0:00");
  });

  it("does not invent a mime type when MediaRecorder is missing", () => {
    const mime = pickRecorderMime();
    if (typeof MediaRecorder === "undefined") {
      expect(mime).toBe("");
    }
  });

  it("reports support without throwing", () => {
    const r = recordingSupported();
    expect(typeof r.ok).toBe("boolean");
  });
});
