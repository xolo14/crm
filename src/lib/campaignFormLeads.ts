import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { phpList } from "@/lib/phpList";
import type { CampaignPickPerson } from "@/components/marketing/CampaignRecipientPicker";
import { useToast } from "@/hooks/use-toast";

export type CampaignFormOption = { id: string; name: string };
export type FormLeadDestination = "form_leads" | "hr_leads";

export function mapCampaignForms(res: unknown): CampaignFormOption[] {
  return phpList<{ id?: string; name?: string; is_active?: unknown }>(res)
    .map((f) => {
      const inactive = f.is_active === 0 || f.is_active === "0" || f.is_active === false;
      const base = String(f.name ?? "").trim() || "Untitled form";
      return {
        id: String(f.id ?? "").trim(),
        name: inactive ? `${base} (inactive)` : base,
      };
    })
    .filter((f) => f.id !== "")
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchCampaignForms(): Promise<CampaignFormOption[]> {
  return mapCampaignForms(await api.forms.list());
}

export type FormLeadRow = {
  id?: string;
  name?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  college?: string;
  course?: string;
  course_interest?: string;
  company?: string;
  source?: string;
  status?: string;
  created_at?: string;
};

export async function fetchFormLeadRows(formId: string): Promise<{
  rows: FormLeadRow[];
  destination: FormLeadDestination;
}> {
  const all: FormLeadRow[] = [];
  let page = 1;
  let destination: FormLeadDestination = "form_leads";
  const limit = 500;
  while (page <= 10) {
    const res = (await api.forms.submissions(formId, { page, limit })) as {
      submissions?: FormLeadRow[];
      total?: number;
      destination?: string;
    };
    destination = res.destination === "hr_leads" ? "hr_leads" : "form_leads";
    const batch = Array.isArray(res.submissions) ? res.submissions : [];
    all.push(...batch);
    const total = Number(res.total ?? all.length);
    if (batch.length < limit || all.length >= total) break;
    page += 1;
  }
  return { rows: all, destination };
}

export function formLeadPersonId(destination: FormLeadDestination, leadId: string): string {
  const prefix = destination === "hr_leads" ? "hr" : "lead";
  return `${prefix}:${leadId}`;
}

function rowToPerson(row: FormLeadRow, destination: FormLeadDestination): CampaignPickPerson | null {
  const id = String(row?.id ?? "").trim();
  if (!id) return null;
  return {
    id: formLeadPersonId(destination, id),
    name: String(row.name || row.full_name || "Lead"),
    email: String(row.email || "").trim() || undefined,
    phone: String(row.phone || "").trim() || undefined,
    college: String(row.college || "").trim() || undefined,
    course: String(row.course_interest || row.course || "").trim() || undefined,
    company: String(row.company || "").trim() || undefined,
    source: String(row.source || "").trim() || undefined,
    group: "leads",
  };
}

export function formRowsToPeople(
  rows: FormLeadRow[],
  destination: FormLeadDestination,
  mode: "email" | "phone",
): CampaignPickPerson[] {
  return rows
    .map((row) => rowToPerson(row, destination))
    .filter((p): p is CampaignPickPerson => {
      if (!p) return false;
      if (mode === "email") return String(p.email || "").includes("@");
      return String(p.phone || "").replace(/\D+/g, "").length >= 10;
    });
}

export function leadHasCampaignContact(lead: FormLeadRow, mode: "email" | "phone"): boolean {
  if (mode === "email") return String(lead?.email || "").includes("@");
  return String(lead?.phone || "").replace(/\D+/g, "").length >= 10;
}

export function useCampaignFormLeads() {
  const { toast } = useToast();
  const [campaignForms, setCampaignForms] = useState<CampaignFormOption[]>([]);
  const [campaignFormsLoading, setCampaignFormsLoading] = useState(false);
  const [selectedFormId, setSelectedFormId] = useState("");
  const [formLeadRows, setFormLeadRows] = useState<FormLeadRow[]>([]);
  const [formLeadsLoading, setFormLeadsLoading] = useState(false);
  const [formLeadDestination, setFormLeadDestination] = useState<FormLeadDestination>("form_leads");
  const [extraFormPeople, setExtraFormPeople] = useState<CampaignPickPerson[]>([]);

  const loadForms = useCallback(() => {
    setCampaignFormsLoading(true);
    return fetchCampaignForms()
      .then(setCampaignForms)
      .catch(() => setCampaignForms([]))
      .finally(() => setCampaignFormsLoading(false));
  }, []);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

  useEffect(() => {
    if (!selectedFormId) {
      setFormLeadRows([]);
      setFormLeadsLoading(false);
      return;
    }
    let cancelled = false;
    setFormLeadsLoading(true);
    setFormLeadRows([]);
    void fetchFormLeadRows(selectedFormId)
      .then(({ rows, destination }) => {
        if (cancelled) return;
        setFormLeadDestination(destination);
        setFormLeadRows(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setFormLeadRows([]);
        toast({
          variant: "destructive",
          title: "Could not load form leads",
          description: "Check that this form is available to your account.",
        });
      })
      .finally(() => {
        if (!cancelled) setFormLeadsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid reload loops from toast identity
  }, [selectedFormId]);

  const formPeopleEmail = useMemo(
    () => formRowsToPeople(formLeadRows, formLeadDestination, "email"),
    [formLeadRows, formLeadDestination],
  );
  const formPeoplePhone = useMemo(
    () => formRowsToPeople(formLeadRows, formLeadDestination, "phone"),
    [formLeadRows, formLeadDestination],
  );

  useEffect(() => {
    const next = [...formPeopleEmail, ...formPeoplePhone];
    if (next.length === 0) return;
    setExtraFormPeople((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      for (const p of next) byId.set(p.id, p);
      return Array.from(byId.values());
    });
  }, [formPeopleEmail, formPeoplePhone]);

  return {
    campaignForms,
    campaignFormsLoading,
    selectedFormId,
    setSelectedFormId,
    formLeadRows,
    formLeadsLoading,
    formLeadDestination,
    formPeopleEmail,
    formPeoplePhone,
    extraFormPeople,
    setExtraFormPeople,
    loadForms,
  };
}
