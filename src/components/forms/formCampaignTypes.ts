import { isL3AdminRole, isMarketingFamilyRole, normalizeAppRole } from "@/lib/roleUtils";

export type FormCampaignTemplate = {
  id: string;
  name: string;
  subject?: string;
  source: "marketing" | "communications";
  channel: "email" | "whatsapp";
  language?: string;
};

export type FormCampaignConfig = {
  assign_email?: boolean;
  assign_whatsapp?: boolean;
  email_source?: "marketing" | "communications";
  email_template_id?: string;
  whatsapp_source?: "marketing" | "communications";
  whatsapp_template_id?: string;
  auto_send_email?: boolean;
  auto_send_whatsapp?: boolean;
};

export const EMPTY_FORM_CAMPAIGN: FormCampaignConfig = {
  assign_email: false,
  assign_whatsapp: false,
  email_source: "marketing",
  email_template_id: "",
  whatsapp_source: "marketing",
  whatsapp_template_id: "",
  auto_send_email: false,
  auto_send_whatsapp: false,
};

export function parseFormCampaign(meta?: Record<string, unknown> | null): FormCampaignConfig {
  const raw = meta?.campaign;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...EMPTY_FORM_CAMPAIGN };
  }
  const c = raw as Record<string, unknown>;
  return {
    ...EMPTY_FORM_CAMPAIGN,
    assign_email: Boolean(c.assign_email),
    assign_whatsapp: Boolean(c.assign_whatsapp),
    email_source: c.email_source === "communications" ? "communications" : "marketing",
    email_template_id: String(c.email_template_id ?? ""),
    whatsapp_source: c.whatsapp_source === "communications" ? "communications" : "marketing",
    whatsapp_template_id: String(c.whatsapp_template_id ?? ""),
    auto_send_email: Boolean(c.auto_send_email),
    auto_send_whatsapp: Boolean(c.auto_send_whatsapp),
  };
}

export function canManageFormCampaigns(
  role: string | null | undefined,
  userId: string | null | undefined,
  formCreatedBy: string | null | undefined,
  formOrgId?: string | null,
  userOrgId?: string | null,
): boolean {
  const r = normalizeAppRole(role);
  if (r === "super_admin") return true;

  const formOrg = String(formOrgId || "").trim();
  const userOrg = String(userOrgId || "").trim();
  if (isL3AdminRole(r)) {
    return formOrg !== "" && userOrg !== "" && formOrg === userOrg;
  }

  if (!isMarketingFamilyRole(r)) return false;
  if (String(formCreatedBy || "") !== "" && String(formCreatedBy) === String(userId || "")) {
    return true;
  }
  return formOrg !== "" && userOrg !== "" && formOrg === userOrg;
}
