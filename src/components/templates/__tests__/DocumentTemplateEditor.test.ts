import { describe, expect, it } from "vitest";
import {
  extractContentAreaHtml,
  injectContentAreaHtml,
  stripOfferOverlayArtifacts,
} from "../DocumentTemplateEditor";

describe("stripOfferOverlayArtifacts (nested overlay removal)", () => {
  it("removes an overlay with a single nested box div", () => {
    const html = '<p>Letter</p><div class="sync-text-boxes"><div class="sync-textbox">A</div></div>';
    expect(stripOfferOverlayArtifacts(html)).toBe("<p>Letter</p>");
  });

  it("removes an overlay with multiple nested sibling box divs (the regression case)", () => {
    const html =
      '<p>Letter</p><div class="sync-text-boxes">' +
      '<div class="sync-textbox">A</div>' +
      '<div class="sync-textbox">B</div>' +
      '<div class="sync-imagebox"><img src="x.png" /></div>' +
      "</div>";
    const out = stripOfferOverlayArtifacts(html);
    expect(out).toBe("<p>Letter</p>");
    expect(out).not.toContain("sync-textbox");
    expect(out).not.toContain("</div>");
  });

  it("removes three or more nesting levels inside a single overlay", () => {
    const html =
      '<p>Letter</p><div class="sync-text-boxes">' +
      '<div class="sync-textbox"><div class="row"><div class="cell">deep</div></div></div>' +
      "</div>";
    expect(stripOfferOverlayArtifacts(html)).toBe("<p>Letter</p>");
  });

  it("removes multiple sibling overlay elements", () => {
    const html =
      '<div class="sync-text-boxes"><div class="sync-textbox">A</div></div>' +
      "<p>keep</p>" +
      '<div class="sync-text-boxes"><div class="sync-textbox">B</div><div class="sync-textbox">C</div></div>';
    expect(stripOfferOverlayArtifacts(html)).toBe("<p>keep</p>");
  });

  it("strips the SYNC_* comment markers alongside the overlay markup", () => {
    const html =
      '<!--SYNC_BODY_BOX:{"x":1,"y":2,"width":3,"height":4}-->' +
      '<p>Letter</p>' +
      '<div class="sync-text-boxes"><div class="sync-textbox">A</div></div>' +
      "<!--SYNC_TEXT_BOXES:[]-->";
    expect(stripOfferOverlayArtifacts(html)).toBe("<p>Letter</p>");
  });

  it("preserves legitimate nested document divs that are not sync-text-boxes overlays", () => {
    const html = '<div class="content-area"><div class="block"><div class="inner">Keep this</div></div></div>';
    expect(stripOfferOverlayArtifacts(html)).toBe(html);
  });

  it("does not touch an unrelated element that merely shares a generic class name fragment", () => {
    const html = '<div class="sync-text-boxes-legacy-note">Not an overlay, keep me</div>';
    expect(stripOfferOverlayArtifacts(html)).toBe(html);
  });
});

describe("extractContentAreaHtml / injectContentAreaHtml with floating-box overlays", () => {
  it("extracts content-area inner HTML and leaves a sibling overlay (outside content-area) alone", () => {
    const page =
      '<!doctype html><html><body><div class="content-area"><p>Letter body</p></div>' +
      '<!--SYNC_TEXT_BOXES:[]--><div class="sync-text-boxes"><div class="sync-textbox">A</div><div class="sync-textbox">B</div></div>' +
      "</body></html>";
    const inner = extractContentAreaHtml(page);
    expect(inner).toBe("<p>Letter body</p>");
  });

  it("round-trips inject/extract without leaving stray overlay markup inside content-area", () => {
    const page = '<!doctype html><html><body><div class="content-area"></div></body></html>';
    const withContent = injectContentAreaHtml(page, "<p>New body</p>");
    expect(extractContentAreaHtml(withContent)).toBe("<p>New body</p>");
  });
});
