import { describe, expect, it } from "vitest";
import {
  emptyIntegrity,
  isDevtoolsChromeGap,
  isExtensionInjection,
  isFastAnswer,
} from "../assessmentIntegrity";

describe("assessmentIntegrity", () => {
  it("flags answers faster than the human floor", () => {
    expect(isFastAnswer(1000, 2500)).toBe(true);
    expect(isFastAnswer(1000, 6000)).toBe(false);
    expect(isFastAnswer(0, 500)).toBe(false);
  });

  it("detects extension URLs and known overlay names, not hyphenated tags", () => {
    const ext = document.createElement("div");
    ext.id = "monica-root";
    expect(isExtensionInjection(ext)).toBe(true);

    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", "chrome-extension://abc/popup.html");
    expect(isExtensionInjection(iframe)).toBe(true);

    const custom = document.createElement("my-widget");
    custom.id = "ok";
    expect(isExtensionInjection(custom)).toBe(false);
  });

  it("treats a large outer/inner gap as a DevTools heuristic", () => {
    expect(isDevtoolsChromeGap(1200, 800, 800, 800)).toBe(true);
    expect(isDevtoolsChromeGap(1200, 1180, 800, 780)).toBe(false);
  });

  it("starts counters at zero", () => {
    expect(emptyIntegrity().tab_hides).toBe(0);
  });
});
