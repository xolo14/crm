import { api } from "@/lib/api";

export type AccessibleLeadOption = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  college: string;
  year_of_study: string;
  course_interest: string;
  source: string;
  status: string;
};

/** Page size for search paging. Soft-capped via maxRows so older matches are not skipped. */
const SEARCH_PAGE = 2000;
/** Hard stop for picker search results (keeps dropdowns usable). */
const SEARCH_MAX_ROWS = 10000;

export async function searchAccessibleLeads(
  query: string,
  opts?: { orgId?: string },
): Promise<{
  leads: AccessibleLeadOption[];
  truncated: boolean;
}> {
  const q = query.trim();
  if (!q) return { leads: [], truncated: false };
  const digits = q.replace(/\D/g, "");
  const search = digits.length >= 6 && digits.length >= q.replace(/[\s+-]/g, "").length ? digits : q;

  const res = (await api.leads.list({
    search,
    lite: true,
    all: true,
    limit: SEARCH_PAGE,
    maxRows: SEARCH_MAX_ROWS,
    ...(opts?.orgId ? { org_id: opts.orgId } : {}),
  })) as { data?: unknown; leads?: unknown; truncated?: boolean };

  const rows = (
    Array.isArray(res) ? res : res?.data || res?.leads || []
  ) as Array<Record<string, unknown>>;

  const leads = rows
    .map((l) => ({
      id: String(l.id ?? ""),
      name: String(l.name || "Unnamed lead"),
      email: String(l.email || ""),
      phone: String(l.phone || ""),
      company: String(l.company || ""),
      college: String(l.college || ""),
      year_of_study: String(l.year_of_study || ""),
      course_interest: String(l.course_interest || ""),
      source: String(l.source || ""),
      status: String(l.status || ""),
    }))
    .filter((l) => l.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { leads, truncated: Boolean(res?.truncated) };
}
