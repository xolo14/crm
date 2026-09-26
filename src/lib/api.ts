// API Configuration - uses relative /api path for production deployment
// Auth: HttpOnly cookie `syncpedia_session` (set by PHP on login). JWT is no longer
// persisted in localStorage. credentials:'include' sends the cookie on same-origin API calls.
import type { FresherMember } from '@/modules/fresherSalary/types';
import { normalizeFresherPolicy, type FresherOrgPolicy } from '@/modules/fresherSalary/policy';
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
  // JWT is HttpOnly-only now. Never return a localStorage JWT (and scrub leftovers).
  try {
    if (localStorage.getItem('auth_token') || localStorage.getItem('hr_token')) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('hr_token');
    }
  } catch {
    /* ignore */
  }
  return null;
}

function hasAuthSession(): boolean {
  try {
    return localStorage.getItem('auth_session') === '1' || !!localStorage.getItem('auth_user');
  } catch {
    return false;
  }
}

function setToken(_token: string) {
  // Intentionally do not store JWT in localStorage (XSS harvest vector).
  try {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('hr_token');
  } catch {
    /* ignore */
  }
  localStorage.setItem('auth_session', '1');
}

function clearToken() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
  localStorage.removeItem('auth_org');
  localStorage.removeItem('hr_token');
  localStorage.removeItem('hr_user');
  localStorage.removeItem('auth_session');
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
      credentials: 'include',
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

