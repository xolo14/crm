import type {
  CallLog,
  CallLogPeriod,
  CallLogStats,
  CallLogsQueryParams,
  CreateCallLogInput,
} from "@/types/callLog";

import { getApiBase } from "@/lib/apiBase";

const API_BASE = getApiBase();

function getToken() {
  return localStorage.getItem("auth_token");
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "";
    const msg = data?.error || "Request failed";
    throw new Error(detail ? `${msg}: ${detail}` : msg);
  }
  return data;
}

async function requestMultipart<T>(url: string, formData: FormData): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${url}`, { method: "POST", body: formData, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "";
    const msg = data?.error || "Request failed";
    throw new Error(detail ? `${msg}: ${detail}` : msg);
  }
  return data;
}

function appendCallLogFields(fd: FormData, body: Record<string, unknown>) {
  Object.entries(body).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    fd.append(k, String(v));
  });
}

function toQuery(params: Record<string, unknown>) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  });
  const q = usp.toString();
  return q ? `&${q}` : "";
}

export const callLogsApi = {
  getStats: (period: CallLogPeriod | string) =>
    request<{ success: true; stats: CallLogStats; period?: unknown }>(
      `/call_logs.php?action=get_stats${toQuery({ period })}`,
    ),

  getLogs: (params: CallLogsQueryParams) =>
    request<{
      success: true;
      logs: CallLog[];
      total: number;
      page: number;
      limit: number;
      period: { from: string; to: string; label: string; key: string };
    }>(`/call_logs.php?action=get_logs${toQuery(params as Record<string, unknown>)}`),

  /** Single-day aggregates from call logs + linked lead status (daily report prefill). */
  getDailyReportMetrics: (date: string) =>
    request<{
      success: true;
      metrics: {
        total_calls: number;
        total_followups: number;
        total_demos: number;
        total_conversions: number;
        new_leads_contacted: number;
        total_lost: number;
      };
      date: string;
    }>(`/call_logs.php?action=daily_report_metrics${toQuery({ date })}`),

  addLog: (body: CreateCallLogInput) =>
    request<{ success: true; log: CallLog }>("/call_logs.php?action=add_log", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  addLogMultipart: (body: CreateCallLogInput, recording: File) => {
    const fd = new FormData();
    appendCallLogFields(fd, body as unknown as Record<string, unknown>);
    fd.append("call_recording", recording);
    return requestMultipart<{ success: true; log: CallLog }>("/call_logs.php?action=add_log", fd);
  },

  updateLog: (body: Partial<CreateCallLogInput> & { id: number }) =>
    request<{ success: true; message: string }>("/call_logs.php?action=update_log", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  updateLogMultipart: (body: Partial<CreateCallLogInput> & { id: number }, recording: File) => {
    const fd = new FormData();
    fd.append("id", String(body.id));
    const { id: _id, ...rest } = body;
    appendCallLogFields(fd, rest as Record<string, unknown>);
    fd.append("call_recording", recording);
    return requestMultipart<{ success: true; message: string }>("/call_logs.php?action=update_log", fd);
  },

  deleteLog: (id: number) =>
    request<{ success: true; message: string }>("/call_logs.php?action=delete_log", {
      method: "DELETE",
      body: JSON.stringify({ id }),
    }),
};
