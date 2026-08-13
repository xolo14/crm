/** Brand / presentation meta for document forms (mirrors lead form meta_json keys). */

import {
  DEFAULT_PUBLIC_FORM_BRAND,
  normalizeFormColor,
  parseFormMetaJson,
  publicFormBrandFromMeta,
  type PublicFormBrand,
} from "@/components/forms/publicFormTypes";

const PRIMARY_GREEN = "#1D9E75";

export type DocFormBrandState = {
  companyName: string;
  companyLogoUrl: string;
  headerImageUrl: string;
  formBg: string;
  fieldBg: string;
  textColor: string;
  accentColor: string;
  fieldBorderColor: string;
  fieldBorderWidth: number;
  sectionBorderColor: string;
  sectionBorderWidth: number;
  descriptionColor: string;
  companyNameFontSize: number;
};

export const DEFAULT_DOC_FORM_BRAND_STATE: DocFormBrandState = {
  companyName: "",
  companyLogoUrl: "",
  headerImageUrl: "",
  formBg: "#ffffff",
  fieldBg: "#ffffff",
  textColor: "#111827",
  accentColor: PRIMARY_GREEN,
  fieldBorderColor: "#000000",
  fieldBorderWidth: 1,
  sectionBorderColor: "#000000",
  sectionBorderWidth: 2,
  descriptionColor: "#6b7280",
  companyNameFontSize: 17,
};

export function brandStateFromMeta(meta: unknown): DocFormBrandState {
  const m = parseFormMetaJson(meta);
  return {
    companyName: typeof m.company_name === "string" ? m.company_name : "",
    companyLogoUrl: typeof m.logo_url === "string" ? m.logo_url : "",
    headerImageUrl: typeof m.header_image_url === "string" ? m.header_image_url : "",
    formBg: normalizeFormColor(m.form_bg, DEFAULT_DOC_FORM_BRAND_STATE.formBg),
    fieldBg: normalizeFormColor(m.field_bg, DEFAULT_DOC_FORM_BRAND_STATE.fieldBg),
    textColor: normalizeFormColor(m.text_color, DEFAULT_DOC_FORM_BRAND_STATE.textColor),
    accentColor: normalizeFormColor(m.accent_color, PRIMARY_GREEN),
    fieldBorderColor: normalizeFormColor(m.field_border_color, DEFAULT_DOC_FORM_BRAND_STATE.fieldBorderColor),
    fieldBorderWidth: Math.min(4, Math.max(1, Number(m.field_border_width) || 1)),
    sectionBorderColor: normalizeFormColor(m.section_border_color, DEFAULT_DOC_FORM_BRAND_STATE.sectionBorderColor),
    sectionBorderWidth: Math.min(4, Math.max(1, Number(m.section_border_width) || 2)),
    descriptionColor: normalizeFormColor(m.description_color, DEFAULT_DOC_FORM_BRAND_STATE.descriptionColor),
    companyNameFontSize: Math.min(48, Math.max(12, Number(m.company_name_font_size) || 17)),
  };
}

export function metaFromBrandState(state: DocFormBrandState): Record<string, unknown> {
  return {
    company_name: state.companyName.trim(),
    logo_url: state.companyLogoUrl.trim(),
    header_image_url: state.headerImageUrl.trim(),
    form_bg: state.formBg,
    field_bg: state.fieldBg,
    text_color: state.textColor,
    accent_color: state.accentColor,
    field_border_color: state.fieldBorderColor,
    field_border_width: state.fieldBorderWidth,
    section_border_color: state.sectionBorderColor,
    section_border_width: state.sectionBorderWidth,
    description_color: state.descriptionColor,
    company_name_font_size: state.companyNameFontSize,
  };
}

export function publicBrandFromDocMeta(meta: unknown): PublicFormBrand {
  const parsed = parseFormMetaJson(meta);
  if (Object.keys(parsed).length === 0) {
    return {
      ...DEFAULT_PUBLIC_FORM_BRAND,
      companyName: "",
      accentColor: PRIMARY_GREEN,
    };
  }
  return publicFormBrandFromMeta(parsed);
}
