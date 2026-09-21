import { getApiBase } from "@/lib/apiBase";

const API_BASE = getApiBase();

function authHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
  };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/assessments.php${path}`, {
    ...init,
    credentials: "include",
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

export type PeaklyyResponseMode = "mcq" | "notepad" | "upload" | "notepad_upload";

export interface PeaklyyCustomQuestionInput {
  q_type?: "mcq" | "task";
  response_mode?: PeaklyyResponseMode;
  prompt: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  correct_option?: "a" | "b" | "c" | "d";
  points?: number;
  allow_notepad?: boolean;
  allow_upload?: boolean;
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
  delete: (id: string) =>
    req<{ message: string; id: string }>("?action=delete", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  assignUsers: (assessmentId: string, userIds: string[]) =>
    req<{ message: string; count: number; user_ids?: string[] }>("?action=assign_users", {
      method: "POST",
      body: JSON.stringify({ assessment_id: assessmentId, user_ids: userIds }),
    }),
  assignedUsers: (assessmentId: string) =>
    req<{ data: Array<{ user_id: string; full_name?: string; email?: string; role?: string }> }>(
      `?action=assigned_users&assessment_id=${encodeURIComponent(assessmentId)}`,
    ),
  myAssignments: () =>
    req<{ data: PeaklyyAssessment[] }>("?action=my_assignments"),
  attempts: (assessmentId: string) =>
    req<{ data: PeaklyyAttemptRow[] }>(`?action=attempts&assessment_id=${encodeURIComponent(assessmentId)}`),
  deleteAttempt: (attemptId: string) =>
    req<{ message: string; attempt_id: string }>("?action=delete_attempt", {
      method: "POST",
      body: JSON.stringify({ attempt_id: attemptId }),
    }),
  attemptDetail: (attemptId: string) =>
    req<{
      data: PeaklyyAttemptRow;
      answers: PeaklyyAttemptAnswerDetail[];
      mcq_answers?: PeaklyyAttemptAnswerDetail[];
      task_answers?: PeaklyyAttemptAnswerDetail[];
      timeline?: PeaklyyTimelineEvent[];
      timeline_text?: string;
    }>(`?action=attempt_detail&attempt_id=${encodeURIComponent(attemptId)}`),
  downloadTasksZip: async (attemptId: string) => {
    const res = await fetch(
      `${API_BASE}/assessments.php?action=download_tasks_zip&attempt_id=${encodeURIComponent(attemptId)}`,
      { credentials: "include" },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Download failed (${res.status})`);
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const match = /filename="?([^";]+)"?/i.exec(cd);
    const filename = match?.[1] || `tasks-${attemptId}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  publicGet: (slug: string, key?: string) => {
    const q = new URLSearchParams({ action: "public_get", slug });
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (key) {
      (headers as Record<string, string>)["X-Assessment-Api-Key"] = key;
    }
    return req<{
      data: PeaklyyAssessmentPublic;
      domains: Record<string, string>;
      degrees: string[];
      instructions: string[];
    }>(`?${q.toString()}`, { headers });
  },
  register: (body: {
    slug: string;
    full_name: string;
    email: string;
    phone: string;
    domain_key: string;
    degree_branch?: string;
    college_name?: string;
    graduation_year?: string;
  }) =>
    req<{ attempt_token: string }>("?action=register", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  start: (attempt_token: string, phase?: "mcq" | "task" | "single") =>
    req<{
      questions: PeaklyyQuestion[];
      duration_minutes: number;
      ends_at: string | null;
      anti_cheat: boolean;
      domain_label: string;
      phase?: string;
      title?: string;
    }>("?action=start", {
      method: "POST",
      body: JSON.stringify({ attempt_token, ...(phase ? { phase } : {}) }),
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
      phase?: string;
      next_phase?: string | null;
      task_questions?: PeaklyyQuestion[];
      tasks_submitted?: boolean;
      message?: string;
      require_interests?: boolean;
      interest_options?: string[];
    }>("?action=submit", {
      method: "POST",
      body: JSON.stringify({ attempt_token, answers }),
      headers: { "Content-Type": "application/json" },
    }),
  saveInterests: (attempt_token: string, interests: string[]) =>
    req<{ success: boolean; interests: string[]; message?: string }>("?action=save_interests", {
      method: "POST",
      body: JSON.stringify({ attempt_token, interests }),
      headers: { "Content-Type": "application/json" },
    }),
  saveAnswer: (
    attempt_token: string,
    body: { question_id: string; text?: string; option?: string },
  ) =>
    req<{ ok: boolean; question_id: string; saved: Record<string, unknown> }>("?action=save_answer", {
      method: "POST",
      body: JSON.stringify({ attempt_token, ...body }),
      headers: { "Content-Type": "application/json" },
    }),
  uploadAnswer: async (attempt_token: string, question_id: string, file: File, text?: string) => {
    const fd = new FormData();
    fd.append("attempt_token", attempt_token);
    fd.append("question_id", question_id);
    fd.append("file", file);
    if (text != null) fd.append("text", text);
    const res = await fetch(`${API_BASE}/assessments.php?action=upload_answer`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `Upload failed (${res.status})`);
    }
    return data as {
      ok: boolean;
      question_id: string;
      file_path: string;
      file_name: string;
      saved: Record<string, unknown>;
    };
  },
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
  ui_theme?: string;
  interest_options?: string[];
  require_post_interests?: boolean;
  assigned_user_ids?: string[];
}

export type PeaklyyAssessmentPublic = Omit<PeaklyyAssessment, "result_api_key">;

export interface PeaklyyTimelineEvent {
  at: string | null;
  event: string;
  label: string;
  detail?: Record<string, unknown> | null;
}

export interface PeaklyyAttemptRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  domain_key: string;
  degree_branch?: string | null;
  college_name?: string | null;
  graduation_year?: string | null;
  interest_topics?: string[] | null;
  interest_selected_json?: unknown;
  violation_count?: number | null;
  status: string;
  attempt_phase?: string;
  score: number | null;
  stars: number | null;
  passed: number | null;
  time_taken_seconds: number | null;
  started_at?: string | null;
  submitted_at: string | null;
  mcq_submitted_at?: string | null;
  webhook_status: string | null;
  webhook_sent_at?: string | null;
  created_at?: string;
  timeline?: PeaklyyTimelineEvent[];
  timeline_text?: string;
}

export interface PeaklyyAttemptAnswerDetail {
  question_id: string;
  question_number?: number;
  prompt: string;
  q_type: string;
  part?: string;
  allow_notepad: boolean;
  allow_upload: boolean;
  answer_option: string | null;
  text: string;
  file_path: string;
  file_name: string;
  notepad_file_path?: string;
  notepad_file_name?: string;
  is_correct: number;
  points_awarded: number;
}

export interface PeaklyyQuestion {
  id: string;
  domain_key: string;
  level_key: string;
  q_type: "mcq" | "task";
  prompt: string;
  options?: Record<string, string> | null;
  task_schema?: Record<string, unknown> | null;
  allow_notepad?: boolean;
  allow_upload?: boolean;
  points: number;
}
