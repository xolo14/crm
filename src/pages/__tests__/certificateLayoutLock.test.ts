import { describe, expect, it } from "vitest";
import { isCertLayerMovableWhenLocked } from "../CertificatesPage";

/** Mirrors CertificatesPage's isLayerPositionLocked without needing the full component tree. */
function isLocked(type: string, layoutLocked: boolean, perLayerLocked = false): boolean {
  if (perLayerLocked) return true;
  if (!layoutLocked) return false;
  return !isCertLayerMovableWhenLocked(type);
}

const MOVABLE_WHEN_LOCKED = ["text", "image", "name", "domain", "company"];
const LOCKED_WHEN_LOCKED = ["date", "certID", "qr"];

describe("certificate builder — Lock layout", () => {
  it("layout unlocked: every layer type (built-in or free-text) stays movable", () => {
    for (const type of [...MOVABLE_WHEN_LOCKED, ...LOCKED_WHEN_LOCKED, "logo", "signature"]) {
      expect(isLocked(type, false)).toBe(false);
    }
  });

  it("layout locked: Name, Domain, Company, Text, and Image stay movable", () => {
    for (const type of MOVABLE_WHEN_LOCKED) {
      expect(isLocked(type, true)).toBe(false);
    }
  });

  it("layout locked: Date, Cert ID, and QR cannot move or resize", () => {
    for (const type of LOCKED_WHEN_LOCKED) {
      expect(isLocked(type, true)).toBe(true);
    }
  });

  it("layout locked: unclassified/other built-in layer types (e.g. logo, signature) lock by default", () => {
    expect(isLocked("logo", true)).toBe(true);
    expect(isLocked("signature", true)).toBe(true);
  });

  it("unlocking the layout restores movement for every layer, including built-ins", () => {
    for (const type of LOCKED_WHEN_LOCKED) {
      expect(isLocked(type, true)).toBe(true);
      expect(isLocked(type, false)).toBe(false);
    }
  });

  it("a layer's own explicit lock wins regardless of the layout lock state", () => {
    expect(isLocked("text", false, true)).toBe(true);
    expect(isLocked("date", false, true)).toBe(true);
  });
});
