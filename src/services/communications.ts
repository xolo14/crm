import { getApiBase } from '@/lib/apiBase';
import type {
  ApplyLibraryTemplateResult,
  CommWhatsappMessage,
  DialerContact,
  HubSummary,
  MetaPartnerConfig,
  NumberAssignment,
  OrgWhatsappConfig,
  OrgWhatsappOverview,
  PlatformTemplateLibraryItem,
  VirtualNumber,
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
  if (!res.ok) throw new Error(data?.error || 'Request failed');
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

  testWhatsappConnection: (orgId?: string) =>
    commRequest<{ message: string; provider?: string; data: { display_phone_number?: string; verified_name?: string } }>(
      '/communications.php?action=test_whatsapp_connection',
      { method: 'POST', body: JSON.stringify(orgId ? { org_id: orgId } : {}) },
    ),

  /** @deprecated Use testWhatsappConnection */
  testMetaConnection: (orgId?: string) =>
    commRequest<{ message: string; provider?: string; data: { display_phone_number?: string; verified_name?: string } }>(
      '/communications.php?action=test_whatsapp_connection',
      { method: 'POST', body: JSON.stringify(orgId ? { org_id: orgId } : {}) },
    ),

  approveInteraktTemplate: (templateId: string, providerTemplateId?: string) =>
    commRequest('/communications.php?action=approve_interakt_template', {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId, provider_template_id: providerTemplateId }),
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

  messages: (limit = 30) =>
    commRequest<{ data: CommWhatsappMessage[] }>(`/communications.php?action=messages&limit=${limit}`),

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
