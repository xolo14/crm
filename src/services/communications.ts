import { getApiBase } from '@/lib/apiBase';
import type {
  ApplyLibraryTemplateResult,
  CommWhatsappMessage,
  DialerContact,
  HubSummary,
  EmbeddedSignupLaunchConfig,
  MetaPartnerConfig,
  NumberAssignment,
  OrgWhatsappConfig,
  OrgWhatsappOverview,
  PlatformTemplateLibraryItem,
  VirtualNumber,
  WaAssignableMember,
  WaConversation,
  WhatsappTemplate,
} from '@/types/communications';

const API_BASE = getApiBase();

function getToken(): string | null {
  return localStorage.getItem('hr_token') || localStorage.getItem('auth_token');
}

async function commRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let message = 'Request failed';
    const err = data?.error;
    if (typeof err === 'string' && err.trim()) {
      message = err;
      try {
        const parsed = JSON.parse(err) as { detail?: string; message?: string };
        message = parsed.detail || parsed.message || err;
      } catch {
        /* use raw string */
      }
    }
    const detail = typeof data?.detail === 'string' ? data.detail.trim() : '';
    const hint = typeof data?.message === 'string' ? data.message.trim() : '';
    if (detail && !message.includes(detail)) {
      message = `${message}: ${detail}`;
    } else if (hint && message === 'PHP fatal error') {
      message = hint;
    }
    const detailErr = data?.details?.error;
    if (typeof detailErr === 'string' && detailErr.trim()) {
      message = detailErr;
    }
    throw new Error(message);
  }
  return data as T;
}

