import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canCandidateAct,
  canRetryTake,
  effectiveVideoIntroStatus,
  isHighEntropyToken,
  nextStatusAfter,
  previewMustNotOpen,
  retriesRemaining,
} from "../videoIntroState";

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

describe("video intro tokens", () => {
  it("rejects short or spaced tokens", () => {
    expect(isHighEntropyToken("abc")).toBe(false);
    expect(isHighEntropyToken("a".repeat(40) + " bad")).toBe(false);
  });

  it("accepts url-safe high-entropy tokens", () => {
    expect(isHighEntropyToken("abcdefghijklmnopqrstuvwxyz0123456789-_AB")).toBe(true);
  });

  it("hashes to a stable 64-char hex (server stores hash, not raw token)", () => {
    const raw = "S".repeat(43);
    const hash = sha256(raw);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(sha256(raw));
    expect(hash).not.toBe(raw);
  });
});

describe("video intro state machine", () => {
  it("preview does not consume created invitations", () => {
    expect(previewMustNotOpen("created")).toBe(true);
    expect(nextStatusAfter("preview", "created")).toBe("created");
  });

  it("consent opens a created invite and is ignored as a no-op once opened", () => {
    expect(nextStatusAfter("consent", "created")).toBe("opened");
    expect(nextStatusAfter("consent", "opened")).toBe("opened");
  });

  it("blocks recording after submit, expiry, or revoke", () => {
    expect(nextStatusAfter("start", "submitted")).toBeNull();
    expect(nextStatusAfter("complete", "revoked")).toBeNull();
    expect(nextStatusAfter("complete", "expired")).toBeNull();
    expect(canCandidateAct("expired")).toBe(false);
  });

  it("regenerate is blocked after submit", () => {
    expect(nextStatusAfter("regenerate", "submitted")).toBeNull();
    expect(nextStatusAfter("regenerate", "opened")).toBe("created");
  });

  it("marks unpaid statuses expired after expires_at", () => {
    expect(
      effectiveVideoIntroStatus({
        status: "opened",
        expires_at: "2020-01-01 00:00:00",
        nowMs: Date.parse("2026-01-01T00:00:00Z"),
      }),
    ).toBe("expired");
    expect(
      effectiveVideoIntroStatus({
        status: "submitted",
        expires_at: "2020-01-01 00:00:00",
        nowMs: Date.parse("2026-01-01T00:00:00Z"),
      }),
    ).toBe("submitted");
  });

  it("counts remaining retries", () => {
    expect(retriesRemaining(3, 0)).toBe(3);
    expect(retriesRemaining(3, 3)).toBe(0);
  });

  it("allows retry when remaining is omitted (do not treat missing as zero)", () => {
    expect(canRetryTake({ max_retries: 3, retry_count: 0 })).toBe(true);
    expect(canRetryTake({ retries_remaining: 2 })).toBe(true);
    expect(canRetryTake({ retries_remaining: 0 })).toBe(false);
    expect(canRetryTake(null)).toBe(false);
  });
});
