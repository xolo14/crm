export interface HRUser {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  role: "hr";
  created_by?: string | null;
  is_active?: number | boolean;
  created_at?: string;
}

export interface HRLead {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  source?: string;
  status?: string;
  notes?: string | null;
  created_at?: string;
  assigned_by_name?: string | null;
}

export interface HRTask {
  id: string;
  title: string;
  due_date?: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  status: string;
  assigned_by_name?: string | null;
}

export interface HRNotification {
  id: string;
  title: string;
  message?: string | null;
  type?: string;
  is_read: number | boolean;
  created_at?: string;
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  type?: string;
}

export interface HRDashboardStats {
  my_leads_added: number;
  assigned_leads: number;
  pending_tasks: number;
  upcoming_holidays: number;
  activity: Array<{ label: string; value: number }>;
}
