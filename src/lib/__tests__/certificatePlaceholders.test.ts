import { describe, expect, it } from "vitest";
import { applyCertPlaceholders, applyCertPlaceholdersHtml } from "../certificatePlaceholders";

describe("applyCertPlaceholders (raw, plain-text contexts)", () => {
  it("substitutes without escaping — used for subject text, not HTML", () => {
    expect(applyCertPlaceholders("Certificate for <<Name>>", { recipient_name: "A & B" })).toBe(
      "Certificate for A & B",
    );
  });
});

describe("applyCertPlaceholdersHtml", () => {
  it("escapes < and > in a recipient name inside text content", () => {
    const out = applyCertPlaceholdersHtml("<p>Dear <<Name>>,</p>", {
      recipient_name: "<b>Admin</b>",
    });
    expect(out).toBe("<p>Dear &lt;b&gt;Admin&lt;/b&gt;,</p>");
    expect(out).not.toContain("<b>Admin</b>");
  });

  it("escapes ampersands for {{mustache}} tokens too", () => {
    const out = applyCertPlaceholdersHtml("<p>{{company_name}}</p>", {
      company_name: "Johnson & Johnson",
    });
    expect(out).toBe("<p>Johnson &amp; Johnson</p>");
  });

  it("escapes quotes when the token sits inside an attribute", () => {
    const out = applyCertPlaceholdersHtml('<span title="<<Name>>">x</span>', {
      recipient_name: `O'Brien "VP"`,
    });
    expect(out).toBe('<span title="O&#39;Brien &quot;VP&quot;">x</span>');
  });

  it("neutralizes a <script> payload instead of executing it", () => {
    const out = applyCertPlaceholdersHtml("<p><<Name>></p>", {
      recipient_name: "<script>alert(1)</script>",
    });
    expect(out).not.toContain("<script>");
    expect(out).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("leaves an unresolved token as literal text rather than substituting unsafely", () => {
    const out = applyCertPlaceholdersHtml("<p><<Unknown>></p>", {});
    expect(out).toBe("<p><<Unknown>></p>");
  });
});
