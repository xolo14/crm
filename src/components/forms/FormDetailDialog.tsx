import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { parseFormMetaJson } from "@/components/forms/publicFormTypes";
import { FormSubmissionDetails } from "@/components/leads/FormSubmissionDetails";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Download, ExternalLink, Loader2, Pencil, ChevronDown, ChevronRight, Mail, MessageSquare } from "lucide-react";
import { openProtectedUpload, resumeStoragePath } from "@/lib/resumeHref";
import { Switch } from "@/components/ui/switch";
import { FormCampaignSendDialog } from "@/components/forms/FormCampaignSendDialog";
import { canManageFormCampaigns, parseFormCampaign, type FormCampaignConfig } from "@/components/forms/formCampaignTypes";
import { useAuth } from "@/hooks/useAuth";
import * as perms from "@/lib/permissions";

type LeadDestination = "form_leads" | "hr_leads";

type FormAssignment = {
  id: string;
  form_id: string;
  member_id: string;
  full_name?: string;
  email?: string;
};

export type FormDetailLeadForm = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  is_active?: number | boolean;
  org_name?: string | null;
  created_at?: string;
  created_by?: string | null;
  submission_count?: number;
  meta_json?: Record<string, unknown>;
};

type FormSubmission = {
  id: string | number;
  name?: string;
  full_name?: string;
  email?: string | null;
  phone?: string | null;
  status?: string;
  source?: string;
  notes?: string | null;
  resume_path?: string | null;
  created_at?: string;
  assigned_to_name?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: FormDetailLeadForm | null;
  assignments?: FormAssignment[];
  publicLink?: string;
  canEdit?: boolean;
  canManageCampaigns?: boolean;
  onEdit?: () => void;
  onCopyLink?: (url: string, label: string) => void;
};

const LEAD_STATUSES = ["new", "contacted", "interested", "demo_scheduled", "demo_attended", "enrolled", "lost"] as const;
const HR_STATUSES = ["new", "contacted", "interested", "not_interested", "converted", "lost"] as const;

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function displayName(row: FormSubmission): string {
  return String(row.name || row.full_name || "—").trim() || "—";
}