/** PDF/images with cookie session (JSON `request()` expects application/json). */
async function requestBlob(endpoint: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, { credentials: 'include' });
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
  const buf = await res.arrayBuffer();
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const looksPdf = ct.includes('pdf') || ct.includes('octet-stream');
  const looksVideo = ct.includes('video/');
  if (!res.ok || (!looksPdf && !looksVideo)) {
    let msg = res.status === 404 ? 'File not found' : 'Could not load file';
    try {
      const data = JSON.parse(new TextDecoder().decode(buf)) as { error?: unknown };
      if (typeof data.error === 'string' && data.error.trim()) {
        msg = data.error;
      }
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  const type = looksVideo ? (ct.split(';')[0] || 'video/webm') : 'application/pdf';
  return new Blob([buf], { type });
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
    requestSuperAdminEmailLogin: (email: string) =>
      request('/auth.php?action=request_super_admin_email_login', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    listSuperAdminLoginEmails: () =>
      request('/auth.php?action=list_super_admin_login_emails', { method: 'POST', body: '{}' }),
    saveSuperAdminLoginEmails: (emails: string[]) =>
      request('/auth.php?action=save_super_admin_login_emails', {
        method: 'POST',
        body: JSON.stringify({ emails }),
      }),
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
    logout: async () => {
      try {
        await request('/auth.php?action=logout', { method: 'POST', body: '{}' });
      } catch {
        /* still clear local state */
      }
      clearToken();
    },
    getToken,
    hasSession: hasAuthSession,
    getStoredUser,
    getStoredOrg,
    setStoredOrg,
  },

  hr: {
    logout: async () => {
      try {
        await request('/auth.php?action=logout', { method: 'POST', body: '{}' });
      } catch {
        /* ignore */
      }
      localStorage.removeItem('hr_token');
      localStorage.removeItem('hr_user');
      clearToken();
    },
    getStoredUser: () => {
      const u = localStorage.getItem('hr_user');
      return u ? JSON.parse(u) : null;
    },
    list: (orgId?: string) =>
      request(`/hr.php?action=list_hrs${orgId && orgId !== 'all' ? `&org_id=${encodeURIComponent(orgId)}` : ''}`),
    update: (payload: any) => request('/hr.php?action=update_hr', { method: 'PUT', body: JSON.stringify(payload) }),
    dashboard: () => request('/hr.php?action=hr_dashboard'),
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
    list: async (params?: {
      status?: string;
      search?: string;
      referred_by?: string;
      form_leads?: boolean;
      /** Fetch a single lead by id (picker merge / edit dialogs). */
      id?: string;
      /** Skip payment-link enrichment and creator-name joins. */
      lite?: boolean;
      /** Super-admin: filter leads to one organisation */
      org_id?: string;
      /** Mobile/web: leads whose status you changed in a period */
      status_changed?: 'yesterday' | 'last_7_days' | 'last_week' | 'this_month';
      limit?: number;
      offset?: number;
      /** When true (default), follow truncated pages until all visible leads are loaded. */
      all?: boolean;
    }) => {
      const buildQs = (limit: number, offset: number) => {
        const q = new URLSearchParams();
        if (params?.status) q.set('status', params.status);
        if (params?.search) q.set('search', params.search);
        if (params?.referred_by) q.set('referred_by', params.referred_by);
        if (params?.form_leads === true) q.set('form_leads', '1');
        else if (params?.form_leads === false) q.set('form_leads', '0');
        if (params?.id) q.set('id', params.id);
        if (params?.lite) q.set('lite', '1');
        if (params?.org_id) q.set('org_id', params.org_id);
        if (params?.status_changed) q.set('status_changed', params.status_changed);
        q.set('limit', String(limit));
        if (offset > 0) q.set('offset', String(offset));
        return q.toString();
      };

      const pageSize = Math.min(100000, Math.max(1, params?.limit ?? 100000));
      const fetchAll = params?.all !== false && params?.offset == null;

      if (!fetchAll) {
        const offset = Math.max(0, params?.offset ?? 0);
        return request(`/leads.php?${buildQs(pageSize, offset)}`);
      }

      const allRows: any[] = [];
      let offset = 0;
      let total = 0;
      // Safety: at most 100k leads client-side (1×100k or chunked pages).
      const maxPages = Math.max(1, Math.ceil(100000 / pageSize));
      for (let page = 0; page < maxPages; page++) {
        const data = await request(`/leads.php?${buildQs(pageSize, offset)}`);
        const rows = Array.isArray(data?.data) ? data.data : [];
        total = typeof data?.total === 'number' ? data.total : allRows.length + rows.length;
        allRows.push(...rows);
        offset += rows.length;
        if (!data?.truncated || rows.length === 0 || offset >= total || allRows.length >= 100000) {
          return {
            ...data,
            data: allRows.slice(0, 100000),
            count: Math.min(allRows.length, 100000),
            total,
            truncated: false,
            offset: 0,
            limit: Math.min(allRows.length, 100000),
          };
        }
      }
      return {
        data: allRows.slice(0, 100000),
        count: Math.min(allRows.length, 100000),
        total,
        truncated: offset < total,
        offset: 0,
        limit: Math.min(allRows.length, 100000),
      };
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

  // Lead Management — source-card folders
  leadFolders: {
    list: (orgId?: string) => {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      return request(`/lead-folders.php${q}`, {
        headers: orgId ? { 'X-Org-Id': orgId } : {},
      });
    },
    create: (name: string, orgId?: string) => {
      const q = new URLSearchParams({ action: 'create' });
      if (orgId) q.set('org_id', orgId);
      return request(`/lead-folders.php?${q}`, {
        method: 'POST',
        body: JSON.stringify({ name }),
        headers: orgId ? { 'X-Org-Id': orgId } : {},
      });
    },
    move: (source_key: string, folder_id: string | null, orgId?: string) => {
      const q = new URLSearchParams({ action: 'move' });
      if (orgId) q.set('org_id', orgId);
      return request(`/lead-folders.php?${q}`, {
        method: 'POST',
        body: JSON.stringify({ source_key, folder_id }),
        headers: orgId ? { 'X-Org-Id': orgId } : {},
      });
    },
  },

  /** Form / assessment source-card → manager visibility grants */
  leadSourceCardManagers: {
    list: (orgId?: string) => {
      const q = new URLSearchParams({ action: 'list' });
      if (orgId) q.set('org_id', orgId);
      return request(`/lead-source-card-managers.php?${q}`);
    },
    managers: (orgId?: string) => {
      const q = new URLSearchParams({ action: 'managers' });
      if (orgId) q.set('org_id', orgId);
      return request(`/lead-source-card-managers.php?${q}`);
    },
    set: (source_key: string, manager_user_ids: string[], orgId?: string) => {
      const q = new URLSearchParams({ action: 'set' });
      if (orgId) q.set('org_id', orgId);
      return request(`/lead-source-card-managers.php?${q}`, {
        method: 'POST',
        body: JSON.stringify({ source_key, manager_user_ids }),
      });
    },
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
    list: (params?: { lead_id?: string }) => {
      const q = new URLSearchParams();
      if (params?.lead_id) q.set('lead_id', params.lead_id);
      const qs = q.toString();
      return request(`/activities.php${qs ? `?${qs}` : ''}`);
    },
    create: (data: any) => request('/activities.php', { method: 'POST', body: JSON.stringify(data) }),
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
 bulkCreate: (courses: any[], opts?: { org_id?: string }) =>
 request('/courses.php?action=bulk', {
 method: 'POST',
 body: JSON.stringify({ courses, ...(opts?.org_id ? { org_id: opts.org_id } : {}) }),
 }),
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
 bulkCreate: (batches: any[], opts?: { org_id?: string }) =>
 request('/batches.php?action=bulk', {
 method: 'POST',
 body: JSON.stringify({ batches, ...(opts?.org_id ? { org_id: opts.org_id } : {}) }),
 }),
  },

  // Manual payment submissions (Payment Records → Payments / Approvals)
  manualPayments: {
    list: (status: 'approved' | 'pending' | 'rejected' | 'all' = 'approved') =>
      request(`/manual-payments.php?action=list&status=${encodeURIComponent(status)}`),
    approvals: () => request('/manual-payments.php?action=approvals'),
    create: async (fields: {
      amount: number | string;
      payment_method: string;
      customer_name: string;
      customer_email: string;
      customer_phone: string;
      paid_at: string;
      proof: File;
      pitch_price?: number | string;
      candidate_id?: string;
      lead_id?: string;
    }) => {
      const fd = new FormData();
      fd.append('amount', String(fields.amount));
      fd.append('payment_method', fields.payment_method);
      fd.append('customer_name', fields.customer_name);
      fd.append('customer_email', fields.customer_email);
      fd.append('customer_phone', fields.customer_phone);
      fd.append('paid_at', fields.paid_at);
      fd.append('proof', fields.proof);
      if (fields.pitch_price != null && fields.pitch_price !== '') {
        fd.append('pitch_price', String(fields.pitch_price));
      }
      if (fields.candidate_id) fd.append('candidate_id', fields.candidate_id);
      if (fields.lead_id) fd.append('lead_id', fields.lead_id);
      return request('/manual-payments.php?action=create', { method: 'POST', body: fd });
    },
    approve: (id: string, review_notes?: string) =>
      request(`/manual-payments.php?action=approve&id=${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify({ review_notes: review_notes || '' }),
      }),
    reject: (id: string, review_notes?: string) =>
      request(`/manual-payments.php?action=reject&id=${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify({ review_notes: review_notes || '' }),
      }),
    delete: (id: string) =>
      request(`/manual-payments.php?action=delete&id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
  },

  paymentCandidates: {
    list: (params?: { owner_user_id?: string; search?: string; from?: number; to?: number }) => {
      const q = new URLSearchParams({ action: 'list' });
      if (params?.owner_user_id) q.set('owner_user_id', params.owner_user_id);
      if (params?.search) q.set('search', params.search);
      if (params?.from !== undefined) q.set('from', String(params.from));
      if (params?.to !== undefined) q.set('to', String(params.to));
      return request(`/payment-candidates.php?${q.toString()}`);
    },
    detail: (id: string) =>
      request(`/payment-candidates.php?action=detail&id=${encodeURIComponent(id)}`),
    lookup: (params: { email?: string; phone?: string; owner_user_id?: string }) => {
      const q = new URLSearchParams({ action: 'lookup' });
      if (params.email) q.set('email', params.email);
      if (params.phone) q.set('phone', params.phone);
      if (params.owner_user_id) q.set('owner_user_id', params.owner_user_id);
      return request(`/payment-candidates.php?${q.toString()}`);
    },
    updatePitch: (id: string, pitchPrice: number) =>
      request(`/payment-candidates.php?action=update_pitch&id=${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ pitch_price: pitchPrice }),
      }),
  },

  // Profiles & Dashboard
  profiles: {
    list: () => request('/profiles.php'),
    dashboard: () => request('/profiles.php?action=dashboard'),
    update: (id: string, data: any) => request(`/profiles.php?id=${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },

  // Settings
  settings: {
    emailSetup: () => request('/email-settings.php'),
    saveEmailSetup: (data: {
      accounts: Array<{ slot: number; label: string; email: string; from_name: string; app_password?: string }>;
      routes: Record<string, number>;
    }) => request('/email-settings.php?action=setup', { method: 'PUT', body: JSON.stringify(data) }),
    testEmailAccount: (slot: number) =>
      request('/email-settings.php?action=test', { method: 'POST', body: JSON.stringify({ slot }) }),
    razorpaySetup: () => request('/razorpay-settings.php'),
    saveRazorpaySetup: (data: {
      key_id: string;
      key_secret?: string;
      webhook_secret?: string;
      mode?: string;
    }) => request('/razorpay-settings.php?action=setup', { method: 'PUT', body: JSON.stringify(data) }),
    clearRazorpaySetup: () =>
      request('/razorpay-settings.php?action=clear', { method: 'POST', body: '{}' }),
  },

  // Meta Ads (org admin — OAuth + campaign insights)
  metaAds: {
    status: () => request('/meta-ads.php?action=status'),
    oauthStart: () => request('/meta-ads.php?action=oauth_start'),
    updateAccounts: (accounts: Array<{ ad_account_id: string; is_enabled: boolean }>) =>
      request('/meta-ads.php?action=accounts', { method: 'PUT', body: JSON.stringify({ accounts }) }),
    syncNow: () => request('/meta-ads.php?action=sync_now', { method: 'POST', body: '{}' }),
    disconnect: () => request('/meta-ads.php?action=disconnect', { method: 'POST', body: '{}' }),
    insights: (params: { from?: string; to?: string; ad_account_id?: string } = {}) => {
      const qs = new URLSearchParams({ action: 'insights' });
      if (params.from) qs.set('from', params.from);
      if (params.to) qs.set('to', params.to);
      if (params.ad_account_id) qs.set('ad_account_id', params.ad_account_id);
      return request(`/meta-ads.php?${qs.toString()}`);
    },
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
    orgBulk: (data: { kind: string; count: number; detail?: string }) =>
      request('/notifications.php?action=org_bulk', { method: 'POST', body: JSON.stringify(data) }),
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
    myOrg: (orgId?: string) => {
      const qs = new URLSearchParams({ action: 'my_org' });
      if (orgId) qs.set('org_id', orgId);
      return request(`/organizations.php?${qs.toString()}`);
    },
    updateProfile: (data: Record<string, unknown>, orgId?: string) => {
      const qs = new URLSearchParams({ action: 'profile' });
      if (orgId) qs.set('org_id', orgId);
      return request(`/organizations.php?${qs.toString()}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    uploadLogo: async (file: File, orgId?: string) => {
      const qs = new URLSearchParams({ action: 'upload_logo' });
      if (orgId) qs.set('org_id', orgId);
      const fd = new FormData();
      fd.append('file', file);
      const headers: Record<string, string> = {};
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/organizations.php?${qs.toString()}`, {
        method: 'POST',
        headers,
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error || 'Logo upload failed');
      return data as { logo_url: string; success?: boolean };
    },
    uploadPaymentQr: async (file: File, orgId?: string) => {
      const qs = new URLSearchParams({ action: 'upload_payment_qr' });
      if (orgId) qs.set('org_id', orgId);
      const fd = new FormData();
      fd.append('file', file);
      const headers: Record<string, string> = {};
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/organizations.php?${qs.toString()}`, {
        method: 'POST',
        headers,
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error || 'QR upload failed');
      return data as { payment_qr_url: string; success?: boolean };
    },
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

  // Timetables
  timetables: {
    list: () => request('/timetables.php'),
    get: (id: string) => request(`/timetables.php?action=get&id=${encodeURIComponent(id)}`),
    preview: (id: string) => request(`/timetables.php?action=preview&id=${encodeURIComponent(id)}`),
    batchStudents: (batchId: string) =>
      request(`/timetables.php?action=students&batch_id=${encodeURIComponent(batchId)}`),
    create: (data: Record<string, unknown>) =>
      request('/timetables.php', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request(`/timetables.php?id=${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/timetables.php?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    send: (id: string, data: Record<string, unknown>) =>
      request(`/timetables.php?action=send&id=${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(data) }),
  },

  coupons: {
    list: () => request('/coupons.php'),
    create: (
      data: {
        name: string;
        email: string;
        phone: string;
        discount: number;
        min_amount: number;
        code?: string;
        lead_id?: string;
        expires_at: string;
        send_email?: boolean;
        smtp_account_id?: string;
      },
      orgId?: string,
    ) => {
      const q = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      return request(`/coupons.php${q}`, { method: 'POST', body: JSON.stringify(data) });
    },
    delete: (id: string) => request(`/coupons.php?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    listMailboxes: (orgId?: string) => {
      const q = new URLSearchParams({ action: 'mailboxes' });
      if (orgId) q.set('org_id', orgId);
      return request(`/coupons.php?${q.toString()}`);
    },
    getApiKey: (orgId?: string) => {
      const q = new URLSearchParams({ action: 'api_key' });
      if (orgId) q.set('org_id', orgId);
      return request(`/coupons.php?${q.toString()}`);
    },
    generateApiKey: (orgId?: string) => {
      const q = new URLSearchParams({ action: 'api_key' });
      if (orgId) q.set('org_id', orgId);
      return request(`/coupons.php?${q.toString()}`, { method: 'POST' });
    },
    getMinAmount: (orgId?: string) => {
      const q = new URLSearchParams({ action: 'min_amount' });
      if (orgId) q.set('org_id', orgId);
      return request(`/coupons.php?${q.toString()}`);
    },
    setMinAmount: (minAmount: number, orgId?: string) => {
      const q = new URLSearchParams({ action: 'min_amount' });
      if (orgId) q.set('org_id', orgId);
      return request(`/coupons.php?${q.toString()}`, {
        method: 'POST',
        body: JSON.stringify({ min_amount: minAmount }),
      });
    },
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
    dispatchEmailCampaign: (data: {
      draft_id: string;
      smtp_account_id?: string;
      scheduled_at?: string | null;
      recipients: Array<
        | string
        | {
            email?: string;
            recipient_email?: string;
            values?: Record<string, string>;
            scheduled_at?: string | null;
          }
      >;
    }) => request('/marketing.php?action=dispatch_email_campaign', { method: 'POST', body: JSON.stringify(data) }),
    orgMailboxes: () => request('/marketing.php?action=org_mailboxes'),
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
    dispatchWhatsappCampaign: (data: {
      source: 'communications' | 'marketing';
      template_id?: string;
      draft_id?: string;
      /** Body params for Meta templates ({{1}}, {{2}}, …). Empty {{1}} may use each recipient's name. */
      variables?: string[];
      recipients: Array<string | { phone?: string; recipient_phone?: string; name?: string }>;
    }) => request('/marketing.php?action=dispatch_whatsapp_campaign', { method: 'POST', body: JSON.stringify(data) }),
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
    /** Atomically replace assignees for one lead (multi-member). */
    setAssignees: (leadId: string, userIds: string[]) =>
      request('/lead-assignments.php?action=set', {
        method: 'POST',
        body: JSON.stringify({ lead_id: leadId, user_ids: userIds }),
      }),
    /** Assign many leads to one user, or the same multi-member set via userIds. */
    bulkAssign: (leadIds: string[], userIdOrIds: string | string[]) =>
      request('/lead-assignments.php?action=bulk', {
        method: 'POST',
        body: JSON.stringify(
          Array.isArray(userIdOrIds)
            ? { lead_ids: leadIds, user_ids: userIdOrIds }
            : { lead_ids: leadIds, user_id: userIdOrIds },
        ),
      }),
  },

  // Document forms (Certificates & Offer Letters forms — separate from lead_forms)
  docForms: {
    list: (formTypeOrOpts?: 'offer_letter' | 'certificate' | { formType?: 'offer_letter' | 'certificate'; scope?: 'assigned' }) => {
      const opts =
        typeof formTypeOrOpts === 'string'
          ? { formType: formTypeOrOpts }
          : formTypeOrOpts || {};
      const q = new URLSearchParams({ action: 'list' });
      if (opts.formType) q.set('form_type', opts.formType);
      if (opts.scope) q.set('scope', opts.scope);
      return request(`/doc-forms.php?${q.toString()}`);
    },
    get: (id: string) => request(`/doc-forms.php?action=get&id=${encodeURIComponent(id)}`),
    create: (data: Record<string, unknown>) =>
      request('/doc-forms.php?action=create', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request(`/doc-forms.php?id=${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request(`/doc-forms.php?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    assign: (data: { form_id: string; user_ids?: string[]; role_keys?: string[]; access?: unknown[] }) =>
      request('/doc-forms.php?action=assign', { method: 'POST', body: JSON.stringify(data) }),
    access: (formId: string) =>
      request(`/doc-forms.php?action=access&form_id=${encodeURIComponent(formId)}`),
    submissions: (formId: string) =>
      request(`/doc-forms.php?action=submissions&form_id=${encodeURIComponent(formId)}`),
    submit: (data: Record<string, unknown>) =>
      request('/doc-forms.php?action=submit', { method: 'POST', body: JSON.stringify(data) }),
    addManualRow: (data: {
      form_id: string;
      values?: Record<string, string>;
      respondent_name?: string;
      respondent_email?: string;
    }) => request('/doc-forms.php?action=add_manual_row', { method: 'POST', body: JSON.stringify(data) }),
    linkTemplate: (data: {
      form_id: string;
      template_id: string;
      template_kind?: 'offer_letter' | 'certificate';
      column_maps?: unknown[];
    }) => request('/doc-forms.php?action=link_template', { method: 'POST', body: JSON.stringify(data) }),
    unlinkTemplate: (formId: string) =>
      request('/doc-forms.php?action=unlink_template', { method: 'POST', body: JSON.stringify({ form_id: formId }) }),
    duplicate: (formId: string) =>
      request('/doc-forms.php?action=duplicate', { method: 'POST', body: JSON.stringify({ id: formId }) }),
    saveColumnMaps: (formId: string, columnMaps: unknown[]) =>
      request('/doc-forms.php?action=save_column_maps', {
        method: 'POST',
        body: JSON.stringify({ form_id: formId, column_maps: columnMaps }),
      }),
    updateSubmissionValues: (data: {
      submission_id: string;
      values: Record<string, string>;
      respondent_name?: string;
      respondent_email?: string;
    }) =>
      request('/doc-forms.php?action=update_submission_values', { method: 'POST', body: JSON.stringify(data) }),
    issue: (data: Record<string, unknown>) =>
      request('/doc-forms.php?action=issue', { method: 'POST', body: JSON.stringify(data) }),
    issued: (kind?: 'offer_letter' | 'certificate') =>
      request(`/doc-forms.php?action=issued${kind ? `&doc_kind=${kind}` : ''}`),
    deleteIssued: (id: string) =>
      request(`/doc-forms.php?action=issued&id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    deleteSubmission: (id: string) =>
      request(`/doc-forms.php?action=submission&id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
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
    duplicate: (formId: string) =>
      request('/forms.php?action=duplicate', {
        method: 'POST',
        body: JSON.stringify({ form_id: formId }),
      }),
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
    /** Org offer-letter + certificate templates for form Automations. */
    automationTemplates: (formId?: string | null) => {
      const q = new URLSearchParams({ action: 'automation_templates' });
      if (formId) q.set('form_id', formId);
      return request<{
        data: {
          offer_letters: Array<{ id: string; name?: string; template_name?: string; status?: string }>;
          certificates: Array<{ id: string; name?: string; status?: string }>;
          org_id?: string | null;
        };
      }>(`/forms.php?${q.toString()}`);
    },
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
    retryAutoDocuments: (body: { form_id: string; lead_id: string }) =>
      request<{
        message?: string;
        data?: {
          certificate_sent?: boolean;
          certificate_id?: string | null;
          certificate_error?: string | null;
          certificate_warning?: string | null;
          offer_letter_sent?: boolean;
          offer_letter_id?: string | null;
          offer_letter_error?: string | null;
          warning?: string | null;
          tags?: Record<string, unknown>;
        };
      }>('/forms.php?action=retry_auto_documents', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
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
    createType: (data: { code: string; label: string }) =>
      request('/certificate-templates.php?action=types', { method: 'POST', body: JSON.stringify(data) }),
    deleteTemplate: (id: string) => request(`/certificate-templates.php?id=${id}`, { method: 'DELETE' }),
    listIssued: () => request('/issued-certificates.php'),
    verifyPublic: (id: string, token: string) =>
      request(`/public-certificate-verify.php?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`),
    /** Public issued PDF (token-gated; same file as email). No login redirect on failure. */
    verifyPublicPdf: async (id: string, token: string): Promise<Blob> => {
      let res: Response;
      try {
        res = await fetch(
          `${API_BASE}/public-certificate-verify.php?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}&format=pdf`,
          { credentials: 'include' },
        );
      } catch {
        throw new Error('Network error - unable to reach server');
      }
      if (!res.ok) {
        throw new Error(res.status === 404 ? 'PDF not found' : 'Could not load certificate PDF');
      }
      return res.blob();
    },
    createIssuedBulk: (certificates: any[]) =>
      request('/issued-certificates.php', { method: 'POST', body: JSON.stringify({ certificates }) }),
    updateIssuedStatus: (id: string, status: 'issued' | 'revoked' | 'expired') =>
      request(`/issued-certificates.php?id=${id}`, { method: 'PUT', body: JSON.stringify({ status }) }),
    deleteIssued: (id: string) =>
      request(`/issued-certificates.php?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    issue: (data: {
      recipientId: string;
      templateId: string;
      syncId: string;
      recipientName?: string;
      recipientEmail?: string;
      courseName?: string;
      issueDate?: string;
      verifyToken?: string;
      /** Browser-generated certificate PDF (base64, optional data-URL prefix). */
      pdf_base64?: string;
      pdfBase64?: string;
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
    /** Issued certificate PDF bytes (same file attached to email). */
    pdf: (certificateId: string) =>
      requestBlob(
        `/certificates.php?action=pdf&certificate_id=${encodeURIComponent(certificateId)}`,
      ),
    emailLogs: (certificateId?: string) =>
      request(`/certificates.php?action=email_logs${certificateId ? `&certificate_id=${encodeURIComponent(certificateId)}` : ''}`),
  },

  fresherSalary: {
    list: async (): Promise<{ members: FresherMember[]; policy: FresherOrgPolicy }> => {
      const data = await request('/fresher-salary-tracker.php');
      const rows = data?.data;
      return {
        members: Array.isArray(rows) ? rows : [],
        policy: normalizeFresherPolicy(data?.policy),
      };
    },
    create: (member: FresherMember) =>
      request('/fresher-salary-tracker.php', { method: 'POST', body: JSON.stringify({ member }) }),
    update: (member: FresherMember, opts?: { manual?: boolean; override_phases?: string[] }) =>
      request(`/fresher-salary-tracker.php?id=${encodeURIComponent(member.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          member,
          manual: !!opts?.manual,
          override_phases: opts?.override_phases,
          manual_edit: !!opts?.manual,
        }),
      }),
    remove: (id: string) => request(`/fresher-salary-tracker.php?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
    registerTraineeJoin: (body: { trainee_user_id: string; joining_date: string }) =>
      request('/fresher-salary-tracker.php?action=register_trainee_join', { method: 'POST', body: JSON.stringify(body) }),
    getPolicy: async (): Promise<FresherOrgPolicy> => {
      const data = await request('/fresher-salary-tracker.php?action=policy');
      return normalizeFresherPolicy(data?.data);
    },
    savePolicy: (policy: FresherOrgPolicy) =>
      request('/fresher-salary-tracker.php?action=policy', {
        method: 'PUT',
        body: JSON.stringify({ policy }),
      }),
    myProgress: async (): Promise<{
      enrolled: boolean;
      joining_date?: string;
      phase_key?: string;
      phase_label?: string;
      window_start?: string | null;
      window_end_exclusive?: string | null;
      target_rupees?: number;
      achieved_rupees?: number;
      remaining_rupees?: number;
      achievement_pct?: number;
      salary_type?: string | null;
      headline_status?: string | null;
      tracker_phase?: string | null;
      member_name?: string | null;
      policy?: FresherOrgPolicy;
      member?: FresherMember | null;
    }> => {
      const data = await request('/fresher-salary-tracker.php?action=my_progress');
      const row = data?.data;
      return row && typeof row === 'object' ? row : { enrolled: false };
    },
  },

  videoIntros: {
    list: (q: { q?: string; status?: string; org_id?: string } = {}) => {
      const qs = new URLSearchParams();
      if (q.q) qs.set('q', q.q);
      if (q.status && q.status !== 'all') qs.set('status', q.status);
      if (q.org_id) qs.set('org_id', q.org_id);
      const s = qs.toString();
      return request(`/video-intros.php${s ? `?${s}` : ''}`) as Promise<{
        data: VideoIntroInvitation[];
        counts: Record<string, number>;
      }>;
    },
    get: (id: string) =>
      request(`/video-intros.php?id=${encodeURIComponent(id)}`) as Promise<{
        data: VideoIntroInvitation;
        recording: VideoIntroRecordingMeta | null;
        events: VideoIntroEvent[];
        retention_days: number;
      }>,
    create: (data: Record<string, unknown>, orgId?: string) => {
      const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : '';
      return request(`/video-intros.php${qs}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }) as Promise<{ message: string; data: VideoIntroInvitation }>;
    },
    revoke: (id: string) =>
      request(`/video-intros.php?action=revoke&id=${encodeURIComponent(id)}`, { method: 'POST' }),
    regenerate: (id: string) =>
      request(`/video-intros.php?action=regenerate&id=${encodeURIComponent(id)}`, { method: 'POST' }) as Promise<{
        message: string;
        data: VideoIntroInvitation;
      }>,
    deleteRecording: (id: string) =>
      request(`/video-intros.php?action=delete_recording&id=${encodeURIComponent(id)}`, { method: 'POST' }),
    delete: (id: string) =>
      request(`/video-intros.php?action=delete&id=${encodeURIComponent(id)}`, { method: 'POST' }),
    listMailboxes: (orgId?: string) => {
      const q = new URLSearchParams({ action: 'mailboxes' });
      if (orgId) q.set('org_id', orgId);
      return request(`/video-intros.php?${q.toString()}`) as Promise<{
        data: Array<{ id: string; slot?: number; label?: string; email: string; from_name?: string }>;
        org_id?: string;
      }>;
    },
    sendEmail: (id: string, body: { smtp_account_id: string; invite_url: string }) =>
      request(`/video-intros.php?action=send_email&id=${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }) as Promise<{ message: string; email_sent: boolean; error?: string }>,
    mediaBlob: (id: string) => requestBlob(`/video-intros.php?action=media&id=${encodeURIComponent(id)}`),
  },
};

export type VideoIntroInvitation = {
  id: string;
  candidate_name: string;
  email?: string | null;
  phone?: string | null;
  position?: string | null;
  status: string;
  max_duration_sec: number;
  max_retries: number;
  retry_count?: number;
  retries_remaining?: number;
  expires_at: string;
  submitted_at?: string | null;
  opened_at?: string | null;
  recording_started_at?: string | null;
  revoked_at?: string | null;
  consent_at?: string | null;
  created_at?: string;
  org_id?: string | null;
  org_name?: string | null;
  created_by_name?: string | null;
  has_recording?: boolean;
  duration_ms?: number | null;
  byte_size?: number | null;
  invite_url?: string;
  invite_path?: string;
  retention_days?: number;
};

export type VideoIntroRecordingMeta = {
  id: string;
  mime_type: string;
  byte_size: number;
  duration_ms: number;
  uploaded_at: string;
  stored_gcs?: number;
  stored_local?: number;
};

export type VideoIntroEvent = {
  id: string;
  event_type: string;
  detail?: string | null;
  created_at: string;
};
