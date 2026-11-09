import { describe, expect, it } from "vitest";
import {
  clampCenter,
  DEFAULT_OFFER_BODY_BOX,
  extractOfferBodyBox,
  extractOfferTextBoxes,
  injectOfferTextBoxesMarker,
  removeSyncTextBoxesOverlays,
  type OfferTextBox,
} from "../CanvasTextBoxFrame";

function makeBox(overrides: Partial<OfferTextBox> = {}): OfferTextBox {
  return {
    id: overrides.id || "box-1",
    type: "text",
    content: "Hello",
    x: 50,
    y: 50,
    width: 20,
    height: 10,
    fontSize: 16,
    fontFamily: "Georgia, serif",
    fontWeight: "normal",
    fontStyle: "normal",
    color: "#1a1a2e",
    align: "center",
    divider: "none",
    ...overrides,
  };
}

describe("clampCenter (floating box boundary constraints)", () => {
  it("leaves an already in-bounds center untouched", () => {
    expect(clampCenter(50, 20)).toBe(50);
  });

  it("clamps the center so the box does not cross the left/top edge", () => {
    // width 20 -> half 10 -> min allowed center is 10
    expect(clampCenter(2, 20)).toBe(10);
    expect(clampCenter(-30, 20)).toBe(10);
  });

  it("clamps the center so the box does not cross the right/bottom edge", () => {
    // width 20 -> half 10 -> max allowed center is 90
    expect(clampCenter(98, 20)).toBe(90);
    expect(clampCenter(140, 20)).toBe(90);
  });

  it("centers an oversized box (>= full page width) instead of producing an invalid range", () => {
    expect(clampCenter(10, 120)).toBe(50);
    expect(clampCenter(90, 100)).toBe(50);
  });

  it("applies the same rule to width and height independently (text and image boxes share this helper)", () => {
    expect(clampCenter(5, 30)).toBe(15);
    expect(clampCenter(99, 8)).toBe(96);
  });
});

describe("extractOfferBodyBox (load path never auto-clamps)", () => {
  it("returns stored coordinates verbatim, even when out of [0,100] bounds", () => {
    const html = `<!doctype html><html><body><!--SYNC_BODY_BOX:{"x":-15,"y":5,"width":130,"height":40}--></body></html>`;
    expect(extractOfferBodyBox(html)).toEqual({ x: -15, y: 5, width: 130, height: 40 });
  });

  it("falls back to the default box when no marker or padding CSS is present", () => {
    expect(extractOfferBodyBox("<html><body></body></html>")).toEqual(DEFAULT_OFFER_BODY_BOX);
  });
});

describe("removeSyncTextBoxesOverlays (nested overlay removal)", () => {
  it("removes a single overlay with one nested box div", () => {
    const html =
      '<body><p>Letter</p><div class="sync-text-boxes"><div class="sync-textbox">A</div></div></body>';
    expect(removeSyncTextBoxesOverlays(html)).toBe("<body><p>Letter</p></body>");
  });

  it("removes an overlay containing multiple sibling box divs without leaving stray fragments", () => {
    const html =
      '<body><p>Letter</p><div class="sync-text-boxes">' +
      '<div class="sync-textbox">A</div>' +
      '<div class="sync-textbox">B</div>' +
      '<div class="sync-imagebox"><img src="x.png" /></div>' +
      "</div></body>";
    const out = removeSyncTextBoxesOverlays(html);
    expect(out).toBe("<body><p>Letter</p></body>");
    expect(out).not.toContain("sync-textbox");
    expect(out).not.toContain("</div></div>");
  });

  it("removes three or more nesting levels inside a single box", () => {
    const html =
      '<body><div class="sync-text-boxes">' +
      '<div class="sync-textbox"><div class="inner"><div class="deepest">X</div></div></div>' +
      "</div></body>";
    expect(removeSyncTextBoxesOverlays(html)).toBe("<body></body>");
  });

  it("removes multiple sibling sync-text-boxes overlays (e.g. duplicated markup)", () => {
    const html =
      '<body><div class="sync-text-boxes"><div class="sync-textbox">A</div></div>' +
      '<p>keep me</p>' +
      '<div class="sync-text-boxes"><div class="sync-textbox">B</div><div class="sync-textbox">C</div></div></body>';
    const out = removeSyncTextBoxesOverlays(html);
    expect(out).toBe("<body><p>keep me</p></body>");
  });

  it("preserves normal nested div content that merely shares no class name collision", () => {
    const html =
      '<body><div class="content-area"><div class="letter-block"><div class="inner">Keep this</div></div></div></body>';
    expect(removeSyncTextBoxesOverlays(html)).toBe(html);
  });
});

describe("injectOfferTextBoxesMarker + extractOfferTextBoxes round trip", () => {
  it("persists and re-extracts multiple floating boxes without corrupting the page", () => {
    const boxes = [makeBox({ id: "a", content: "First" }), makeBox({ id: "b", content: "Second", type: "image" })];
    const page = "<!doctype html><html><body><div class=\"content-area\">Letter body</div></body></html>";
    const injected = injectOfferTextBoxesMarker(page, boxes);

    expect(injected).toContain("Letter body");
    const roundTripped = extractOfferTextBoxes(injected);
    expect(roundTripped).toHaveLength(2);
    expect(roundTripped.map((b) => b.id)).toEqual(["a", "b"]);

    // Re-injecting (simulating a second edit) must not leave stray markup behind —
    // this is the scenario that triggers the nested-div regex bug when there are 2+ boxes.
    const reInjected = injectOfferTextBoxesMarker(injected, boxes);
    const occurrences = reInjected.split('class="sync-text-boxes"').length - 1;
    expect(occurrences).toBe(1);
    expect(extractOfferTextBoxes(reInjected)).toHaveLength(2);
  });
});
