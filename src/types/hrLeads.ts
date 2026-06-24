export type HRLeadStatus =
  | "new"
  | "contacted"
  | "interested"
  | "not_interested"
  | "converted"
  | "lost";

export type HRLeadPriority = "low" | "medium" | "high";

/** HR portal lead row (stored in DB table `hr_leads`) */
export interface HRLead {
  id: number;
  hr_id: string;
  assigned_by: string | null;
  org_id?: string | null;
  full_name: string;
  phone: string;
  email?: string;
  source?: string;
  status: HRLeadStatus;
  priority: HRLeadPriority;
  notes?: string;
  resume_path?: string | null;
  follow_up_date?: string;
  is_assigned: 0 | 1;
  created_at: string;
  updated_at: string;
  hr_name?: string;
  assigned_by_name?: string;
  org_name?: string;
}

export interface HRLeadStats {
  total: number;
  by_status: Record<HRLeadStatus, number>;
  this_week: number;
  this_month: number;
}

export interface CreateHRLeadInput {
  full_name: string;
  phone: string;
  email?: string;
  source?: string;
  status: HRLeadStatus;
  priority: HRLeadPriority;
  notes?: string;
  follow_up_date?: string;
  hr_id?: string;
  resume?: File;
}

export interface HRLeadQueryParams {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface AdminHRLeadQueryParams extends HRLeadQueryParams {
  hr_id?: string;
  is_assigned?: 0 | 1;
  source?: string;
  org_id?: string;
  /** YYYY-MM-DD — optional admin history filter */
  date_from?: string;
  /** YYYY-MM-DD — optional admin history filter */
  date_to?: string;
}

export interface HRLeadWeekMeta {
  start: string;
  end: string;
  label: string;
  resets_in: string;
}
