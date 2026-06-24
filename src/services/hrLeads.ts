import type {
  AdminHRLeadQueryParams,
  CreateHRLeadInput,
  HRLead,
  HRLeadQueryParams,
  HRLeadStats,
  HRLeadWeekMeta,
} from "@/types/hrLeads";

import { getApiBase } from "@/lib/apiBase";

const API_BASE = getApiBase();

function getToken() {
  return localStorage.getItem("auth_token") || localStorage.getItem("hr_token");
}

function toQuery(params: Record<string, any>) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  });
  return usp.toString();
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data;
}

const apiGet = <T>(path: string, params: Record<string, any>) =>
  request<T>(`${path}${toQuery(params) ? `&${toQuery(params)}` : ""}`);
const apiPut = <T>(path: string, body: any) => request<T>(path, { method: "PUT", body: JSON.stringify(body) });
const apiDelete = <T>(path: string, body: any) => request<T>(path, { method: "DELETE", body: JSON.stringify(body) });

async function apiPostForm<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", body: formData, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || data?.message || "Request failed");
  return data;
}

function buildAddLeadFormData(data: CreateHRLeadInput): FormData {
  const fd = new FormData();
  fd.append("full_name", data.full_name);
  fd.append("phone", data.phone);
  if (data.email) fd.append("email", data.email);
  if (data.source) fd.append("source", data.source);
  fd.append("status", data.status);
  fd.append("priority", data.priority);
  if (data.notes) fd.append("notes", data.notes);
  if (data.follow_up_date) fd.append("follow_up_date", data.follow_up_date);
  if (data.hr_id) fd.append("hr_id", data.hr_id);
  if (data.resume) fd.append("resume", data.resume);
  return fd;
}

export const hrLeadsApi = {
  addLead: (data: CreateHRLeadInput) =>
    apiPostForm<{ success: true; lead: HRLead }>("/hr_leads.php?action=add_lead", buildAddLeadFormData(data)),
  getMyLeads: (params: HRLeadQueryParams) =>
    apiGet<{
      success: true;
      data: HRLead[];
      leads?: HRLead[];
      total: number;
      page: number;
      limit: number;
      week?: HRLeadWeekMeta;
    }>("/hr_leads.php?action=my_leads", params),
  getAssigned: (params: HRLeadQueryParams) =>
    apiGet<{ success: true; data: HRLead[]; total: number; page: number; limit: number }>(
      "/hr_leads.php?action=assigned_leads",
      params,
    ),
  updateLead: (data: Partial<HRLead> & { id: number; resume?: File }) => {
    if (data.resume instanceof File) {
      const fd = new FormData();
      fd.append("id", String(data.id));
      const skip = new Set(["id", "resume"]);
      Object.entries(data).forEach(([k, v]) => {
        if (skip.has(k)) return;
        if (v === undefined || v === null || v === "") return;
        fd.append(k, String(v));
      });
      fd.append("resume", data.resume);
      return apiPostForm<{ success: true; message: string }>("/hr_leads.php?action=update_lead", fd);
    }
    const { resume: _r, ...rest } = data as Partial<HRLead> & { id: number; resume?: File };
    return apiPut<{ success: true; message: string }>("/hr_leads.php?action=update_lead", rest);
  },
  deleteLead: (id: number) =>
    apiDelete<{ success: true; message: string }>("/hr_leads.php?action=delete_lead", { id }),
  getLead: (id: number) => apiGet<{ success: true; lead: HRLead }>("/hr_leads.php?action=get_lead", { id }),
  getAllLeads: (params: AdminHRLeadQueryParams) =>
    apiGet<{
      success: true;
      leads: HRLead[];
      data?: HRLead[];
      total: number;
      unassigned: number;
      page: number;
      limit: number;
    }>("/hr_leads.php?action=all_leads", params),
  assignLead: (id: number, hr_id: string) =>
    apiPut<{ success: true; message: string }>("/hr_leads.php?action=assign_lead", { id, hr_id }),
  bulkAssignLeads: (assignments: Array<{ id: number; hr_id: string }>) =>
    request<{
      success: boolean;
      assigned: number;
      failed: number;
      total: number;
      results: Array<{ ok: boolean; id: number; hr_id?: string; error?: string }>;
    }>("/hr_leads.php?action=bulk_assign_leads", {
      method: "POST",
      body: JSON.stringify({ assignments }),
    }),
  getStats: (org_id?: string) =>
    apiGet<{
      success: true;
      stats: HRLeadStats & {
        by_hr: Array<{ hr_id: string; hr_name: string; count: number }>;
        unassigned: number;
      };
    }>("/hr_leads.php?action=lead_stats", { org_id }),
};
