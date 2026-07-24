import { getApiBase } from "@/lib/apiBase";

const API_BASE = getApiBase();

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/assessments.php${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export type PeaklyyDomainKey =
  | "web_dev"
  | "uiux"
  | "content"
  | "digital_marketing"
  | "video_animation";

export type PeaklyySourceMode = "domain_bank" | "custom";

export interface PeaklyyCustomQuestionInput {
  q_type?: "mcq";
  prompt: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  correct_option?: "a" | "b" | "c" | "d";
  points?: number;
}

export const assessmentsApi = {
  list: () => req<{ data: PeaklyyAssessment[]; domains: Record<string, string> }>("?action=list"),
  create: (
    body: Partial<PeaklyyAssessment> & {
      title: string;
      source_mode?: PeaklyySourceMode;
      questions?: PeaklyyCustomQuestionInput[];
    },
  ) =>
    req<{
      id: string;
      slug: string;
      public_url: string;
      open_url: string;
      result_api_key: string;
      duration_minutes: number;
      question_count: number;
      source_mode?: PeaklyySourceMode;
    }>("?action=create", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  regenerateApiKey: (id: string) =>
    req<{ id: string; result_api_key: string; open_url: string }>("?action=regenerate_api_key", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  update: (body: Partial<PeaklyyAssessment> & { id: string }) =>
    req<{ message: string }>("?action=update", { method: "POST", body: JSON.stringify(body) }),
  attempts: (assessmentId: string) =>
    req<{ data: PeaklyyAttemptRow[] }>(`?action=attempts&assessment_id=${encodeURIComponent(assessmentId)}`),
  publicGet: (slug: string, key?: string) => {
    const q = new URLSearchParams({ action: "public_get", slug });
    if (key) q.set("key", key);
    return req<{
      data: PeaklyyAssessmentPublic;
      domains: Record<string, string>;
      degrees: string[];
      instructions: string[];
    }>(`?${q.toString()}`, { headers: { "Content-Type": "application/json" } });
  },
  register: (body: {
    slug: string;
    full_name: string;
    email: string;
    phone: string;
    domain_key: string;
    degree_branch?: string;
    college_name?: string;
  }) =>
    req<{ attempt_token: string }>("?action=register", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  start: (attempt_token: string) =>
    req<{
      questions: PeaklyyQuestion[];
      duration_minutes: number;
      ends_at: string;
      anti_cheat: boolean;
      domain_label: string;
    }>("?action=start", {
      method: "POST",
      body: JSON.stringify({ attempt_token }),
      headers: { "Content-Type": "application/json" },
    }),
  violation: (attempt_token: string) =>
    req<{ violation_count?: number }>("?action=violation", {
      method: "POST",
      body: JSON.stringify({ attempt_token }),
      headers: { "Content-Type": "application/json" },
    }),
  submit: (attempt_token: string, answers: Record<string, unknown>) =>
    req<{
      score: number;
      stars: number;
      passed: boolean;
      time_taken_seconds: number;
      unlock_at: string;
      redirect_url: string | null;
      attempt_token: string;
    }>("?action=submit", {
      method: "POST",
      body: JSON.stringify({ attempt_token, answers }),
      headers: { "Content-Type": "application/json" },
    }),
  result: (attempt_token: string) =>
    req<{
      score: number;
      stars: number;
      passed: boolean;
      time_taken_seconds: number;
      unlock_in_seconds: number;
      breakdown_unlocked: boolean;
      redirect_url: string | null;
      brand_name: string;
      brand_tagline: string;
      domain_label: string;
      full_name: string;
    }>(`?action=result&attempt_token=${encodeURIComponent(attempt_token)}`, {
      headers: { "Content-Type": "application/json" },
    }),
};

export interface PeaklyyAssessment {
  id: string;
  slug: string;
  title: string;
  brand_name: string;
  brand_tagline: string;
  duration_minutes: number;
  question_count: number;
  source_mode?: PeaklyySourceMode;
  pass_score: number;
  once_per_candidate: number | boolean;
  anti_cheat: number | boolean;
  result_webhook_url?: string | null;
  result_api_key?: string | null;
  open_url?: string | null;
  is_active: number | boolean;
  created_at?: string;
}

export type PeaklyyAssessmentPublic = Omit<PeaklyyAssessment, "result_api_key">;

export interface PeaklyyAttemptRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  domain_key: string;
  status: string;
  score: number | null;
  stars: number | null;
  passed: number | null;
  time_taken_seconds: number | null;
  submitted_at: string | null;
  webhook_status: string | null;
}

export interface PeaklyyQuestion {
  id: string;
  domain_key: string;
  level_key: string;
  q_type: "mcq";
  prompt: string;
  options?: Record<string, string> | null;
  points: number;
}
