import type { CSSProperties } from "react";

export type PublicFormBrand = {
  companyName: string;
  logoUrl: string;
  headerImageUrl: string;
  formBg: string;
  fieldBg: string;
  textColor: string;
  accentColor: string;
  /** Input border color (default black). */
  fieldBorderColor: string;
  /** Input border width in px (1–4). */
  fieldBorderWidth: number;
  /** Section box border color (default black). */
  sectionBorderColor: string;
  /** Section / card border width in px (1–4). */
  sectionBorderWidth: number;
  /** Color for the intro line under the form title (e.g. "Fill in your details…"). */
  descriptionColor: string;
  /** Company name font size in px (brand bar). */
  companyNameFontSize: number;
};

export const DEFAULT_PUBLIC_FORM_BRAND: PublicFormBrand = {
  companyName: "Student Survey Form",
  logoUrl: "",
  headerImageUrl: "",
  formBg: "#ffffff",
  fieldBg: "#ffffff",
  textColor: "#111827",
  accentColor: "#2ECC71",
  fieldBorderColor: "#000000",
  fieldBorderWidth: 1,
  sectionBorderColor: "#000000",
  sectionBorderWidth: 2,
  descriptionColor: "#6b7280",
  companyNameFontSize: 17,
};

function clampBorderWidth(value: unknown, fallback = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(4, Math.max(1, Math.round(n)));
}

function clampFontSize(value: unknown, fallback = 17): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(48, Math.max(12, Math.round(n)));
}

/** Parse meta_json whether API returns an object or a JSON string. */
export function parseFormMetaJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  return {};
}

/** Parse #rgb / #rrggbb; returns null if not a hex color. */
function parseHexColor(raw: string): string | null {
  const v = raw.trim();
  const hex6 = /^#([0-9a-fA-F]{6})$/;
  const hex6bare = /^([0-9a-fA-F]{6})$/;
  const hex3 = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/;
  if (hex6.test(v)) return v.toLowerCase();
  if (hex6bare.test(v)) return `#${v.toLowerCase()}`;
  const m3 = v.match(hex3);
  if (m3) {
    return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toLowerCase();
  }
  return null;
}

/** Normalize to #rrggbb for color inputs and CSS. */
export function normalizeFormColor(value: unknown, fallback: string): string {
  const fb = parseHexColor(fallback) ?? "#000000";
  if (value === null || value === undefined) return fb;
  const raw = String(value).trim();
  if (raw === "") return fb;

  const hex = parseHexColor(raw);
  if (hex) return hex;

  // Accept other valid CSS colors (e.g. rgb(), named colors) for text fields.
  if (typeof document !== "undefined") {
    const probe = document.createElement("div");
    probe.style.color = raw;
    if (probe.style.color !== "") return raw;
  }

  return fb;
}

/** Company name on public forms: only the explicit meta value (no org fallback). */
export function resolveFormCompanyName(companyName: unknown): string {
  return String(companyName ?? "").trim();
}

export function publicFormBrandFromMeta(
  meta: Record<string, unknown> | null | undefined,
): PublicFormBrand {
  const m = parseFormMetaJson(meta);
  return {
    companyName: resolveFormCompanyName(m.company_name),
    logoUrl: String(m.logo_url || ""),
    headerImageUrl: String(m.header_image_url || ""),
    formBg: normalizeFormColor(m.form_bg, DEFAULT_PUBLIC_FORM_BRAND.formBg),
    fieldBg: normalizeFormColor(m.field_bg, DEFAULT_PUBLIC_FORM_BRAND.fieldBg),
    textColor: normalizeFormColor(m.text_color, DEFAULT_PUBLIC_FORM_BRAND.textColor),
    accentColor: normalizeFormColor(m.accent_color, DEFAULT_PUBLIC_FORM_BRAND.accentColor),
    fieldBorderColor: normalizeFormColor(m.field_border_color, DEFAULT_PUBLIC_FORM_BRAND.fieldBorderColor),
    fieldBorderWidth: clampBorderWidth(m.field_border_width, DEFAULT_PUBLIC_FORM_BRAND.fieldBorderWidth),
    sectionBorderColor: normalizeFormColor(m.section_border_color, DEFAULT_PUBLIC_FORM_BRAND.sectionBorderColor),
    sectionBorderWidth: clampBorderWidth(m.section_border_width, DEFAULT_PUBLIC_FORM_BRAND.sectionBorderWidth),
    descriptionColor: normalizeFormColor(m.description_color, DEFAULT_PUBLIC_FORM_BRAND.descriptionColor),
    companyNameFontSize: clampFontSize(m.company_name_font_size, DEFAULT_PUBLIC_FORM_BRAND.companyNameFontSize),
  };
}

export function publicFormBrandToCssVars(brand: PublicFormBrand): Record<string, string> {
  return {
    "--sp-form-bg": brand.formBg,
    "--sp-field-bg": brand.fieldBg,
    "--sp-text": brand.textColor,
    "--sp-text-muted": `${brand.textColor}cc`,
    "--sp-accent": brand.accentColor,
    "--sp-field-border": brand.fieldBorderColor,
    "--sp-field-border-width": `${brand.fieldBorderWidth}px`,
    "--sp-section-border": brand.sectionBorderColor,
    "--sp-section-border-width": `${brand.sectionBorderWidth}px`,
    "--sp-description-color": brand.descriptionColor,
    "--sp-company-name-size": `${brand.companyNameFontSize}px`,
  };
}

/** Inline styles: CSS variables plus explicit colors (more reliable than vars alone). */
export function publicFormBrandToStyle(brand: PublicFormBrand): CSSProperties {
  return {
    ...publicFormBrandToCssVars(brand),
    backgroundColor: brand.formBg,
    color: brand.textColor,
  } as CSSProperties;
}