function exportSubmissionsCsv(
  formName: string,
  rows: FormSubmission[],
  destination: LeadDestination,
): void {
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const headers =
    destination === "hr_leads"
      ? ["Name", "Phone", "Email", "Status", "Submitted", "Resume URL"]
      : ["Name", "Email", "Phone", "Status", "Assigned To", "Submitted"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    if (destination === "hr_leads") {
      lines.push(
        [
          displayName(row),
          row.phone || "",
          row.email || "",
          row.status || "",
          row.created_at || "",
          row.resume_path ? resumeStoragePath(row.resume_path) || row.resume_path : "",
        ]
          .map(escape)
          .join(","),
      );
    } else {
      lines.push(
        [
          displayName(row),
          row.email || "",
          row.phone || "",
          row.status || "",
          row.assigned_to_name || "",
          row.created_at || "",
        ]
          .map(escape)
          .join(","),
      );
    }
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${formName.replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "form"}_submissions.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function FormDetailDialog({
  open,
  onOpenChange,
  form,
  assignments = [],
  publicLink = "",
  canEdit = false,
  canManageCampaigns = false,
  onEdit,
  onCopyLink,
}: Props) {
  const { toast } = useToast();
  const { role } = useAuth();
  const hasExport = perms.canExport(role);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [destination, setDestination] = useState<LeadDestination>("form_leads");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [campaignCfg, setCampaignCfg] = useState<FormCampaignConfig>(() => parseFormCampaign(form?.meta_json));
  const [campaignChannel, setCampaignChannel] = useState<"email" | "whatsapp" | null>(null);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const limit = 25;

  const meta = useMemo(() => parseFormMetaJson(form?.meta_json), [form?.meta_json]);
  const leadDest: LeadDestination = meta.lead_destination === "hr_leads" ? "hr_leads" : "form_leads";
  const statusOptions = leadDest === "hr_leads" ? HR_STATUSES : LEAD_STATUSES;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const loadSubmissions = useCallback(async () => {
    if (!form?.id) return;
    setLoading(true);
    try {
      const res = await api.forms.submissions(form.id, { page, limit, search, status });
      setSubmissions(Array.isArray(res?.submissions) ? res.submissions : []);
      setTotal(Number(res?.total ?? 0));
      setDestination(res?.destination === "hr_leads" ? "hr_leads" : "form_leads");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Try again.";
      toast({ variant: "destructive", title: "Failed to load submissions", description: message });
    } finally {
      setLoading(false);
    }
  }, [form?.id, page, limit, search, status, toast]);

  useEffect(() => {
    setCampaignCfg(parseFormCampaign(form?.meta_json));
  }, [form?.id, form?.meta_json]);

  useEffect(() => {
    if (!open || !form?.id) return;
    void loadSubmissions();
  }, [open, form?.id, loadSubmissions]);

  useEffect(() => {
    if (!open) {
      setPage(1);
      setSearchInput("");
      setSearch("");
      setStatus("all");
      setExpandedId(null);
    }
  }, [open, form?.id]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput, open]);

  async function handleExportCsv() {
    if (!form?.id) return;
    setExporting(true);
    try {
      const res = await api.forms.submissions(form.id, {
        page: 1,
        limit: 500,
        search,
        status,
      });
      const rows = Array.isArray(res?.submissions) ? res.submissions : [];
      const dest = res?.destination === "hr_leads" ? "hr_leads" : "form_leads";
      if (rows.length === 0) {
        toast({ title: "No submissions to export" });
        return;
      }
      exportSubmissionsCsv(form.name, rows, dest);
      toast({ title: "CSV downloaded", description: `${rows.length} row(s) exported` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Try again.";
      toast({ variant: "destructive", title: "Export failed", description: message });
    } finally {
      setExporting(false);
    }
  }

  async function patchCampaign(patch: Partial<FormCampaignConfig>) {
    if (!form?.id) return;
    const previous = campaignCfg;
    const next = { ...previous, ...patch };
    setCampaignCfg(next);
    setSavingCampaign(true);
    try {
      await api.forms.saveCampaignSettings({ form_id: form.id, campaign: next });
      toast({ title: "Campaign settings saved" });
    } catch (error: unknown) {
      setCampaignCfg(previous);
      const message = error instanceof Error ? error.message : "Try again.";
      toast({ variant: "destructive", title: "Save failed", description: message });
    } finally {
      setSavingCampaign(false);
    }
  }

  if (!form) return null;

  const isActive = form.is_active === true || form.is_active === 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-4xl max-h-[min(90dvh,100%)] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            {form.name}
            <Badge variant={leadDest === "hr_leads" ? "secondary" : "default"}>
              {leadDest === "hr_leads" ? "HR Leads" : "Form Leads"}
            </Badge>
            <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "Active" : "Inactive"}</Badge>
          </DialogTitle>
          <DialogDescription>
            Form details and all submissions created from this form.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Slug</p>
            <code className="text-xs">{form.slug}</code>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Submissions</p>
            <p className="font-medium">{total || form.submission_count || 0}</p>
          </div>
          {form.org_name ? (
            <div>
              <p className="text-xs text-muted-foreground">Organization</p>
              <p>{form.org_name}</p>
            </div>
          ) : null}
          {form.created_at ? (
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p>{formatDate(form.created_at)}</p>
            </div>
          ) : null}
          {form.description ? (
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">Description</p>
              <p>{form.description}</p>
            </div>
          ) : null}
          <div className="sm:col-span-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {meta.collect_email === false ? <Badge variant="outline">Email optional</Badge> : null}
            {meta.external_api_enabled ? <Badge variant="outline">API key enabled</Badge> : null}
            {meta.confirmation_message ? <Badge variant="outline">Custom thank-you message</Badge> : null}
          </div>
          {assignments.length > 0 ? (
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground mb-1">Assigned team</p>
              <p className="text-sm">{assignments.map((a) => a.full_name || a.email).filter(Boolean).join(", ")}</p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {publicLink ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCopyLink?.(publicLink, "Form link")}
            >
              <Copy className="h-3.5 w-3.5 mr-1" />
              Copy link
            </Button>
          ) : null}
          <Button variant="outline" size="sm" asChild>
            <a href={publicLink || `/apply?form=${encodeURIComponent(form.slug)}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Open form
            </a>
          </Button>
          {canEdit && onEdit ? (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Edit form
            </Button>
          ) : null}
          {canManageCampaigns ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setCampaignChannel("email")}>
                <Mail className="h-3.5 w-3.5 mr-1" />
                Email Campaign
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCampaignChannel("whatsapp")}>
                <MessageSquare className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                WhatsApp Campaign
              </Button>
            </>
          ) : null}
          <Button variant="outline" size="sm" asChild>
            <Link to={leadDest === "hr_leads" ? "/leads/hr-leads" : "/leads/form-leads"}>
              Open {leadDest === "hr_leads" ? "HR Leads" : "Form Leads"}
            </Link>
          </Button>
        </div>

        {canManageCampaigns ? (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm font-medium">Auto-send for new submissions</p>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center justify-between gap-3 flex-1">
                <Label htmlFor="auto-email" className="text-sm font-normal">
                  Auto send email campaign
                </Label>
                <Switch
                  id="auto-email"
                  checked={Boolean(campaignCfg.auto_send_email)}
                  disabled={savingCampaign || !campaignCfg.email_template_id}
                  onCheckedChange={(v) => void patchCampaign({ auto_send_email: v })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 flex-1">
                <Label htmlFor="auto-wa" className="text-sm font-normal">
                  Auto send WhatsApp campaign
                </Label>
                <Switch
                  id="auto-wa"
                  checked={Boolean(campaignCfg.auto_send_whatsapp)}
                  disabled={savingCampaign || !campaignCfg.whatsapp_template_id}
                  onCheckedChange={(v) => void patchCampaign({ auto_send_whatsapp: v })}
                />
              </div>
            </div>
            {!campaignCfg.email_template_id && !campaignCfg.whatsapp_template_id ? (
              <p className="text-xs text-muted-foreground">
                Assign templates on publish to enable auto-send toggles.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="border-t pt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-sm">Submissions ({total})</h3>
            {hasExport ? (
              <Button variant="outline" size="sm" disabled={exporting || total === 0} onClick={() => void handleExportCsv()}>
                {exporting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                Export CSV
              </Button>
            ) : null}
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap gap-2">
            <Input
              placeholder="Search name, email, phone…"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
              className="w-full sm:max-w-xs h-9"
            />
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-[160px] h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading submissions…
            </div>
          ) : submissions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No submissions yet for this form.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Name</TableHead>
                    {destination === "hr_leads" ? (
                      <>
                        <TableHead>Phone</TableHead>
                        <TableHead>Email</TableHead>
                      </>
                    ) : (
                      <>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Assigned</TableHead>
                      </>
                    )}
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map((row) => {
                    const rowId = String(row.id);
                    const expanded = expandedId === rowId;
                    return (
                      <Fragment key={rowId}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setExpandedId(expanded ? null : rowId)}
                        >
                          <TableCell>
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="font-medium">{displayName(row)}</TableCell>
                          {destination === "hr_leads" ? (
                            <>
                              <TableCell>{row.phone || "—"}</TableCell>
                              <TableCell>{row.email || "—"}</TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell>{row.email || "—"}</TableCell>
                              <TableCell>{row.phone || "—"}</TableCell>
                              <TableCell className="text-xs">{row.assigned_to_name || "—"}</TableCell>
                            </>
                          )}
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {(row.status || "new").replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{formatDate(row.created_at)}</TableCell>
                        </TableRow>
                        {expanded ? (
                          <TableRow>
                            <TableCell colSpan={destination === "hr_leads" ? 6 : 7} className="bg-muted/20 p-4">
                              <FormSubmissionDetails notes={row.notes} resumePath={row.resume_path} />
                              {row.resume_path ? (
                                <div className="mt-2">
                                  <Button
                                    variant="link"
                                    className="h-auto p-0 text-sm"
                                    type="button"
                                    onClick={() => {
                                      void openProtectedUpload(row.resume_path).catch(() => {});
                                    }}
                                  >
                                      View resume / attachment
                                  </Button>
                                </div>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>

      {form?.id && campaignChannel ? (
        <FormCampaignSendDialog
          open={Boolean(campaignChannel)}
          onOpenChange={(o) => {
            if (!o) setCampaignChannel(null);
          }}
          formId={form.id}
          channel={campaignChannel}
          submissionCount={total || form.submission_count || 0}
        />
      ) : null}
    </Dialog>
  );
}