export const communicationsApi = {
  hubSummary: () => commRequest<HubSummary>('/communications.php?action=hub_summary'),

  orgConfig: (orgId?: string) =>
    commRequest<{ data: OrgWhatsappConfig | null; webhook_url_suggested?: string; org_id?: string }>(
      `/communications.php?action=org_config${orgId ? `&org_id=${encodeURIComponent(orgId)}` : ''}`,
    ),
  saveOrgConfig: (body: Partial<OrgWhatsappConfig> & { org_id?: string }) =>
    commRequest('/communications.php?action=org_config', { method: 'PUT', body: JSON.stringify(body) }),

  orgsOverview: () =>
    commRequest<{ data: OrgWhatsappOverview[] }>('/communications.php?action=orgs_overview'),

  virtualNumbers: (orgId?: string) =>
    commRequest<{ data: VirtualNumber[] }>(
      `/communications.php?action=virtual_numbers${orgId ? `&org_id=${encodeURIComponent(orgId)}` : ''}`,
    ),
  addVirtualNumber: (body: Partial<VirtualNumber> & { phone_number: string; org_id?: string }) =>
    commRequest('/communications.php?action=virtual_numbers', { method: 'POST', body: JSON.stringify(body) }),
  updateVirtualNumber: (id: string, body: Partial<VirtualNumber>) =>
    commRequest(`/communications.php?action=virtual_numbers&id=${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteVirtualNumber: (id: string) =>
    commRequest(`/communications.php?action=virtual_numbers&id=${id}`, { method: 'DELETE' }),

  myNumberAssignments: () =>
    commRequest<{ data: NumberAssignment[] }>('/communications.php?action=number_assignments'),
  numberAssignments: (virtualNumberId: string) =>
    commRequest<{ data: NumberAssignment[] }>(
      `/communications.php?action=number_assignments&virtual_number_id=${encodeURIComponent(virtualNumberId)}`,
    ),
  assignNumber: (virtualNumberId: string, userId: string) =>
    commRequest('/communications.php?action=number_assignments', {
      method: 'POST',
      body: JSON.stringify({ virtual_number_id: virtualNumberId, user_id: userId }),
    }),
  removeAssignment: (id: string) =>
    commRequest(`/communications.php?action=number_assignments&id=${id}`, { method: 'DELETE' }),

  templates: (params?: { status?: string; orgId?: string }) => {
    const q = new URLSearchParams({ action: 'templates' });
    if (params?.status) q.set('status', params.status);
    if (params?.orgId) q.set('org_id', params.orgId);
    return commRequest<{ data: WhatsappTemplate[] }>(`/communications.php?${q}`);
  },
  createTemplate: (body: Partial<WhatsappTemplate> & { name: string; body: string; mark_approved?: boolean; provider_template_id?: string }) =>
    commRequest('/communications.php?action=templates', { method: 'POST', body: JSON.stringify(body) }),
  updateTemplate: (id: string, body: Record<string, unknown>) =>
    commRequest(`/communications.php?action=templates&id=${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteTemplate: (id: string) =>
    commRequest('/communications.php?action=delete_template', {
      method: 'POST',
      body: JSON.stringify({ id, action: 'delete_template' }),
    }),

  testWhatsappConnection: (opts?: {
    orgId?: string;
    api_key?: string;
    provider?: string;
    app_secret?: string;
    phone_number_id?: string;
    waba_id?: string;
  }) => {
    const body: Record<string, string> = {};
    if (opts?.orgId) body.org_id = opts.orgId;
    if (opts?.api_key) body.api_key = opts.api_key;
    if (opts?.provider) body.provider = opts.provider;
    if (opts?.app_secret) body.app_secret = opts.app_secret;
    if (opts?.phone_number_id) body.phone_number_id = opts.phone_number_id;
    if (opts?.waba_id) body.waba_id = opts.waba_id;
    return commRequest<{ message: string; provider?: string; data: { display_phone_number?: string; verified_name?: string; warning?: string } }>(
      '/communications.php?action=test_whatsapp_connection',
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  /** @deprecated Use testWhatsappConnection */
  testMetaConnection: (orgId?: string) =>
    commRequest<{ message: string; provider?: string; data: { display_phone_number?: string; verified_name?: string } }>(
      '/communications.php?action=test_whatsapp_connection',
      { method: 'POST', body: JSON.stringify(orgId ? { org_id: orgId } : {}) },
    ),

  embeddedSignupLaunch: () =>
    commRequest<{ data: EmbeddedSignupLaunchConfig; ready: boolean }>(
      '/communications.php?action=embedded_signup_launch',
    ),

  completeEmbeddedSignup: (body: {
    code: string;
    phone_number_id: string;
    waba_id: string;
    org_id?: string;
  }) =>
    commRequest<{
      message: string;
      org_id: string;
      data: {
        display_phone_number?: string;
        verified_name?: string;
        phone_number_id?: string;
        waba_id?: string;
        webhook_verify_token?: string;
        webhook_url_suggested?: string;
      };
    }>('/communications.php?action=complete_embedded_signup', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  syncMetaTemplates: (orgId?: string) =>
    commRequest<{ message: string; imported: number; updated: number; total: number }>(
      '/communications.php?action=sync_meta_templates',
      { method: 'POST', body: JSON.stringify(orgId ? { org_id: orgId } : {}) },
    ),

  submitTemplateToMeta: (templateId: string) =>
    commRequest('/communications.php?action=submit_template_meta', {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId }),
    }),

  sendWhatsapp: (body: {
    recipient_phone: string;
    template_id: string;
    variables?: string[];
    recipient_name?: string;
    virtual_number_id?: string;
    lead_id?: string;
  }) => commRequest('/communications.php?action=send_whatsapp', { method: 'POST', body: JSON.stringify(body) }),

  sendWhatsappReply: (body: {
    recipient_phone: string;
    message: string;
    recipient_name?: string;
    lead_id?: string;
  }) =>
    commRequest<{ id: string; status: string; conversation_id?: string }>(
      '/communications.php?action=send_whatsapp_reply',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  messages: (limit = 30, conversationId?: string) => {
    const q = new URLSearchParams({ action: 'messages', limit: String(limit) });
    if (conversationId) q.set('conversation_id', conversationId);
    return commRequest<{ data: CommWhatsappMessage[]; conversation?: WaConversation }>(
      `/communications.php?${q}`,
    );
  },

  conversations: (limit = 50) =>
    commRequest<{ data: WaConversation[]; can_assign: boolean; scope: 'org' | 'mine' }>(
      `/communications.php?action=conversations&limit=${limit}`,
    ),

  assignableMembers: () =>
    commRequest<{ data: WaAssignableMember[] }>('/communications.php?action=assignable_members'),

  assignConversation: (conversationId: string, assignedTo: string | null) =>
    commRequest<{ message: string; data: WaConversation }>('/communications.php?action=assign_conversation', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: conversationId, assigned_to: assignedTo }),
    }),

  dialerContacts: (search = '') =>
    commRequest<{ data: DialerContact[] }>(
      `/communications.php?action=dialer_contacts&search=${encodeURIComponent(search)}`,
    ),

  metaPartnerConfig: () =>
    commRequest<{ data: MetaPartnerConfig }>('/communications.php?action=meta_partner_config'),
  saveMetaPartnerConfig: (body: Partial<MetaPartnerConfig>) =>
    commRequest('/communications.php?action=meta_partner_config', { method: 'PUT', body: JSON.stringify(body) }),

  templateLibrary: (category?: string) =>
    commRequest<{ data: PlatformTemplateLibraryItem[]; partner_active: boolean }>(
      `/communications.php?action=template_library${category ? `&category=${encodeURIComponent(category)}` : ''}`,
    ),
  createLibraryTemplate: (body: Partial<PlatformTemplateLibraryItem>) =>
    commRequest('/communications.php?action=template_library', { method: 'POST', body: JSON.stringify(body) }),
  updateLibraryTemplate: (id: string, body: Partial<PlatformTemplateLibraryItem>) =>
    commRequest(`/communications.php?action=template_library&id=${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteLibraryTemplate: (id: string) =>
    commRequest(`/communications.php?action=template_library&id=${id}`, { method: 'DELETE' }),

  applyLibraryTemplate: (body: {
    platform_template_id: string;
    customization?: { name?: string; body?: string; header_text?: string; footer?: string };
    submit_to_meta?: boolean;
  }) =>
    commRequest<ApplyLibraryTemplateResult>('/communications.php?action=apply_library_template', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  publishPartnerTemplate: (platformTemplateId: string) =>
    commRequest('/communications.php?action=publish_partner_template', {
      method: 'POST',
      body: JSON.stringify({ platform_template_id: platformTemplateId }),
    }),
};
