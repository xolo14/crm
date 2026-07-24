export type TemplateCategory = 'utility' | 'marketing' | 'authentication';
export type PartnerStatus = 'pending' | 'in_review' | 'verified' | 'official';
export type BusinessVerification = 'not_started' | 'submitted' | 'verified' | 'rejected';

export interface TemplateVariableDef {
  key: string;
  label: string;
  example?: string;
  required?: boolean;
}

export interface PlatformTemplateLibraryItem {
  id: string;
  slug: string;
  name: string;
  description?: string;
  use_case?: string;
  category: TemplateCategory | string;
  template_type: string;
  language: string;
  header_type: string;
  header_text?: string;
  body: string;
  footer?: string;
  variables?: TemplateVariableDef[] | null;
  editable_fields?: Record<string, boolean> | null;
  meta_partner_preapproved: number | boolean;
  meta_quality_tier?: string;
  sort_order?: number;
  is_active?: number | boolean;
}

export interface EmbeddedSignupLaunchConfig {
  meta_app_id: string;
  embedded_signup_config_id: string;
  embedded_signup_url: string;
  solution_name: string;
  partner_active: boolean;
  ready: boolean;
  missing: string[];
  graph_api_version: string;
  embedded_signup_version?: string;
}

export interface MetaPartnerConfig {
  id?: string;
  partner_status: PartnerStatus | string;
  business_verification: BusinessVerification | string;
  meta_app_id?: string;
  meta_app_secret?: string;
  meta_app_secret_masked?: string;
  meta_app_secret_set?: boolean;
  meta_partner_business_id?: string;
  master_waba_id?: string;
  system_user_token?: string;
  system_user_token_masked?: string;
  system_user_token_set?: boolean;
  embedded_signup_config_id?: string;
  embedded_signup_url?: string;
  solution_name: string;
  partner_contact_email?: string;
  onboarding_notes?: string;
  is_active: number | boolean;
}

export interface ApplyLibraryTemplateResult {
  id: string;
  status: string;
  message: string;
  partner_preapproved?: boolean;
  submit_error?: string;
  library?: { id: string; slug: string; name: string };
  meta?: Record<string, unknown>;
}

export type TemplateStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';

export interface OrgWhatsappConfig {
  id: string;
  org_id?: string;
  provider: string;
  api_key?: string;
  api_key_masked?: string;
  api_key_set?: boolean;
  app_secret?: string;
  app_secret_set?: boolean;
  phone_number_id?: string;
  business_phone?: string;
  waba_id?: string;
  webhook_url?: string;
  webhook_url_suggested?: string;
  webhook_verify_token?: string;
  graph_api_version?: string;
  connection_status?: string;
  is_active: number | boolean;
}

export interface OrgWhatsappOverview {
  id: string;
  name: string;
  slug?: string;
  business_phone?: string;
  connection_status?: string;
  is_active?: number | boolean;
  phone_number_id?: string;
  waba_id?: string;
  updated_at?: string;
  virtual_numbers: number;
  approved_templates: number;
}

export interface VirtualNumber {
  id: string;
  org_id: string;
  org_name?: string;
  phone_number: string;
  label: string;
  provider: string;
  provider_sid?: string;
  whatsapp_enabled: number | boolean;
  calls_enabled: number | boolean;
  is_active: number | boolean;
}

export interface NumberAssignment {
  id: string;
  virtual_number_id: string;
  user_id: string;
  full_name?: string;
  email?: string;
  phone_number?: string;
  label?: string;
  whatsapp_enabled?: number | boolean;
  calls_enabled?: number | boolean;
  org_id?: string;
  org_name?: string;
}

export interface WhatsappTemplate {
  id: string;
  org_id?: string | null;
  org_name?: string;
  name: string;
  category: string;
  language: string;
  header_type: string;
  header_text?: string;
  body: string;
  footer?: string;
  variables?: string[] | null;
  provider_template_id?: string;
  meta_template_id?: string;
  meta_status?: string;
  status: TemplateStatus;
  rejection_reason?: string;
  platform_template_id?: string | null;
  application_source?: 'custom' | 'official_library' | string;
  customization_json?: Record<string, unknown> | null;
  created_by: string;
  created_by_name?: string;
  approved_by?: string;
  approved_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CommWhatsappMessage {
  id: string;
  recipient_phone: string;
  recipient_name?: string;
  message_body?: string;
  status: string;
  error_message?: string | null;
  sender_name?: string;
  created_at?: string;
  sent_at?: string;
  direction?: 'inbound' | 'outbound' | string;
  conversation_id?: string | null;
  sender_phone?: string | null;
  message_type?: string;
  media_url?: string | null;
  template_id?: string | null;
  meta_timestamp?: string | null;
  provider_message_id?: string | null;
}

export interface WaConversation {
  id: string;
  org_id: string;
  lead_id?: string | null;
  contact_phone: string;
  contact_name?: string | null;
  started_by?: string | null;
  assigned_to?: string | null;
  assigned_by?: string | null;
  assigned_at?: string | null;
  started_by_name?: string | null;
  assigned_to_name?: string | null;
  assigned_by_name?: string | null;
  last_message_at?: string | null;
  last_message_preview?: string | null;
  last_message?: string | null;
  unread_count?: number;
  window_open?: number | boolean;
  window_expires_at?: string | null;
}

export interface WaAssignableMember {
  id: string;
  full_name: string;
  email?: string;
  role?: string;
}

export interface DialerContact {
  id: string;
  full_name: string;
  phone: string;
  email?: string;
  status?: string;
  source?: string;
}

export interface HubSummary {
  org_whatsapp: Pick<OrgWhatsappConfig, 'provider' | 'business_phone' | 'is_active' | 'connection_status'> | null;
  my_assigned_numbers: number;
  approved_templates: number;
  org_id?: string;
  meta_partner_active?: boolean;
  official_templates_available?: number;
}
