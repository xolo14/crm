export type CallType = "incoming" | "outgoing" | "missed" | "rejected";
export type CallStatus = "connected" | "never_attended" | "not_pickup_by_client";

export interface CallLog {
  id: number;
  sales_rep_id: string;
  org_id: string;
  lead_id?: string | null;
  call_type: CallType;
  call_status: CallStatus;
  duration_seconds: number;
  client_phone?: string | null;
  client_name?: string | null;
  notes?: string | null;
  attachment_path?: string | null;
  call_date: string;
  call_time?: string | null;
  created_at: string;
  sales_rep_name?: string | null;
  lead_name?: string | null;
  /** Pipeline status from linked `leads.status` when `lead_id` is set */
  lead_status?: string | null;
}

export interface CallLogStats {
  total_calls: number;
  call_duration: string;
  incoming: number;
  incoming_duration: string;
  outgoing: number;
  outgoing_duration: string;
  missed: number;
  rejected: number;
  never_attended: number;
  not_pickup_by_client: number;
  unique_clients: number;
  working_hours: string;
  connected_calls: number;
  period_label: string;
}

export interface CreateCallLogInput {
  call_type: CallType;
  call_status: CallStatus;
  duration_seconds: number;
  client_phone?: string;
  client_name?: string;
  notes?: string;
  call_date: string;
  call_time?: string;
  lead_id?: string;
  /** CRM pipeline status applied to the linked lead (same as leads.status). */
  lead_status?: string;
  sales_rep_id?: string;
}

export type CallLogPeriod = "today" | "week" | "month";

export interface CallLogsQueryParams {
  period?: CallLogPeriod | string;
  date_from?: string;
  date_to?: string;
  call_type?: CallType;
  call_status?: CallStatus;
  page?: number;
  limit?: number;
}
