import { describe, expect, it } from "vitest";
import {
  applyOfferPlaceholders,
  applyOfferPlaceholdersHtml,
  escapeOfferHtmlAttr,
  escapeOfferHtmlText,
  sanitizeOfferUrlValue,
} from "../offerLetterPlaceholders";

describe("escapeOfferHtmlText", () => {
  it("escapes &, < and >", () => {
    expect(escapeOfferHtmlText('<b>Tom & "Jerry"</b>')).toBe(
      "&lt;b&gt;Tom &amp; \"Jerry\"&lt;/b&gt;",
    );
  });
});

describe("escapeOfferHtmlAttr", () => {
  it("escapes &, <, >, single and double quotes", () => {
    expect(escapeOfferHtmlAttr(`<x> & "y" & 'z'`)).toBe(
      "&lt;x&gt; &amp; &quot;y&quot; &amp; &#39;z&#39;",
    );
  });
});

describe("sanitizeOfferUrlValue", () => {
  it("allows http/https/mailto/tel and relative/fragment URLs", () => {
    expect(sanitizeOfferUrlValue("https://example.com/logo.png")).toBe(
      "https://example.com/logo.png",
    );
    expect(sanitizeOfferUrlValue("http://example.com")).toBe("http://example.com");
    expect(sanitizeOfferUrlValue("mailto:hr@example.com")).toBe("mailto:hr@example.com");
    expect(sanitizeOfferUrlValue("tel:+911234567890")).toBe("tel:+911234567890");
    expect(sanitizeOfferUrlValue("/assets/logo.png")).toBe("/assets/logo.png");
    expect(sanitizeOfferUrlValue("./logo.png")).toBe("./logo.png");
    expect(sanitizeOfferUrlValue("#section")).toBe("#section");
    expect(sanitizeOfferUrlValue("logo.png")).toBe("logo.png");
  });

  it("allows data:image/* base64 URLs", () => {
    const v = "data:image/png;base64,iVBORw0KGgo=";
    expect(sanitizeOfferUrlValue(v)).toBe(v);
  });

  it("rejects javascript:, vbscript: and data:text/html schemes", () => {
    expect(sanitizeOfferUrlValue("javascript:alert(1)")).toBe("");
    expect(sanitizeOfferUrlValue("JavaScript:alert(1)")).toBe("");
    expect(sanitizeOfferUrlValue("vbscript:msgbox(1)")).toBe("");
    expect(sanitizeOfferUrlValue("data:text/html,<script>alert(1)</script>")).toBe("");
  });

  it("rejects values containing control characters", () => {
    expect(sanitizeOfferUrlValue("java\x00script:alert(1)")).toBe("");
  });
});

describe("applyOfferPlaceholders (raw, plain-text contexts)", () => {
  it("still substitutes without escaping — used for subject/filename, not HTML", () => {
    expect(
      applyOfferPlaceholders("Offer — {{candidate_name}}", { candidate_name: "A & B" }),
    ).toBe("Offer — A & B");
  });
});

describe("applyOfferPlaceholdersHtml", () => {
  it("escapes < and > in candidate names inside text content", () => {
    const out = applyOfferPlaceholdersHtml("<p>Dear {{candidate_name}},</p>", {
      candidate_name: "<b>Admin</b>",
    });
    expect(out).toBe("<p>Dear &lt;b&gt;Admin&lt;/b&gt;,</p>");
    expect(out).not.toContain("<b>Admin</b>");
  });

  it("escapes ampersands in text content", () => {
    const out = applyOfferPlaceholdersHtml("<p>{{company_name}}</p>", {
      company_name: "Johnson & Johnson",
    });
    expect(out).toBe("<p>Johnson &amp; Johnson</p>");
  });

  it("escapes single and double quotes when the placeholder sits inside an attribute", () => {
    const out = applyOfferPlaceholdersHtml('<span title="{{candidate_name}}">x</span>', {
      candidate_name: `O'Brien "VP"`,
    });
    expect(out).toBe('<span title="O&#39;Brien &quot;VP&quot;">x</span>');
  });

  it("neutralizes a <script> payload in a candidate value instead of executing it", () => {
    const out = applyOfferPlaceholdersHtml("<p>{{candidate_name}}</p>", {
      candidate_name: "<script>alert(1)</script>",
    });
    expect(out).not.toContain("<script>");
    expect(out).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("escapes multiple placeholders in one document and preserves surrounding template HTML", () => {
    const out = applyOfferPlaceholdersHtml(
      '<html><body><p class="date-line">Ref: {{ref_number}} | {{date}}</p><p>Dear {{candidate_name}}, your role is {{role_title}}.</p></body></html>',
      {
        ref_number: "OL-2026-0001",
        date: "09 Nov 2026",
        candidate_name: "Jane & Co",
        role_title: "Engineer <Lead>",
      },
    );
    expect(out).toContain('<html><body><p class="date-line">Ref: OL-2026-0001 | 09 Nov 2026</p>');
    expect(out).toContain("<p>Dear Jane &amp; Co, your role is Engineer &lt;Lead&gt;.</p></body></html>");
  });

  it("leaves unmatched tokens untouched", () => {
    const out = applyOfferPlaceholdersHtml("<p>{{unknown_key}}</p>", {});
    expect(out).toBe("<p>{{unknown_key}}</p>");
  });

  it("validates the URL scheme for a URL-bearing attribute that is purely a placeholder", () => {
    const safe = applyOfferPlaceholdersHtml('<img class="letterhead-bg" src="{{letterhead_url}}" alt="" />', {
      letterhead_url: "https://cdn.example.com/letterhead.png",
    });
    expect(safe).toContain('src="https://cdn.example.com/letterhead.png"');

    const unsafe = applyOfferPlaceholdersHtml('<img class="letterhead-bg" src="{{letterhead_url}}" alt="" />', {
      letterhead_url: "javascript:alert(1)",
    });
    expect(unsafe).toContain('src=""');
    expect(unsafe).not.toContain("javascript:");
  });

  it("rejects an unsafe scheme placed in an href attribute", () => {
    const out = applyOfferPlaceholdersHtml('<a href="{{candidate_name}}">link</a>', {
      candidate_name: "javascript:alert(document.cookie)",
    });
    expect(out).toContain('href=""');
    expect(out).not.toContain("javascript:");
  });

  it("allows a legitimate https URL through an href attribute", () => {
    const out = applyOfferPlaceholdersHtml('<a href="{{company_website}}">site</a>', {
      company_website: "https://example.com",
    });
    expect(out).toBe('<a href="https://example.com">site</a>');
  });
});
