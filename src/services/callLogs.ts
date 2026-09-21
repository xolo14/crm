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
  return null;
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(`${API_BASE}${url}`, { ...options, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "";
    const msg = data?.error || "Request failed";
    throw new Error(detail ? `${msg}: ${detail}` : msg);
  }
  return data;
}

async function requestMultipart<T>(url: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, { method: "POST", body: formData, credentials: "include" });
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
  getStats: (params: CallLogPeriod | string | CallLogsQueryParams) => {
    const q =
      typeof params === "string"
        ? { period: params }
        : {
            period: params.period,
            date_from: params.date_from,
            date_to: params.date_to,
            sales_rep_id: params.sales_rep_id,
          };
    return request<{ success: true; stats: CallLogStats; period?: unknown }>(
      `/call_logs.php?action=get_stats${toQuery(q as Record<string, unknown>)}`,
    );
  },

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
  getDailyReportMetrics: (date: string, salesRepId?: string) =>
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
    }>(
      `/call_logs.php?action=daily_report_metrics${toQuery({
        date,
        ...(salesRepId ? { sales_rep_id: salesRepId } : {}),
      })}`,
    ),

  /** Backfill/refresh daily_reports from call_logs (days capped server-side at 730). */
  syncDailyReportsFromCallLogs: (days = 60) =>
    request<{ success: true; synced_dates: number }>(
      `/call_logs.php?action=sync_daily_reports${toQuery({ days })}`,
    ),

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
