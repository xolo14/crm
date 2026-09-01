/**
 * DECOY-ONLY API client — talks ONLY to /api-decoy/*
 * Never import from src/lib/api.ts
 */
const API_BASE = '/api-decoy';

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Invalid server response');
  }
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Request failed');
  }
  return data as T;
}

export const decoyApi = {
  login: (email: string, password: string) =>
    request<{ data: { user: DecoyUser; token: string } }>('/auth.php?action=login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request('/auth.php?action=logout', { method: 'POST', body: '{}' }),
  me: () => request<{ data: DecoyUser }>('/auth.php?action=me'),
  dashboard: () =>
    request<{
      data: {
        total: number;
        new: number;
        pipeline: number;
        enrolled: number;
        lost: number;
        by_source: { source: string; count: number }[];
        user: { full_name: string; email: string };
      };
    }>('/dashboard.php'),
  leads: (params?: { limit?: number; offset?: number; search?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    if (params?.search) q.set('search', params.search);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return request<{ data: DecoyLead[]; total: number }>(`/leads.php?${qs}`);
  },
  exportUrl: () => `${API_BASE}/leads.php?action=export`,
};

export type DecoyUser = {
  id: string;
  email: string;
  full_name: string;
  role: string;
};

export type DecoyLead = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string;
  status: string;
  company: string | null;
  created_at: string;
};
