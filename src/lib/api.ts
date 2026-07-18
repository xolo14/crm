// API Configuration - uses relative /api path for production deployment
// Auth tokens live in localStorage (XSS-accessible). CSP in public/.htaccess reduces injection risk;
// HttpOnly cookie auth would be the stronger long-term fix.
import type { FresherMember } from '@/modules/fresherSalary/types';
import { AUTH_PORTAL, loginPathFromSessionPortal } from '@/lib/portalAuth';

import { getApiBase } from '@/lib/apiBase';

const API_BASE = getApiBase();

export interface AuditLogEntry {
  id: string;
  org_id: string | null;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

function getHrToken(): string | null {
  return localStorage.getItem('hr_token');
}

function setToken(token: string) {
  localStorage.setItem('auth_token', token);
}

function clearToken() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
  localStorage.removeItem('auth_org');
  localStorage.removeItem('hr_token');
  localStorage.removeItem('hr_user');
}

function getStoredUser() {
  const u = localStorage.getItem('auth_user');
  return u ? JSON.parse(u) : null;
}

function setStoredUser(user: any) {
  localStorage.setItem('auth_user', JSON.stringify(user));
}

function getStoredOrg() {
  const o = localStorage.getItem('auth_org');
  return o ? JSON.parse(o) : null;
}

function setStoredOrg(org: any) {
  if (org) {
    localStorage.setItem('auth_org', JSON.stringify(org));
  } else {
    localStorage.removeItem('auth_org');
  }
}

async function request(endpoint: string, options: RequestInit = {}) {
  const token = getToken();
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });
  } catch (e) {
    throw new Error('Network error - unable to reach server');
  }

  if (res.status === 401) {
    const raw401 = await res.text();
    let data401: any = {};
    try {
      data401 = raw401 && raw401.trim() ? JSON.parse(raw401) : {};
    } catch {
      /* ignore */
    }
    const isLogin = endpoint.includes('auth.php') && endpoint.includes('action=login');
    if (isLogin) {
      throw new Error(data401.error || 'Invalid email or password');
    }

    clearToken();
    try {
      const path = window.location.pathname || '';
      let target: string;
      if (path === '/auth' || path.endsWith('/auth')) {
        const q = typeof window !== 'undefined' ? window.location.search || '' : '';
        target = q ? `/auth${q}` : AUTH_PORTAL.salesRep;
      } else {
        const portal = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('auth_login_portal') || 'login' : 'login';
        target = loginPathFromSessionPortal(portal);
      }
      window.location.replace(target);
    } catch {
      window.location.replace(AUTH_PORTAL.salesRep);
    }
    throw new Error('Session expired');
  }

  const contentType = res.headers.get('content-type') || '';
  const raw = await res.text();

  function parseJsonBody(text: string): any {
    const trimmed = text.replace(/^\uFEFF/, '').trim();
    if (!trimmed) {
      throw new Error('Server returned empty response');
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(trimmed.slice(start, end + 1));
      }
      throw new Error('Invalid JSON');
    }
  }

  const looksLikeJson = contentType.includes('application/json')
    || raw.trim().startsWith('{')
    || raw.trim().startsWith('[');

  if (!looksLikeJson) {
    const isHtml = /<!DOCTYPE|<html/i.test(raw);
    if (isHtml) {
      throw new Error(
        res.status === 404
          ? 'API not found. Upload the full dist/ folder to Hostinger (must include api/ and root .htaccess).'
          : `Server returned HTML instead of JSON (HTTP ${res.status}). Edit api/config.php with MySQL credentials from Hostinger → Databases, then open /api/ping.php to verify.`,
      );
    }
    throw new Error(
      `Server error (HTTP ${res.status}). Open /api/ping.php on your site to diagnose PHP and database setup.`,
    );
  }

  let data: any;
  try {
    data = parseJsonBody(raw);
  } catch (e) {
    throw new Error(`Invalid JSON response from ${endpoint}. Check Hostinger PHP error logs.`);
  }

  if (!res.ok) {
    const errMsg = typeof data.error === 'string' ? data.error.trim() : '';
    const message = typeof data.message === 'string' ? data.message.trim() : '';
    const hint = typeof data.hint === 'string' ? data.hint.trim() : '';
    const det = typeof data.detail === 'string' ? data.detail.trim() : '';
    const emailErr = typeof data.email_error === 'string' ? data.email_error.trim() : '';
    let msg = [errMsg, message, det, hint, emailErr].filter(Boolean).join(' — ');
    // Avoid duplicating the same SMTP detail twice when error already includes email_error
    if (errMsg && emailErr && errMsg.includes(emailErr)) {
      msg = [errMsg, message, det, hint].filter(Boolean).join(' — ');
    }
    if (import.meta.env.DEV) {
      const file = typeof data.file === 'string' ? data.file.trim() : '';
      const line = data.line;
      if (file && line != null && line !== '') {
        msg += ` (${file}:${line})`;
      }
    }
    throw new Error(msg || 'Request failed');
  }

  return data;
}

