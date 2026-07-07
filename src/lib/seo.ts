/** SEO helpers — CRM is noindex by default; only public routes are indexable. */

export const SEO_SITE_NAME = "Syncpedia";
export const SEO_MARKETING_ORIGIN = "https://syncpedia.in";
export const SEO_CRM_ORIGIN = "https://crm.syncpedia.in";
export const SEO_DEFAULT_OG_IMAGE = `${SEO_CRM_ORIGIN}/logo.png`;

export type PageMetaInput = {
  title: string;
  description?: string;
  canonical?: string;
  robots?: "index, follow" | "noindex, nofollow";
  ogImage?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
};

function upsertMeta(name: string, content: string, attr: "name" | "property" = "name") {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function removeJsonLd(id: string) {
  document.getElementById(id)?.remove();
}

function applyJsonLd(id: string, data: Record<string, unknown> | Record<string, unknown>[]) {
  removeJsonLd(id);
  const script = document.createElement("script");
  script.id = id;
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

export function setPageMeta(input: PageMetaInput) {
  if (typeof document === "undefined") return;

  document.title = input.title;

  if (input.description) {
    upsertMeta("description", input.description);
    upsertMeta("og:description", input.description, "property");
    upsertMeta("twitter:description", input.description);
  }

  upsertMeta("og:title", input.title, "property");
  upsertMeta("twitter:title", input.title);

  const robots = input.robots ?? "noindex, nofollow";
  upsertMeta("robots", robots);
  upsertMeta("googlebot", robots);

  const ogImage = input.ogImage || SEO_DEFAULT_OG_IMAGE;
  upsertMeta("og:image", ogImage, "property");
  upsertMeta("twitter:image", ogImage);
  upsertMeta("og:type", "website", "property");

  if (input.canonical) {
    upsertLink("canonical", input.canonical);
  }

  if (input.jsonLd) {
    applyJsonLd("page-json-ld", input.jsonLd);
  } else {
    removeJsonLd("page-json-ld");
  }
}

/** Paths that search engines may index on the CRM subdomain. */
export function isPublicIndexablePath(pathname: string): boolean {
  const p = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (p === "/apply") return true;
  if (p.startsWith("/verify/")) return true;
  return false;
}

export function defaultCrmNoIndexMeta() {
  setPageMeta({
    title: "Syncpedia CRM — Login",
    description: "Internal CRM for Syncpedia partner organizations. Not a public marketing site.",
    robots: "noindex, nofollow",
  });
}

export function applyRouteMeta(pathname: string, search: string) {
  const base = typeof window !== "undefined" ? window.location.origin : SEO_CRM_ORIGIN;

  if (pathname.startsWith("/verify/")) {
    setPageMeta({
      title: "Verify Certificate | Syncpedia",
      description: "Verify an issued training certificate from Syncpedia partner organizations.",
      canonical: `${base}${pathname}${search}`,
      robots: "index, follow",
    });
    return;
  }

  if (pathname === "/apply" || pathname.startsWith("/apply/")) {
    const params = new URLSearchParams(search);
    const formSlug = params.get("form")?.trim();
    const title = formSlug === "career-guidance"
      ? "Free Career Guidance for Students"
      : formSlug
        ? `${formSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} | Apply`
        : "Apply | Career & Course Enquiry";
    const description = formSlug === "career-guidance"
      ? "Get free career guidance from our experts. Discover the right course and career path for you in India."
      : "Submit your application or enquiry. Syncpedia partner training organizations.";
    setPageMeta({
      title: `${title} — Syncpedia`,
      description,
      canonical: `${base}/apply${formSlug ? `?form=${encodeURIComponent(formSlug)}` : ""}`,
      robots: "index, follow",
      jsonLd: formSlug
        ? {
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: title,
            description,
            url: `${base}/apply?form=${encodeURIComponent(formSlug)}`,
            isPartOf: { "@type": "WebSite", name: SEO_SITE_NAME, url: SEO_MARKETING_ORIGIN },
          }
        : undefined,
    });
    return;
  }

  defaultCrmNoIndexMeta();
}