/** PDF/images with Bearer auth (JSON `request()` expects application/json). */
async function requestBlob(endpoint: string): Promise<Blob> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, { headers });
  } catch {
    throw new Error('Network error - unable to reach server');
  }
  if (res.status === 401) {
    clearToken();
    try {
      const path = window.location.pathname || '';
      let target: string;
      if (path === '/auth' || path.endsWith('/auth')) {
        const q = typeof window !== 'undefined' ? window.location.search || '' : '';
        target = q ? `/auth${q}` : AUTH_PORTAL.salesRep;
      } else {
        const portal = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('auth_login_portal') || 'login' : 'login';
        target = loginPathFromSessionPortal(portal);
      }
      window.location.replace(target);
    } catch {
      window.location.replace(AUTH_PORTAL.salesRep);
    }
    throw new Error('Session expired');
  }
  if (!res.ok) {
    throw new Error(res.status === 404 ? 'PDF not found' : 'Could not load file');
  }
  return res.blob();
}

// Auth
export const api = {
  auth: {
    login: async (email: string, password: string) => {
      const data = await request('/auth.php?action=login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token);
      setStoredUser(data.user);
      if (data.organization) setStoredOrg(data.organization);
      return data;
    },
    loginWithGoogle: async (credential: string) => {
      const data = await request('/auth.php?action=google_login', {
        method: 'POST',
        body: JSON.stringify({ credential }),
      });
      setToken(data.token);
      setStoredUser(data.user);
      if (data.organization) setStoredOrg(data.organization);
      return data;
    },
    signup: async (email: string, password: string, full_name: string, role?: string, invite_code?: string) => {
      const data = await request('/auth.php?action=signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, full_name, role, invite_code }),
      });
      setToken(data.token);
      setStoredUser(data.user);
      return data;
    },
    me: async () => {
      const data = await request('/auth.php?action=me', { method: 'POST' });
      setStoredUser(data.user);
      setStoredOrg(data.organization ?? null);
      return data;
    },
    switchOrg: async (orgId: string | null) => {
      const data = await request('/auth.php?action=switch_org', {
        method: 'POST',
        body: JSON.stringify({ org_id: orgId }),
      });
      setToken(data.token);
      if (data.organization) setStoredOrg(data.organization);
      else setStoredOrg(null);
      return data;
    },
    forgotPassword: (email: string) =>
      request('/auth.php?action=forgot_password', { method: 'POST', body: JSON.stringify({ email }) }),
    verifyResetOtp: (email: string, otp: string) =>
      request('/auth.php?action=verify_reset_otp', { method: 'POST', body: JSON.stringify({ email, otp }) }),
    resetPassword: (token: string, password: string) =>
      request('/auth.php?action=reset_password', { method: 'POST', body: JSON.stringify({ token, password }) }),
    changePassword: (current_password: string, new_password: string) =>
      request('/auth.php?action=change_password', {
        method: 'POST',
        body: JSON.stringify({ current_password, new_password }),
      }),
    updateProfile: (data: {
      full_name: string;
      email: string;
      phone: string;
      avatar?: File | null;
      remove_avatar?: boolean;
    }) => {
      const body = new FormData();
      body.set('full_name', data.full_name);
      body.set('email', data.email);
      body.set('phone', data.phone);
      body.set('remove_avatar', data.remove_avatar ? '1' : '0');
      if (data.avatar) body.set('avatar', data.avatar);
      return request('/auth.php?action=update_profile', { method: 'POST', body });
    },
    logout: () => {
      clearToken();
    },
    getToken,
    getStoredUser,
    getStoredOrg,
    setStoredOrg,
  },

  hr: {
    login: async (email: string, password: string) => {
      const data = await request('/auth.php?action=login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const role = String(data?.user?.role || '').toLowerCase();
      if (role !== 'hr') {
        throw new Error('This account is not an HR account');
      }
      setToken(data.token);
      setStoredUser(data.user);
      localStorage.setItem('hr_token', data.token);
      localStorage.setItem('hr_user', JSON.stringify(data.user));
      return data;
    },
    logout: () => {
      localStorage.removeItem('hr_token');
      localStorage.removeItem('hr_user');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      localStorage.removeItem('auth_org');
    },
    getToken: () => getHrToken() || getToken(),
    getStoredUser: () => {
      const u = localStorage.getItem('hr_user');
      return u ? JSON.parse(u) : null;
    },
    create: (payload: any) => request('/hr.php?action=create_hr', { method: 'POST', body: JSON.stringify(payload) }),
    list: (orgId?: string) =>
      request(`/hr.php?action=list_hrs${orgId && orgId !== 'all' ? `&org_id=${encodeURIComponent(orgId)}` : ''}`),
    update: (payload: any) => request('/hr.php?action=update_hr', { method: 'PUT', body: JSON.stringify(payload) }),
    delete: (id: string) => request('/hr.php?action=delete_hr', { method: 'DELETE', body: JSON.stringify({ id }) }),
    dashboard: () => request('/hr.php?action=hr_dashboard'),
    addLead: (payload: any) => request('/hr.php?action=add_lead', { method: 'POST', body: JSON.stringify(payload) }),
    myLeads: (search = '', status = 'all') => request(`/hr.php?action=my_leads&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`),
    assignedLeads: (search = '', status = 'all') => request(`/hr.php?action=assigned_leads&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`),
    updateLeadStatus: (id: string, status: string) =>
      request('/hr.php?action=assigned_leads', { method: 'PUT', body: JSON.stringify({ id, status }) }),
    tasks: () => request('/hr.php?action=tasks'),
    updateTaskStatus: (id: string, status: string) => request('/hr.php?action=tasks', { method: 'PUT', body: JSON.stringify({ id, status }) }),
    reports: (range = 'month') => request(`/hr.php?action=reports&range=${encodeURIComponent(range)}`),
    notifications: () => request('/hr.php?action=notifications'),
    markNotificationRead: (id: string) =>
      request('/hr.php?action=mark_notification_read', { method: 'PUT', body: JSON.stringify({ id }) }),
    holidays: (year?: string) => request(`/hr.php?action=holidays${year ? `&year=${encodeURIComponent(year)}` : ''}`),
  },

  // Leads
  leads: {
    list: (params?: { status?: string; search?: string; referred_by?: string; form_leads?: boolean }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.search) q.set('search', params.search);
      if (params?.referred_by) q.set('referred_by', params.referred_by);
      if (params?.form_leads) q.set('form_leads', '1');
      const qs = q.toString();
      return request(`/leads.php${qs ? '?' + qs : ''}`);
    },
    create: (data: any) => request('/leads.php', { method: 'POST', body: JSON.stringify(data) }),
    bulkCreate: (leads: any[], opts?: { org_id?: string }) =>
      request('/leads.php?action=bulk', {
        method: 'POST',
        body: JSON.stringify({
          leads,
          ...(opts?.org_id ? { org_id: opts.org_id } : {}),
        }),
      }),
    update: (id: string, data: any) => request(`/leads.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/leads.php?id=${id}`, { method: 'DELETE' }),
    bulkDelete: (ids: string[]) =>
      request<{ message: string; deleted: number; skipped: number; handler?: string }>(
        '/leads.php?action=bulk_delete',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'bulk_delete', ids }),
        },
      ),
  },

  // Contacts
  contacts: {
    list: () => request('/contacts.php'),
    create: (data: any) => request('/contacts.php', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request(`/contacts.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/contacts.php?id=${id}`, { method: 'DELETE' }),
  },

  // Deals
  deals: {
    list: (params?: { status?: string }) => {
      const q = new URLSearchParams(params as any).toString();
      return request(`/deals.php${q ? '?' + q : ''}`);
    },
    stages: () => request('/deals.php?stages=1'),
    create: (data: any) => request('/deals.php', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request(`/deals.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/deals.php?id=${id}`, { method: 'DELETE' }),
  },

  // Tasks
  tasks: {
    list: () => request('/tasks.php'),
    create: (data: any) => request('/tasks.php', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request(`/tasks.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/tasks.php?id=${id}`, { method: 'DELETE' }),
  },

  // Activities
  activities: {
    list: () => request('/activities.php'),
    create: (data: any) => request('/activities.php', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request(`/activities.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/activities.php?id=${id}`, { method: 'DELETE' }),
  },

  // Students
  students: {
    list: (params?: { status?: string; search?: string }) => {
      const q = new URLSearchParams(params as any).toString();
      return request(`/students.php${q ? '?' + q : ''}`);
    },
    create: (data: any) => request('/students.php', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request(`/students.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/students.php?id=${id}`, { method: 'DELETE' }),
  },

  // Courses
  courses: {
    list: (orgId?: string) => {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      return request(`/courses.php${q}`);
    },
    create: (data: any) => request('/courses.php', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request(`/courses.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/courses.php?id=${id}`, { method: 'DELETE' }),
  },

  // Batches
  batches: {
    list: (orgId?: string) => {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      return request(`/batches.php${q}`);
    },
    create: (data: any) => request('/batches.php', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request(`/batches.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/batches.php?id=${id}`, { method: 'DELETE' }),
  },

  // Payments
  payments: {
    list: (params?: { date_from?: string; date_to?: string }) => {
      const q = new URLSearchParams();
      if (params?.date_from) q.set('date_from', params.date_from);
      if (params?.date_to) q.set('date_to', params.date_to);
      const suffix = q.toString() ? `?${q.toString()}` : '';
      return request(`/payments.php${suffix}`);
    },
    create: (data: any) => request('/payments.php', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request(`/payments.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/payments.php?id=${id}`, { method: 'DELETE' }),
  },

  // Profiles & Dashboard
  profiles: {
    list: () => request('/profiles.php'),
    dashboard: () => request('/profiles.php?action=dashboard'),
    update: (id: string, data: any) => request(`/profiles.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },

  // Settings
  settings: {
    users: () => request('/settings.php'),
    updateUser: (id: string, data: any) => request(`/settings.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    stages: () => request('/deals.php?stages=1'),
    emailSetup: () => request('/email-settings.php'),
    saveEmailSetup: (data: {
      accounts: Array<{ slot: number; label: string; email: string; from_name: string; app_password?: string }>;
      routes: Record<string, number>;
    }) => request('/email-settings.php?action=setup', { method: 'PUT', body: JSON.stringify(data) }),
    testEmailAccount: (slot: number) =>
      request('/email-settings.php?action=test', { method: 'POST', body: JSON.stringify({ slot }) }),
  },

  // Daily Reports
  dailyReports: {
    list: (params?: { user_id?: string; date?: string; from?: string; to?: string }) => {
      const q = new URLSearchParams(params as any).toString();
      return request(`/daily-reports.php${q ? '?' + q : ''}`);
    },
    submit: (data: any) => request('/daily-reports.php', { method: 'POST', body: JSON.stringify(data) }),
  },

  // Team Management
  team: {
    list: (orgId?: string, extra?: Record<string, string>) => {
      const q = new URLSearchParams();
      if (orgId) q.set('org_id', orgId);
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          if (v !== undefined && v !== '') q.set(k, v);
        }
      }
      const s = q.toString();
      return request(`/team.php${s ? `?${s}` : ''}`);
    },
    create: (data: any) => request('/team.php', { method: 'POST', body: JSON.stringify(data) }),
    sendWelcomeEmail: (data: { user_id: string; password: string }) =>
      request('/team.php?action=send_welcome_email', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request(`/team.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/team.php?id=${id}`, { method: 'DELETE' }),
  },

  // Notifications
  notifications: {
    list: () => request('/notifications.php'),
    create: (data: any) => request('/notifications.php', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request(`/notifications.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/notifications.php?id=${id}`, { method: 'DELETE' }),
    markAllRead: (ids: string[]) => request('/notifications.php?action=mark_all_read', { method: 'PUT', body: JSON.stringify({ ids }) }),
    bulkDelete: (ids: string[]) => request('/notifications.php?action=bulk_delete', { method: 'DELETE', body: JSON.stringify({ ids }) }),
  },

  // Organizations (Super Admin)
  organizations: {
    list: () => request('/organizations.php'),
    stats: () => request(`/organizations.php?action=stats&_t=${Date.now()}`),
    features: (orgId: string) => request(`/organizations.php?action=features&org_id=${orgId}`),
    create: (data: any) => request('/organizations.php', { method: 'POST', body: JSON.stringify(data) }),
    provisionAdmin: (data: { org_id: string; admin_name: string; admin_email: string; admin_phone: string; admin_password: string }) =>
      request('/organizations.php?action=provision_admin', { method: 'POST', body: JSON.stringify(data) }),
    syncPlatformSales: () =>
      request('/organizations.php?action=sync_platform_sales', { method: 'POST', body: JSON.stringify({}) }),
    update: (id: string, data: any) => request(`/organizations.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    updateFeatures: (id: string, features: Record<string, boolean>) => request(`/organizations.php?id=${id}&action=features`, { method: 'PUT', body: JSON.stringify({ features }) }),
    delete: (id: string) => request(`/organizations.php?id=${id}`, { method: 'DELETE' }),
    myOrg: () => request('/organizations.php?action=my_org'),
    updateProfile: (data: Record<string, unknown>) =>
      request('/organizations.php?action=profile', { method: 'PUT', body: JSON.stringify(data) }),
  },

  // Audit Logs (Settings page)
  auditLogs: {
    list: (params: { user_id?: string; action_type?: string; date?: string; search?: string; limit?: number } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '' && value !== null) qs.set(key, String(value));
      });
      const suffix = qs.toString();
      return request<{ data: AuditLogEntry[]; total: number }>(`/audit_logs.php${suffix ? `?${suffix}` : ''}`);
    },
    users: () => request<{ data: { user_id: string; user_name: string }[] }>('/audit_logs.php?action=users'),
  },

  // Offer Letters
  offerLetters: {
    templates: () => request('/offer-letters.php?action=templates'),
    template: (id: string) => request(`/offer-letters.php?action=template&id=${id}`),
    sent: () => request('/offer-letters.php?action=sent'),
    createTemplate: (data: any) => request('/offer-letters.php?action=create_template', { method: 'POST', body: JSON.stringify(data) }),
    updateTemplate: (id: string, data: any) => request(`/offer-letters.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteTemplate: (id: string) => request(`/offer-letters.php?id=${id}`, { method: 'DELETE' }),
    send: (data: any) => request('/offer-letters.php?action=send', { method: 'POST', body: JSON.stringify(data) }),
    deleteSent: (id: string) => request(`/offer-letters.php?id=${id}&action=sent`, { method: 'DELETE' }),
    /** Stored server PDF for a sent letter (PHP backend + Dompdf). */
    fetchSentPdfBlob: (id: string) =>
      requestBlob(`/offer-letters.php?action=pdf&id=${encodeURIComponent(id)}`),
  },

  // Holidays
  holidays: {
    list: (year?: string) => request(`/holidays.php${year ? '?year=' + year : ''}`),
    create: (data: any) => request('/holidays.php', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request(`/holidays.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/holidays.php?id=${id}`, { method: 'DELETE' }),
  },

  // Marketing
  marketing: {
    members: () => request('/marketing.php?action=members'),
    createMember: (data: any) => request('/marketing.php?action=members', { method: 'POST', body: JSON.stringify(data) }),
    updateMember: (id: string, data: any) => request(`/marketing.php?action=members&id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteMember: (id: string) => request(`/marketing.php?action=members&id=${id}`, { method: 'DELETE' }),
    emailDrafts: (params?: { mine?: boolean }) =>
      request(`/marketing.php?action=email_drafts${params?.mine ? '&mine=1' : ''}`),
    createEmailDraft: (data: any) => request('/marketing.php?action=email_drafts', { method: 'POST', body: JSON.stringify(data) }),
    updateEmailDraft: (id: string, data: any) => request(`/marketing.php?action=email_drafts&id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteEmailDraft: (id: string) => request(`/marketing.php?action=email_drafts&id=${id}`, { method: 'DELETE' }),
    emailCampaigns: (params?: { mine?: boolean }) =>
      request(`/marketing.php?action=email_campaigns${params?.mine ? '&mine=1' : ''}`),
    createEmailCampaign: (data: any) => request('/marketing.php?action=email_campaigns', { method: 'POST', body: JSON.stringify(data) }),
    updateEmailCampaign: (id: string, data: any) => request(`/marketing.php?action=email_campaigns&id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    emailSends: (campaignIds: string[]) => {
      if (!campaignIds.length) return Promise.resolve({ data: [] });
      return request(`/marketing.php?action=email_sends&campaign_ids=${encodeURIComponent(campaignIds.join(','))}`);
    },
    createEmailSends: (campaignId: string, recipients: Array<string | { recipient_email?: string; email?: string; status?: string }>) =>
      request('/marketing.php?action=email_sends', { method: 'POST', body: JSON.stringify({ campaign_id: campaignId, recipients }) }),
    whatsappDrafts: (params?: { mine?: boolean }) =>
      request(`/marketing.php?action=whatsapp_drafts${params?.mine ? '&mine=1' : ''}`),
    createWhatsappDraft: (data: any) => request('/marketing.php?action=whatsapp_drafts', { method: 'POST', body: JSON.stringify(data) }),
    updateWhatsappDraft: (id: string, data: any) => request(`/marketing.php?action=whatsapp_drafts&id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteWhatsappDraft: (id: string) => request(`/marketing.php?action=whatsapp_drafts&id=${id}`, { method: 'DELETE' }),
    whatsappCampaigns: (params?: { mine?: boolean }) =>
      request(`/marketing.php?action=whatsapp_campaigns${params?.mine ? '&mine=1' : ''}`),
    createWhatsappCampaign: (data: any) => request('/marketing.php?action=whatsapp_campaigns', { method: 'POST', body: JSON.stringify(data) }),
    updateWhatsappCampaign: (id: string, data: any) => request(`/marketing.php?action=whatsapp_campaigns&id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    whatsappSends: (campaignIds: string[]) => {
      if (!campaignIds.length) return Promise.resolve({ data: [] });
      return request(`/marketing.php?action=whatsapp_sends&campaign_ids=${encodeURIComponent(campaignIds.join(','))}`);
    },
    createWhatsappSends: (campaignId: string, recipients: Array<string | { recipient_phone?: string; phone?: string; status?: string }>) =>
      request('/marketing.php?action=whatsapp_sends', { method: 'POST', body: JSON.stringify({ campaign_id: campaignId, recipients }) }),
    triggerN8nWebhook: (channel: 'email' | 'whatsapp', payload: Record<string, unknown>) =>
      request('/marketing.php?action=n8n_webhook', {
        method: 'POST',
        body: JSON.stringify({ channel, payload }),
      }),
    uploadLeadResume: async (file: File) => {
      const fd = new FormData();
      fd.append('resume', file);
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/marketing.php?action=upload_resume`, { method: 'POST', headers, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Resume upload failed');
      return data.resume_path as string;
    },
  },

  // Lead Assignments
  leadAssignments: {
    list: (leadId?: string) => request(`/lead-assignments.php${leadId ? '?lead_id=' + leadId : ''}`),
    myLeads: (params?: { status?: string; search?: string }) => {
      const q = new URLSearchParams({ action: 'my_leads' });
      if (params?.status) q.set('status', params.status);
      if (params?.search) q.set('search', params.search);
      return request(`/lead-assignments.php?${q.toString()}`);
    },
    myFormLeads: (params?: { status?: string; search?: string }) => {
      const q = new URLSearchParams({ action: 'my_form_leads' });
      if (params?.status) q.set('status', params.status);
      if (params?.search) q.set('search', params.search);
      return request(`/lead-assignments.php?${q.toString()}`);
    },
    assign: (data: any) => request('/lead-assignments.php', { method: 'POST', body: JSON.stringify(data) }),
    bulkAssign: (leadIds: string[], userId: string) => request('/lead-assignments.php?action=bulk', { method: 'POST', body: JSON.stringify({ lead_ids: leadIds, user_id: userId }) }),
    delete: (id: string) => request(`/lead-assignments.php?id=${id}`, { method: 'DELETE' }),
  },

  // Form Management
  forms: {
    list: () => request('/forms.php'),
    create: (data: {
      name: string;
      slug?: string;
      description?: string | null;
      is_active?: boolean;
      fields_json?: unknown;
      meta_json?: Record<string, unknown>;
      org_id?: string | null;
    }) => request('/forms.php', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: {
      name?: string;
      slug?: string;
      description?: string | null;
      is_active?: boolean;
      fields_json?: unknown;
      meta_json?: Record<string, unknown>;
      org_id?: string | null;
    }) => request(`/forms.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/forms.php?id=${id}`, { method: 'DELETE' }),
    assignments: (formId: string) => request(`/forms.php?action=assignments&form_id=${formId}`),
    assignMembers: (formId: string, memberIds: string[]) =>
      request('/forms.php?action=assign', { method: 'POST', body: JSON.stringify({ form_id: formId, member_ids: memberIds }) }),
    backfillSalesFormAssignments: () =>
      request('/forms.php?action=backfill_sales_form_assignments', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    externalApiInfo: (formId: string) =>
      request(`/forms.php?action=external_api&form_id=${encodeURIComponent(formId)}`),
    generateApiKey: (formId: string) =>
      request('/forms.php?action=generate_api_key', {
        method: 'POST',
        body: JSON.stringify({ form_id: formId }),
      }),
    revokeApiKey: (formId: string) =>
      request(`/forms.php?action=revoke_api_key&form_id=${encodeURIComponent(formId)}`, {
        method: 'DELETE',
      }),
    submissions: (
      formId: string,
      params?: { page?: number; limit?: number; search?: string; status?: string },
    ) => {
      const q = new URLSearchParams({ action: 'submissions', form_id: formId });
      if (params?.page) q.set('page', String(params.page));
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.search) q.set('search', params.search);
      if (params?.status) q.set('status', params.status);
      return request(`/forms.php?${q.toString()}`);
    },
    campaignTemplates: (formId: string) =>
      request<{ data: { email: unknown[]; whatsapp: unknown[] } }>(
        `/forms.php?action=campaign_templates&form_id=${encodeURIComponent(formId)}`,
      ),
    sendCampaign: (body: {
      form_id: string;
      channel: 'email' | 'whatsapp';
      template_source: 'marketing' | 'communications';
      template_id: string;
    }) =>
      request('/forms.php?action=send_campaign', { method: 'POST', body: JSON.stringify(body) }),
    saveCampaignSettings: (body: {
      form_id: string;
      campaign: Record<string, unknown>;
      send_to_existing?: boolean;
    }) =>
      request('/forms.php?action=campaign_settings', { method: 'POST', body: JSON.stringify(body) }),
  },

  trash: {
    list: () => request('/trash.php'),
    restore: (trashRowId: string) =>
      request('/trash.php', { method: 'POST', body: JSON.stringify({ action: 'restore', id: trashRowId }) }),
    clearAll: () =>
      request<{ message: string; deleted: number }>('/trash_clear.php', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
  },

  payslip: {
    employees: {
      list: (orgId?: string) => {
        const q = orgId ? `&org_id=${encodeURIComponent(orgId)}` : '';
        return request(`/payslip_employees.php?action=list${q}`);
      },
      create: (data: Record<string, unknown>) =>
        request('/payslip_employees.php?action=create', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: Record<string, unknown>) =>
        request(`/payslip_employees.php?action=update&id=${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      delete: (id: string) =>
        request(`/payslip_employees.php?action=delete&id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },
    slips: {
      list: (filters?: { employeeId?: string; month?: string; status?: string; orgId?: string }) => {
        const parts: string[] = ['action=list'];
        if (filters?.employeeId) parts.push(`employee_id=${encodeURIComponent(filters.employeeId)}`);
        if (filters?.month) parts.push(`month=${encodeURIComponent(filters.month)}`);
        if (filters?.status) parts.push(`status=${encodeURIComponent(filters.status)}`);
        if (filters?.orgId) parts.push(`org_id=${encodeURIComponent(filters.orgId)}`);
        return request(`/payslips.php?${parts.join('&')}`);
      },
      create: (data: Record<string, unknown>) =>
        request('/payslips.php?action=create', { method: 'POST', body: JSON.stringify(data) }),
      updateStatus: (id: string, status: 'draft' | 'generated' | 'sent') =>
        request(`/payslips.php?action=update_status&id=${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify({ status }),
        }),
      sendEmail: (data: {
        id: string;
        to?: string;
        cc?: string;
        bcc?: string;
        pdfBase64: string;
        subject?: string;
        body?: string;
        fileName?: string;
      }) =>
        request('/payslips.php?action=send_email', { method: 'POST', body: JSON.stringify(data) }),
      savePdf: (data: { id: string; pdfBase64: string }) =>
        request('/payslips.php?action=save_pdf', { method: 'POST', body: JSON.stringify(data) }),
      pdf: (id: string) => requestBlob(`/payslips.php?action=pdf&id=${encodeURIComponent(id)}`),
      delete: (id: string) =>
        request(`/payslips.php?action=delete&id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    },
  },

  certificates: {
    listTemplates: () => request('/certificate-templates.php'),
    saveTemplate: (template: any) =>
      request('/certificate-templates.php', { method: 'POST', body: JSON.stringify({ template }) }),
    uploadTemplateAsset: async (file: File, kind = 'background') => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/certificate-templates.php?action=upload_asset`, {
        method: 'POST',
        headers,
        body: fd,
      });
      const raw = await res.text();
      let data: Record<string, unknown> = {};
      if (raw.trim()) {
        try {
          data = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          throw new Error(
            'Server returned an invalid response. The file may exceed PHP upload_max_filesize / post_max_size on your host (often 8 MB by default).',
          );
        }
      } else {
        throw new Error(
          'Server returned an empty response. The file likely exceeds the server upload limit — use multipart upload and ensure PHP upload_max_filesize is at least 50M.',
        );
      }
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Image upload failed');
      }
      const url = data.url;
      if (typeof url !== 'string' || !url) {
        throw new Error('Upload succeeded but no image URL was returned');
      }
      return url;
    },
    deleteTemplate: (id: string) => request(`/certificate-templates.php?id=${id}`, { method: 'DELETE' }),
    listIssued: () => request('/issued-certificates.php'),
    verifyPublic: (id: string, token: string) =>
      request(`/public-certificate-verify.php?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`),
    createIssuedBulk: (certificates: any[]) =>
      request('/issued-certificates.php', { method: 'POST', body: JSON.stringify({ certificates }) }),
    updateIssuedStatus: (id: string, status: 'issued' | 'revoked' | 'expired') =>
      request(`/issued-certificates.php?id=${id}`, { method: 'PUT', body: JSON.stringify({ status }) }),
    issue: (data: {
      recipientId: string;
      templateId: string;
      syncId: string;
      recipientName?: string;
      recipientEmail?: string;
      courseName?: string;
      issueDate?: string;
      verifyToken?: string;
    }) => request('/certificates.php?action=issue', { method: 'POST', body: JSON.stringify(data) }),
    sendEmail: (data: {
      certificateId: string;
      to: string;
      cc?: string;
      bcc?: string;
      subject: string;
      body: string;
      attachmentUrl: string;
      attachmentName?: string;
    }) => request('/certificates.php?action=send_email', { method: 'POST', body: JSON.stringify(data) }),
    emailLogs: (certificateId?: string) =>
      request(`/certificates.php?action=email_logs${certificateId ? `&certificate_id=${encodeURIComponent(certificateId)}` : ''}`),
  },

  fresherSalary: {
    list: async (): Promise<FresherMember[]> => {
      const data = await request('/fresher-salary-tracker.php');
      const rows = data?.data;
      return Array.isArray(rows) ? rows : [];
    },
    create: (member: FresherMember) =>
      request('/fresher-salary-tracker.php', { method: 'POST', body: JSON.stringify({ member }) }),
    update: (member: FresherMember) =>
      request(`/fresher-salary-tracker.php?id=${encodeURIComponent(member.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ member }),
      }),
    remove: (id: string) => request(`/fresher-salary-tracker.php?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    registerTraineeJoin: (body: { trainee_user_id: string; joining_date: string }) =>
      request('/fresher-salary-tracker.php?action=register_trainee_join', { method: 'POST', body: JSON.stringify(body) }),
  },
};
