import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  Download,
  Eye,
  Link2,
  Loader2,
  Printer,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Power,
  Redo2,
  Save,
  Trash2,
  Undo2,
  Unlink,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DOC_FORM_ASSIGNABLE_ROLES,
  DOC_FORM_FIELD_TYPE_LABELS,
  DOC_FORM_FIELD_TYPES,
  applyPlaceholders,
  defaultDocFormFields,
  docFormFieldIsContent,
  docFormFieldNeedsGrid,
  docFormFieldNeedsOptions,
  docFormKeyFromLabel,
  ensureUniqueDocFormKeys,
  extractPlaceholderKeys,
  isAutoDocFormKey,
  uniqueDocFormKey,
  type DocForm,
  type DocFormAccessRow,
  type DocFormColumnMap,
  type DocFormField,
  type DocFormFieldType,
  type DocFormSubmission,
  type DocFormType,
  type TemplateMailConfig,
} from "@/modules/docForms/types";
import DocFormFieldInput, { docFormFieldDomId } from "@/modules/docForms/DocFormFieldInput";
import {
  DEFAULT_DOC_FORM_BRAND_STATE,
  brandStateFromMeta,
  metaFromBrandState,
  type DocFormBrandState,
} from "@/modules/docForms/docFormBrand";
import { PublicFormShell, builderBrandFromState } from "@/components/forms/PublicFormShell";
import { FormDescriptionEditor } from "@/components/forms/FormDescriptionEditor";
import { descriptionPlainPreview } from "@/components/forms/formDescriptionHtml";
import { normalizeFormColor } from "@/components/forms/publicFormTypes";
import { buildPublicDocFormUrl } from "@/lib/applyFormUrl";
import { ShareFormLinkDialog } from "@/components/forms/ShareFormLinkDialog";
import { DocFormDetailDialog } from "@/components/forms/DocFormDetailDialog";
import { ValidationRuleEditor } from "@/components/forms/ValidationRuleEditor";
import { OFFER_AUTO_PLACEHOLDER_KEYS } from "@/lib/offerLetterPlaceholders";
import { ensureHtmlDocument, splitOfferHtmlPages } from "@/utils/offerLetterPdf";
import { cn } from "@/lib/utils";
import { filterAndSortAssignRoster } from "@/lib/assignRoster";
import { goToChoices, splitIntoSections, type GoToTarget } from "@/components/forms/sectionFlow";
import { isL3AdminRole, normalizeAppRole } from "@/lib/roleUtils";

type TeamMember = {
  id: string;
  full_name: string;
  email?: string;
  role?: string;
  referral_code?: string | null;
  reports_to_id?: string | null;
  reports_to_name?: string | null;
  is_active?: number | boolean;
};

type DocFormRuntimeMeta = {
  confirmationMessage: string;
  closeAt: string;
  responseLimit: string;
  sendReceipt: boolean;
  allowAnotherResponse: boolean;
  showProgressBar: boolean;
  shuffleQuestions: boolean;
};

const DEFAULT_RUNTIME: DocFormRuntimeMeta = {
  confirmationMessage: "Your response has been recorded.",
  closeAt: "",
  responseLimit: "",
  sendReceipt: false,
  allowAnotherResponse: true,
  showProgressBar: false,
  shuffleQuestions: false,
};

function runtimeFromMeta(meta: unknown): DocFormRuntimeMeta {
  const m = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
  return {
    confirmationMessage: String(m.confirmation_message || DEFAULT_RUNTIME.confirmationMessage),
    closeAt: String(m.close_at || ""),
    responseLimit: m.response_limit != null && m.response_limit !== "" ? String(m.response_limit) : "",
    sendReceipt: !!m.send_receipt,
    allowAnotherResponse: m.allow_another_response !== false && m.allow_multiple_responses !== false,
    showProgressBar: !!m.show_progress_bar,
    shuffleQuestions: !!m.shuffle_questions,
  };
}

function metaFromRuntime(r: DocFormRuntimeMeta): Record<string, unknown> {
  return {
    confirmation_message: r.confirmationMessage,
    close_at: r.closeAt || "",
    response_limit: r.responseLimit ? Number(r.responseLimit) : "",
    send_receipt: r.sendReceipt,
    allow_another_response: r.allowAnotherResponse,
    allow_multiple_responses: r.allowAnotherResponse,
    show_progress_bar: r.showProgressBar,
    shuffle_questions: r.shuffleQuestions,
  };
}

function downloadCsv(filename: string, rows: string[][]) {
  const body = rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c ?? "");
          if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        })
        .join(","),
    )
    .join("\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
type OfferTpl = { id: string; template_name: string; role_title?: string; html_content?: string; mail_json?: TemplateMailConfig | string | null };
type CertTpl = { id: string; name: string; fields?: Record<string, string>; style?: Record<string, unknown> & TemplateMailConfig };

function parseMailJson(raw: unknown): TemplateMailConfig {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw);
      return o && typeof o === "object" ? (o as TemplateMailConfig) : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw as TemplateMailConfig;
  return {};
}

function fieldKeyToPlaceholder(key: string): string {
  return key.replace(/^\{\{|\}\}$/g, "").trim();
}

const linesToList = (raw: string) => raw.split("\n").map((s) => s.trim()).filter(Boolean);

/**
 * "One per line" editor. Keeps the raw text while typing so a trailing newline or space is
 * not stripped on every keystroke (which made it impossible to start a second option line).
 * The parsed list is pushed up on each change; the text is tidied on blur.
 */
function LinesTextarea({ value, onChange, className }: { value: string[]; onChange: (lines: string[]) => void; className?: string }) {
  const joined = value.join("\n");
  const [text, setText] = useState(joined);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(joined);
  }, [joined]);
  return (
    <Textarea
      className={className}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setText(linesToList(text).join("\n"));
      }}
      onChange={(e) => {
        setText(e.target.value);
        onChange(linesToList(e.target.value));
      }}
    />
  );
}

export default function DocFormsHubPage({
  embedded = false,
  createSignal = 0,
}: {
  embedded?: boolean;
  createSignal?: number;
} = {}) {
  const { toast } = useToast();
  const { user, profile, role } = useAuth();
  const staffId = String(profile?.referral_code || "").trim();
  const normalizedRole = normalizeAppRole(role);
  const showCreatedByColumn = role === "super_admin" || role === "org" || isL3AdminRole(normalizedRole);
  const [listSearch, setListSearch] = useState("");
  const [shareForm, setShareForm] = useState<DocForm | null>(null);
  const [detailForm, setDetailForm] = useState<DocForm | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<DocForm[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [tab, setTab] = useState<"all" | DocFormType>("all");
  const [editing, setEditing] = useState<DocForm | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState<DocFormType>("offer_letter");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftFields, setDraftFields] = useState<DocFormField[]>([]);
  const [draftBrand, setDraftBrand] = useState<DocFormBrandState>(DEFAULT_DOC_FORM_BRAND_STATE);
  const [builderTab, setBuilderTab] = useState<"questions" | "settings" | "preview">("questions");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [assignForm, setAssignForm] = useState<DocForm | null>(null);
  const [assignUsers, setAssignUsers] = useState<string[]>([]);
  const [assignRoles, setAssignRoles] = useState<string[]>([]);
  const [assignSaving, setAssignSaving] = useState(false);
  const [draftRuntime, setDraftRuntime] = useState<DocFormRuntimeMeta>(DEFAULT_RUNTIME);
  const [fieldHistory, setFieldHistory] = useState<DocFormField[][]>([]);
  const [fieldFuture, setFieldFuture] = useState<DocFormField[][]>([]);
  const autosaveTimer = useRef<number | null>(null);
  const skipAutosave = useRef(true);

  const pushFieldHistory = (prev: DocFormField[]) => {
    setFieldHistory((h) => [...h.slice(-49), prev]);
    setFieldFuture([]);
  };

  const undoFields = () => {
    setFieldHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setDraftFields((cur) => {
        setFieldFuture((f) => [cur, ...f.slice(0, 49)]);
        return prev;
      });
      return h.slice(0, -1);
    });
  };

  const redoFields = () => {
    setFieldFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setDraftFields((cur) => {
        setFieldHistory((h) => [...h.slice(-49), cur]);
        return next;
      });
      return f.slice(1);
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, tRes] = await Promise.all([api.docForms.list(), api.team.list()]);
      setForms((((fRes as any).data || []) as DocForm[]));
      setTeam((((tRes as any).data || (tRes as any) || []) as TeamMember[]));
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to load forms", description: e?.message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = useCallback(() => {
    setCreating(true);
    setEditing(null);
    setDraftName("");
    setDraftType("offer_letter");
    setDraftDesc("");
    setDraftFields(defaultDocFormFields("offer_letter"));
    setDraftBrand(DEFAULT_DOC_FORM_BRAND_STATE);
    setDraftRuntime(DEFAULT_RUNTIME);
    setFieldHistory([]);
    setFieldFuture([]);
    skipAutosave.current = true;
    setBuilderTab("questions");
    setSelectedUsers([]);
    setSelectedRoles([]);
  }, []);

  const prevCreateSignal = useRef(createSignal);
  useEffect(() => {
    if (!embedded) return;
    if (createSignal === prevCreateSignal.current) return;
    prevCreateSignal.current = createSignal;
    if (createSignal > 0) openCreate();
  }, [createSignal, embedded, openCreate]);

  const filtered = useMemo(() => {
    const byType = tab === "all" ? forms : forms.filter((f) => f.form_type === tab);
    const q = listSearch.trim().toLowerCase();
    if (!q) return byType;
    return byType.filter((f) => `${f.name} ${f.slug} ${f.description || ""}`.toLowerCase().includes(q));
  }, [forms, tab, listSearch]);

  const resolveCreatorLabel = (form: DocForm) => {
    const fromApi = String(form.created_by_name || "").trim();
    if (fromApi) return fromApi;
    const uid = String(form.created_by || "").trim();
    if (!uid) return "—";
    const member = team.find((m) => String(m.id) === uid);
    if (member) return member.full_name || member.email || "—";
    return "—";
  };

  const openFormDetail = (form: DocForm) => {
    setDetailForm(form);
    setDetailOpen(true);
  };

  const openEdit = async (form: DocForm) => {
    setDetailOpen(false);
    setDetailForm(null);
    setCreating(false);
    setEditing(form);
    setDraftName(form.name);
    setDraftType(form.form_type);
    setDraftDesc(form.description || "");
    setDraftFields(Array.isArray(form.fields_json) && form.fields_json.length ? form.fields_json : defaultDocFormFields(form.form_type));
    setDraftBrand(brandStateFromMeta(form.meta_json));
    setDraftRuntime(runtimeFromMeta(form.meta_json));
    setFieldHistory([]);
    setFieldFuture([]);
    skipAutosave.current = true;
    setBuilderTab("questions");
    try {
      const res = await api.docForms.get(form.id);
      const full = (res as any).data as DocForm;
      const access = full.access || [];
      setSelectedUsers(access.filter((a) => a.access_type === "user" && a.user_id).map((a) => String(a.user_id)));
      setSelectedRoles(access.filter((a) => a.access_type === "role" && a.role_key).map((a) => String(a.role_key)));
      if (Array.isArray(full.fields_json) && full.fields_json.length) setDraftFields(full.fields_json);
      setDraftBrand(brandStateFromMeta(full.meta_json ?? form.meta_json));
      setDraftRuntime(runtimeFromMeta(full.meta_json ?? form.meta_json));
      if (full.description != null) setDraftDesc(String(full.description));
    } catch {
      /* use list row */
    }
  };

  /** Keys used by more than one question in the draft (shown inline in the builder). */
  const duplicateKeys = useMemo(() => {
    const seen = new Map<string, number>();
    for (const f of draftFields) {
      const k = String(f.key || "").trim();
      if (!k) continue;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    return new Set(Array.from(seen.entries()).filter(([, n]) => n > 1).map(([k]) => k));
  }, [draftFields]);

  const saveForm = async (opts?: { silent?: boolean }) => {
    if (!draftName.trim()) {
      if (!opts?.silent) toast({ variant: "destructive", title: "Name is required" });
      return;
    }
    // Blank keys are named from the label; a key shared by two questions gets a suffix so
    // one answer can never overwrite another on the public form.
    const { fields: fieldsToSave, renamed } = ensureUniqueDocFormKeys(
      draftFields.map((f) => ({ ...f, key: String(f.key || "").trim(), label: String(f.label || "").trim() })),
    );
    if (renamed.length && !opts?.silent) {
      setDraftFields(fieldsToSave);
      toast({
        title: "Placeholder keys adjusted",
        description: renamed
          .map((r) => `${r.label}: ${r.from ? `${r.from} → ` : ""}${r.to}`)
          .join(" · "),
      });
    }
    setSaving(true);
    try {
      let formId = editing?.id;
      const prevMeta = editing?.meta_json && typeof editing.meta_json === "object" ? editing.meta_json : {};
      const meta_json = {
        ...prevMeta,
        ...metaFromBrandState(draftBrand),
        ...metaFromRuntime(draftRuntime),
      };
      if (editing) {
        await api.docForms.update(editing.id, {
          name: draftName.trim(),
          description: draftDesc,
          form_type: draftType,
          fields_json: fieldsToSave,
          meta_json,
          is_active: editing.is_active,
        });
      } else {
        const created = (await api.docForms.create({
          name: draftName.trim(),
          description: draftDesc,
          form_type: draftType,
          fields_json: fieldsToSave,
          meta_json,
          is_active: true,
        })) as { id?: string };
        formId = created.id;
      }
      if (formId) {
        await api.docForms.assign({
          form_id: formId,
          user_ids: selectedUsers,
          role_keys: selectedRoles,
        });
      }
      if (!opts?.silent) toast({ title: editing ? "Form updated" : "Form created" });
      if (!editing) {
        setCreating(false);
        setEditing(null);
      } else if (formId) {
        setEditing((prev) => (prev ? { ...prev, name: draftName.trim(), description: draftDesc, fields_json: fieldsToSave, meta_json } : prev));
      }
      await load();
    } catch (e: any) {
      if (!opts?.silent) toast({ variant: "destructive", title: "Save failed", description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!(creating || editing)) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveForm();
      }
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undoFields();
      }
      if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        redoFields();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!editing || skipAutosave.current) {
      skipAutosave.current = false;
      return;
    }
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      void saveForm({ silent: true });
    }, 1800);
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftName, draftDesc, draftFields, draftBrand, draftRuntime, editing?.id]);

  const removeForm = async (id: string) => {
    if (!confirm("Delete this form and its submissions?")) return;
    try {
      await api.docForms.delete(id);
      toast({ title: "Deleted" });
      await load();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete failed", description: e?.message });
    }
  };

  const shareLinkFor = (form: DocForm) =>
    buildPublicDocFormUrl(window.location.origin, String(form.slug || "").trim(), staffId);

  const copyShareLink = async (form: DocForm) => {
    if (!staffId) {
      toast({
        variant: "destructive",
        title: "Staff ID missing",
        description: "Refresh the page; if it is still blank ask your admin to save the Company Profile.",
      });
      return;
    }
    setShareForm(form);
  };

  const openAssign = (form: DocForm) => {
    setAssignForm(form);
    const access = (form.access || []) as DocFormAccessRow[];
    setAssignUsers(access.filter((a) => a.access_type === "user" && a.user_id).map((a) => String(a.user_id)));
    setAssignRoles(access.filter((a) => a.access_type === "role" && a.role_key).map((a) => String(a.role_key)));
  };

  const saveAssign = async () => {
    if (!assignForm) return;
    setAssignSaving(true);
    try {
      await api.docForms.assign({
        form_id: assignForm.id,
        user_ids: assignUsers,
        role_keys: assignRoles,
      });
      toast({ title: "Assignments saved" });
      setAssignForm(null);
      await load();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Assign failed", description: e?.message });
    } finally {
      setAssignSaving(false);
    }
  };

  const toggleFormActive = async (form: DocForm) => {
    try {
      await api.docForms.update(form.id, { is_active: !form.is_active });
      toast({ title: form.is_active ? "Form set inactive" : "Form set active" });
      await load();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Update failed", description: e?.message });
    }
  };

  const assignedSummary = (form: DocForm) => {
    const access = form.access || [];
    const users = access.filter((a) => a.access_type === "user").length;
    const roles = access.filter((a) => a.access_type === "role").length;
    if (!users && !roles) return "None";
    const parts: string[] = [];
    if (users) parts.push(`${users} user${users === 1 ? "" : "s"}`);
    if (roles) parts.push(`${roles} role${roles === 1 ? "" : "s"}`);
    return parts.join(", ");
  };

  const addField = () => {
    setDraftFields((prev) => {
      pushFieldHistory(prev);
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          key: uniqueDocFormKey(`field_${prev.length + 1}`, prev.map((f) => f.key)),
          label: "New field",
          type: "text",
          required: false,
        },
      ];
    });
  };

  /** Label edit also names the placeholder key while the key is still the auto default. */
  const patchFieldLabel = (idx: number, label: string) => {
    setDraftFields((prev) => {
      const f = prev[idx];
      if (!f) return prev;
      const next = [...prev];
      let key = f.key;
      if (isAutoDocFormKey(f.key)) {
        const derived = docFormKeyFromLabel(label);
        if (derived) {
          key = uniqueDocFormKey(derived, prev.filter((_, i) => i !== idx).map((x) => x.key));
        }
      }
      next[idx] = { ...f, label, key };
      return next;
    });
  };

  const applyFieldType = (field: DocFormField, type: DocFormFieldType): DocFormField => {
    const next: DocFormField = { ...field, type };
    if (docFormFieldNeedsOptions(type) && !(next.options && next.options.length)) {
      next.options = ["Option 1", "Option 2"];
    }
    if (type === "linear_scale") {
      next.scaleMin = next.scaleMin ?? 1;
      next.scaleMax = next.scaleMax ?? 5;
    }
    if (type === "rating") {
      next.ratingMax = next.ratingMax ?? 5;
      next.required = false;
    }
    if (type === "image" || type === "video") {
      next.required = false;
      next.media = next.media || { url: "" };
    }
    if (docFormFieldNeedsGrid(type)) {
      if (!next.rows?.length) next.rows = ["Row 1", "Row 2"];
      if (!next.columns?.length) next.columns = ["Column 1", "Column 2"];
    }
    if (type === "section_break") next.required = false;
    return next;
  };

  if (creating || editing) {
    const brandPreview = builderBrandFromState(draftBrand);
    const patchBrand = (patch: Partial<DocFormBrandState>) =>
      setDraftBrand((p) => ({ ...p, ...patch }));
    const draftSections = splitIntoSections(draftFields, {
      isBreak: (q) => q.type === "section_break",
      id: (q) => q.id,
      title: (q) => q.label,
    });
    const hasSections = draftFields.some((q) => q.type === "section_break");

    const renderFieldInputs = (interactive: boolean) => (
      <section className="sp-form-section">
        {draftFields.map((f) => (
          <div key={f.id} className="sp-form-group">
            {f.type !== "section_break" ? (
              <label className="sp-form-label" htmlFor={docFormFieldDomId(f)}>
                {f.label || "Untitled"}
                {f.required ? <span className="sp-form-required"> *</span> : null}
              </label>
            ) : null}
            <DocFormFieldInput field={f} disabled={!interactive} readOnly={!interactive} />
          </div>
        ))}
        {draftFields.length === 0 ? <p className="sp-form-hint">Add fields in the Questions tab.</p> : null}
      </section>
    );

    return (
      <div className="space-y-4">
        <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-background/95 backdrop-blur border-b flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="sm" onClick={() => { setCreating(false); setEditing(null); }}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button variant="ghost" size="sm" onClick={undoFields} disabled={fieldHistory.length === 0}>
              <Undo2 className="h-3.5 w-3.5 mr-1" /> Undo
            </Button>
            <Button variant="ghost" size="sm" onClick={redoFields} disabled={fieldFuture.length === 0}>
              <Redo2 className="h-3.5 w-3.5 mr-1" /> Redo
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg font-bold truncate">{editing ? "Edit form" : "Create form"}</h1>
              <p className="text-[11px] text-muted-foreground truncate">{draftName || "Untitled document form"}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant={builderTab === "questions" ? "default" : "outline"} size="sm" onClick={() => setBuilderTab("questions")}>
              Questions
            </Button>
            <Button variant={builderTab === "settings" ? "default" : "outline"} size="sm" onClick={() => setBuilderTab("settings")}>
              Settings
            </Button>
            <Button variant={builderTab === "preview" ? "default" : "outline"} size="sm" onClick={() => setBuilderTab("preview")}>
              <Eye className="h-3.5 w-3.5 mr-1" /> Preview
            </Button>
            <Button size="sm" onClick={() => void saveForm()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Save
            </Button>
          </div>
        </div>

        {builderTab === "questions" ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-4 space-y-3">
                  <div>
                    <Label className="text-xs">Form title</Label>
                    <Input
                      className="mt-1 text-base font-semibold"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder="e.g. Offer intake — Engineering"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={draftType}
                      disabled={!!editing}
                      onValueChange={(v) => {
                        const t = v as DocFormType;
                        setDraftType(t);
                        setDraftFields(defaultDocFormFields(t));
                      }}
                    >
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="offer_letter">Offer Letter</SelectItem>
                        <SelectItem value="certificate">Certificate</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Description</Label>
                    <FormDescriptionEditor value={draftDesc} onChange={setDraftDesc} />
                  </div>
                </CardContent>
              </Card>

              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Questions</p>
                  <p className="text-xs text-muted-foreground">
                    Placeholder keys map to templates (e.g. candidate_name → {"{{candidate_name}}"}).
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={addField}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add question
                </Button>
              </div>

              <div className="space-y-3">
                {draftFields.map((f, idx) => (
                  <Card key={f.id}>
                    <CardHeader className="py-3 px-4 flex-row items-start justify-between gap-2 space-y-0">
                      <div className="min-w-0 flex-1 space-y-2">
                        <Input
                          className="font-medium"
                          value={f.label}
                          onChange={(e) => patchFieldLabel(idx, e.target.value)}
                          placeholder="Question"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Select
                            value={f.type}
                            onValueChange={(v) => {
                              const next = [...draftFields];
                              next[idx] = applyFieldType(f, v as DocFormFieldType);
                              setDraftFields(next);
                            }}
                          >
                            <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {DOC_FORM_FIELD_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>{DOC_FORM_FIELD_TYPE_LABELS[t]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <label className="flex items-center gap-1.5 text-xs px-2 border rounded-md h-8">
                            <Checkbox
                              checked={!!f.required}
                              onCheckedChange={(c) => {
                                const next = [...draftFields];
                                next[idx] = { ...f, required: !!c };
                                setDraftFields(next);
                              }}
                            />
                            Required
                          </label>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px]">Placeholder key</Label>
                            <Input
                              className={`h-8 text-xs font-mono ${duplicateKeys.has(f.key.trim()) ? "border-destructive focus-visible:ring-destructive" : ""}`}
                              value={f.key}
                              onChange={(e) => {
                                const next = [...draftFields];
                                next[idx] = { ...f, key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") };
                                setDraftFields(next);
                              }}
                            />
                            {duplicateKeys.has(f.key.trim()) ? (
                              <p className="text-[10px] text-destructive mt-0.5">
                                Another question uses this key. Each question needs its own key or the answers overwrite each other.
                              </p>
                            ) : null}
                          </div>
                          <div>
                            <Label className="text-[10px]">Hint / placeholder</Label>
                            <Input
                              className="h-8 text-xs"
                              value={f.placeholder || ""}
                              onChange={(e) => {
                                const next = [...draftFields];
                                next[idx] = { ...f, placeholder: e.target.value };
                                setDraftFields(next);
                              }}
                            />
                          </div>
                        </div>
                        {docFormFieldNeedsOptions(f.type) ? (
                          <div>
                            <Label className="text-[10px]">Options (one per line)</Label>
                            <LinesTextarea
                              className="mt-1 min-h-[72px] text-xs"
                              value={f.options || []}
                              onChange={(options) => {
                                setDraftFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, options } : x)));
                              }}
                            />
                          </div>
                        ) : null}
                        {f.type === "linear_scale" ? (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[10px]">Scale from</Label>
                              <Input
                                type="number"
                                className="h-8 text-xs"
                                value={f.scaleMin ?? 1}
                                onChange={(e) => {
                                  const next = [...draftFields];
                                  next[idx] = { ...f, scaleMin: Number(e.target.value) };
                                  setDraftFields(next);
                                }}
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Scale to</Label>
                              <Input
                                type="number"
                                className="h-8 text-xs"
                                value={f.scaleMax ?? 5}
                                onChange={(e) => {
                                  const next = [...draftFields];
                                  next[idx] = { ...f, scaleMax: Number(e.target.value) };
                                  setDraftFields(next);
                                }}
                              />
                            </div>
                            <Input
                              className="h-8 text-xs"
                              placeholder="Low label"
                              value={f.scaleMinLabel || ""}
                              onChange={(e) => {
                                const next = [...draftFields];
                                next[idx] = { ...f, scaleMinLabel: e.target.value };
                                setDraftFields(next);
                              }}
                            />
                            <Input
                              className="h-8 text-xs"
                              placeholder="High label"
                              value={f.scaleMaxLabel || ""}
                              onChange={(e) => {
                                const next = [...draftFields];
                                next[idx] = { ...f, scaleMaxLabel: e.target.value };
                                setDraftFields(next);
                              }}
                            />
                          </div>
                        ) : null}
                        {f.type === "rating" ? (
                          <div>
                            <Label className="text-[10px]">Icons (max)</Label>
                            <Input
                              type="number"
                              min={3}
                              max={10}
                              className="h-8 text-xs"
                              value={f.ratingMax ?? 5}
                              onChange={(e) => {
                                const next = [...draftFields];
                                next[idx] = { ...f, ratingMax: Number(e.target.value) || 5 };
                                setDraftFields(next);
                              }}
                            />
                          </div>
                        ) : null}
                        {docFormFieldNeedsGrid(f.type) ? (
                          <div className="grid sm:grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[10px]">Rows (one per line)</Label>
                              <LinesTextarea
                                className="mt-1 min-h-[64px] text-xs"
                                value={f.rows || []}
                                onChange={(rows) => {
                                  setDraftFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, rows } : x)));
                                }}
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Columns (one per line)</Label>
                              <LinesTextarea
                                className="mt-1 min-h-[64px] text-xs"
                                value={f.columns || []}
                                onChange={(columns) => {
                                  setDraftFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, columns } : x)));
                                }}
                              />
                            </div>
                          </div>
                        ) : null}
                        {(f.type === "image" || f.type === "video") ? (
                          <div className="space-y-1">
                            <Label className="text-[10px]">{f.type === "image" ? "Image URL" : "YouTube / Vimeo URL"}</Label>
                            <Input
                              className="h-8 text-xs"
                              value={f.media?.url || ""}
                              onChange={(e) => {
                                const next = [...draftFields];
                                next[idx] = { ...f, media: { ...(f.media || { url: "" }), url: e.target.value } };
                                setDraftFields(next);
                              }}
                            />
                            <Input
                              className="h-8 text-xs"
                              placeholder="Caption (optional)"
                              value={f.media?.caption || ""}
                              onChange={(e) => {
                                const next = [...draftFields];
                                next[idx] = { ...f, media: { ...(f.media || { url: "" }), caption: e.target.value } };
                                setDraftFields(next);
                              }}
                            />
                          </div>
                        ) : null}
                        <div>
                          <Label className="text-[10px]">Question description (links allowed)</Label>
                          <Textarea
                            className="mt-1 min-h-[56px] text-xs"
                            value={f.description || ""}
                            onChange={(e) => {
                              const next = [...draftFields];
                              next[idx] = { ...f, description: e.target.value };
                              setDraftFields(next);
                            }}
                          />
                        </div>
                        {f.type === "text" || f.type === "textarea" || f.type === "email" || f.type === "number" ? (
                          <ValidationRuleEditor
                            value={f.validation}
                            onChange={(validation) => {
                              const next = [...draftFields];
                              next[idx] = { ...f, validation };
                              setDraftFields(next);
                            }}
                          />
                        ) : null}
                        {docFormFieldNeedsOptions(f.type) ? (
                          <label className="flex items-center gap-1.5 text-xs">
                            <Checkbox
                              checked={!!f.shuffleOptions}
                              onCheckedChange={(c) => {
                                const next = [...draftFields];
                                next[idx] = { ...f, shuffleOptions: !!c };
                                setDraftFields(next);
                              }}
                            />
                            Shuffle options
                          </label>
                        ) : null}
                        {(f.type === "multiple_choice" || f.type === "checkboxes") ? (
                          <label className="flex items-center gap-1.5 text-xs">
                            <Checkbox
                              checked={!!f.includeOther}
                              onCheckedChange={(c) => {
                                const next = [...draftFields];
                                next[idx] = { ...f, includeOther: !!c };
                                setDraftFields(next);
                              }}
                            />
                            Add “Other”
                          </label>
                        ) : null}
                        {(f.type === "multiple_choice" || f.type === "select") && hasSections ? (
                          <div className="space-y-1">
                            <Label className="text-[10px]">Go to section based on answer</Label>
                            {(f.options || []).map((opt) => (
                              <div key={opt} className="flex items-center gap-1">
                                <span className="text-[11px] w-24 truncate">{opt || "Option"}</span>
                                <Select
                                  value={f.goTo?.[opt] || "next"}
                                  onValueChange={(v) => {
                                    const next = [...draftFields];
                                    next[idx] = { ...f, goTo: { ...(f.goTo || {}), [opt]: v as GoToTarget } };
                                    setDraftFields(next);
                                  }}
                                >
                                  <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {goToChoices(draftSections, "section-default").map((c) => (
                                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-0.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Move up"
                        disabled={idx === 0}
                        onClick={() =>
                          setDraftFields((p) => {
                            if (idx <= 0) return p;
                            pushFieldHistory(p);
                            const next = [...p];
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            return next;
                          })
                        }
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Move down"
                        disabled={idx === draftFields.length - 1}
                        onClick={() =>
                          setDraftFields((p) => {
                            if (idx >= p.length - 1) return p;
                            pushFieldHistory(p);
                            const next = [...p];
                            [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                            return next;
                          })
                        }
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Duplicate question"
                        onClick={() =>
                          setDraftFields((p) => {
                            const i = p.findIndex((x) => x.id === f.id);
                            if (i < 0) return p;
                            pushFieldHistory(p);
                            const copy = { ...f, id: crypto.randomUUID(), key: uniqueDocFormKey(`${f.key}_copy`, p.map((x) => x.key)) };
                            const next = [...p];
                            next.splice(i + 1, 0, copy);
                            return next;
                          })
                        }
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() =>
                          setDraftFields((p) => {
                            pushFieldHistory(p);
                            return p.filter((x) => x.id !== f.id);
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
                {draftFields.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                      No questions yet. Add one to start building the form.
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </div>

            <Card className="h-fit lg:sticky lg:top-16">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Access</CardTitle>
                <CardDescription className="text-xs">Who can fill this from their dashboard.</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3 max-h-[70vh] overflow-y-auto">
                <div>
                  <Label className="text-xs mb-2 block">Roles</Label>
                  <div className="space-y-2">
                    {DOC_FORM_ASSIGNABLE_ROLES.map((r) => (
                      <label key={r.key} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedRoles.includes(r.key)}
                          onCheckedChange={(c) => {
                            setSelectedRoles((prev) => (c ? [...prev, r.key] : prev.filter((x) => x !== r.key)));
                          }}
                        />
                        {r.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs mb-2 block">Individuals</Label>
                  <div className="space-y-2">
                    {filterAndSortAssignRoster(team).map((m) => (
                      <label key={m.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedUsers.includes(m.id)}
                          onCheckedChange={(c) => {
                            setSelectedUsers((prev) => (c ? [...prev, m.id] : prev.filter((x) => x !== m.id)));
                          }}
                        />
                        <span className="truncate">{m.full_name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {builderTab === "settings" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Branding</CardTitle>
                <CardDescription className="text-xs">Same presentation controls as lead forms.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>Company name</Label>
                  <Input className="mt-1" value={draftBrand.companyName} onChange={(e) => patchBrand({ companyName: e.target.value })} />
                </div>
                  <div>
                    <Label>Company name font size</Label>
                    <Input
                      type="number"
                      min={12}
                      max={48}
                      className="mt-1"
                      value={draftBrand.companyNameFontSize}
                      onChange={(e) => patchBrand({ companyNameFontSize: Number(e.target.value) || 17 })}
                    />
                  </div>
                  <div>
                    <Label>Logo URL</Label>
                    <div className="mt-1 flex gap-2">
                      <Input value={draftBrand.companyLogoUrl} onChange={(e) => patchBrand({ companyLogoUrl: e.target.value })} placeholder="https://…" />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = "image/*";
                          input.onchange = () => {
                            const file = input.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = () => patchBrand({ companyLogoUrl: String(reader.result || "") });
                            reader.readAsDataURL(file);
                          };
                          input.click();
                        }}
                      >
                        Upload
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label>Header image URL</Label>
                    <div className="mt-1 flex gap-2">
                      <Input value={draftBrand.headerImageUrl} onChange={(e) => patchBrand({ headerImageUrl: e.target.value })} placeholder="https://…" />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = "image/*";
                          input.onchange = () => {
                            const file = input.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = () => patchBrand({ headerImageUrl: String(reader.result || "") });
                            reader.readAsDataURL(file);
                          };
                          input.click();
                        }}
                      >
                        Upload
                      </Button>
                    </div>
                  </div>
                {(
                  [
                    ["formBg", "Form background"],
                    ["fieldBg", "Field background"],
                    ["textColor", "Text color"],
                    ["accentColor", "Accent / button"],
                    ["fieldBorderColor", "Field border"],
                    ["sectionBorderColor", "Section border"],
                    ["descriptionColor", "Description color"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <Label>{label}</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input
                        type="color"
                        className="h-10 w-16 p-1"
                        value={normalizeFormColor(draftBrand[key], DEFAULT_DOC_FORM_BRAND_STATE[key])}
                        onChange={(e) => patchBrand({ [key]: e.target.value })}
                      />
                      <Input value={draftBrand[key]} onChange={(e) => patchBrand({ [key]: e.target.value })} />
                    </div>
                  </div>
                ))}
                <div>
                  <Label>Field border size (px)</Label>
                  <Select
                    value={String(draftBrand.fieldBorderWidth)}
                    onValueChange={(v) => patchBrand({ fieldBorderWidth: Number(v) })}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 px</SelectItem>
                      <SelectItem value="2">2 px</SelectItem>
                      <SelectItem value="3">3 px</SelectItem>
                      <SelectItem value="4">4 px</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Section border size (px)</Label>
                  <Select
                    value={String(draftBrand.sectionBorderWidth)}
                    onValueChange={(v) => patchBrand({ sectionBorderWidth: Number(v) })}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 px</SelectItem>
                      <SelectItem value="2">2 px</SelectItem>
                      <SelectItem value="3">3 px</SelectItem>
                      <SelectItem value="4">4 px</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Responses</CardTitle>
                <CardDescription className="text-xs">Same close / thank-you / receipt controls as lead forms.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span>Show progress bar</span>
                  <Checkbox checked={draftRuntime.showProgressBar} onCheckedChange={(c) => setDraftRuntime((p) => ({ ...p, showProgressBar: !!c }))} />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Shuffle question order</span>
                  <Checkbox checked={draftRuntime.shuffleQuestions} onCheckedChange={(c) => setDraftRuntime((p) => ({ ...p, shuffleQuestions: !!c }))} />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Email a copy of responses</span>
                  <Checkbox checked={draftRuntime.sendReceipt} onCheckedChange={(c) => setDraftRuntime((p) => ({ ...p, sendReceipt: !!c }))} />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>Allow another response</span>
                  <Checkbox checked={draftRuntime.allowAnotherResponse} onCheckedChange={(c) => setDraftRuntime((p) => ({ ...p, allowAnotherResponse: !!c }))} />
                </div>
                <div>
                  <Label>Close form on</Label>
                  <Input type="datetime-local" className="mt-1" value={draftRuntime.closeAt} onChange={(e) => setDraftRuntime((p) => ({ ...p, closeAt: e.target.value }))} />
                </div>
                <div>
                  <Label>Response limit</Label>
                  <Input type="number" min={0} className="mt-1" placeholder="Unlimited" value={draftRuntime.responseLimit} onChange={(e) => setDraftRuntime((p) => ({ ...p, responseLimit: e.target.value }))} />
                </div>
                <div>
                  <Label>Confirmation message</Label>
                  <Textarea className="mt-1" value={draftRuntime.confirmationMessage} onChange={(e) => setDraftRuntime((p) => ({ ...p, confirmationMessage: e.target.value }))} />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Live preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg overflow-hidden border">
                  <PublicFormShell
                    preview
                    brand={brandPreview}
                    formTitle={draftName || "Form title"}
                    formDescription={draftDesc || "Fill in your details to submit this form."}
                  >
                    {renderFieldInputs(false)}
                    <button type="button" className="sp-form-submit" disabled>
                      Submit
                    </button>
                  </PublicFormShell>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {builderTab === "preview" ? (
          <div className="rounded-lg overflow-hidden border bg-muted/20 p-2 sm:p-4">
            <PublicFormShell
              preview
              brand={brandPreview}
              formTitle={draftName || "Form title"}
              formDescription={draftDesc || "Fill in your details to submit this form."}
            >
              {renderFieldInputs(false)}
              <button type="button" className="sp-form-submit" disabled>
                Submit
              </button>
            </PublicFormShell>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!embedded ? (
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link to="/form-management" className="hover:underline">Form Management</Link>
            <span>/</span>
            <span>Certificates & Offer Letters</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Certificates & Offer Letters Forms</h1>
          <p className="text-sm text-muted-foreground">
            Assign access and share a public fill link (like Apply). Link templates on Offer Letters / Certificates → Forms.
          </p>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="offer_letter">Offer Letter</TabsTrigger>
          <TabsTrigger value="certificate">Certificate</TabsTrigger>
        </TabsList>

        {!embedded ? (
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Input
              className="h-9 w-full sm:w-56"
              placeholder="Search forms…"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
            />
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Form
            </Button>
          </div>
        ) : null}

        <TabsContent value={tab} className="mt-4 space-y-4">
          {loading ? (
            <div className="h-40 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {tab === "offer_letter" ? "Offer Letter Forms" : tab === "certificate" ? "Certificate Forms" : "Document Forms"}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0 sm:px-6">
                <div className="w-full overflow-x-auto">
                  <Table className="w-full min-w-0 table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className={showCreatedByColumn ? "w-[24%]" : "w-[28%]"}>Name</TableHead>
                        <TableHead className="w-[12%]">Type</TableHead>
                        {showCreatedByColumn ? <TableHead className="w-[12%]">Created by</TableHead> : null}
                        <TableHead className="w-[10%]">Status</TableHead>
                        <TableHead className="w-[8%] text-right">Subs</TableHead>
                        <TableHead className="w-[8%]">Link</TableHead>
                        <TableHead className="w-[10%]">Assign</TableHead>
                        <TableHead className="w-[14%]">Assigned</TableHead>
                        <TableHead className="w-[8%] text-right"> </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={showCreatedByColumn ? 9 : 8} className="text-center py-8 text-sm text-muted-foreground">
                            {tab === "offer_letter"
                              ? "No offer letter forms yet. Create your first form."
                              : tab === "certificate"
                                ? "No certificate forms yet. Create your first form."
                                : "No document forms yet. Create your first form."}
                          </TableCell>
                        </TableRow>
                      ) : (
                        filtered.map((f) => {
                          const isOn = !!f.is_active;
                          return (
                            <TableRow
                              key={f.id}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => openFormDetail(f)}
                            >
                              <TableCell className="align-top">
                                <div className="min-w-0">
                                  <div className="font-medium truncate" title={f.name}>{f.name}</div>
                                  <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
                                    <Badge variant="outline" className="text-[10px] shrink-0">Custom</Badge>
                                    <code className="text-[10px] text-muted-foreground truncate" title={f.slug}>{f.slug}</code>
                                  </div>
                                  {f.description ? (
                                    <div
                                      className="text-xs text-muted-foreground mt-0.5 line-clamp-1"
                                      title={descriptionPlainPreview(f.description)}
                                    >
                                      {descriptionPlainPreview(f.description)}
                                    </div>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell className="align-top">
                                <span className="text-sm truncate block">
                                  {f.form_type === "offer_letter" ? "Offer Letter" : "Certificate"}
                                </span>
                              </TableCell>
                              {showCreatedByColumn ? (
                                <TableCell className="align-top">
                                  <span className="text-sm truncate block" title={resolveCreatorLabel(f)}>
                                    {resolveCreatorLabel(f)}
                                  </span>
                                </TableCell>
                              ) : null}
                              <TableCell className="align-top">
                                <Badge variant={isOn ? "default" : "secondary"}>{isOn ? "Active" : "Inactive"}</Badge>
                              </TableCell>
                              <TableCell className="text-right tabular-nums align-top">
                                {Number(f.submission_count ?? 0)}
                              </TableCell>
                              <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8"
                                  title="Copy public fill link"
                                  onClick={() => void copyShareLink(f)}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                              <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                                <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2" onClick={() => openAssign(f)}>
                                  <Users className="h-3.5 w-3.5" />
                                  <span className="hidden sm:inline">Assign</span>
                                </Button>
                              </TableCell>
                              <TableCell className="align-top text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                                {(() => {
                                  const assignedUsers = (f.access || []).filter((a) => a.access_type === "user" && a.user_id);
                                  if (!assignedUsers.length && !(f.access || []).some((a) => a.access_type === "role")) {
                                    return <span>None</span>;
                                  }
                                  return (
                                    <div className="space-y-1 min-w-0">
                                      {assignedUsers.slice(0, 2).map((a) => {
                                        const fromTeam = team.find((m) => String(m.id) === String(a.user_id));
                                        const memberRef = String(fromTeam?.referral_code || "").trim();
                                        const memberLink = buildPublicDocFormUrl(window.location.origin, f.slug, memberRef || staffId);
                                        return (
                                          <div key={a.id} className="flex items-center gap-1 min-w-0">
                                            <span className="text-xs truncate" title={fromTeam?.full_name || a.user_id || "Member"}>
                                              {fromTeam?.full_name || "Member"}
                                            </span>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6 shrink-0"
                                              title="Copy assigned link"
                                              onClick={() => {
                                                if (!memberRef && !staffId) {
                                                  toast({ variant: "destructive", title: "Staff ID missing" });
                                                  return;
                                                }
                                                void navigator.clipboard.writeText(memberLink).then(
                                                  () => toast({ title: "Assigned link copied" }),
                                                  () => toast({ variant: "destructive", title: "Could not copy" }),
                                                );
                                              }}
                                            >
                                              <Link2 className="h-3.5 w-3.5" />
                                            </Button>
                                          </div>
                                        );
                                      })}
                                      {assignedUsers.length > 2 ? (
                                        <div className="text-[11px] text-muted-foreground">+{assignedUsers.length - 2} more</div>
                                      ) : null}
                                      {(f.access || []).filter((a) => a.access_type === "role").length ? (
                                        <div className="text-[10px]">{assignedSummary(f)}</div>
                                      ) : null}
                                      {f.template_link ? (
                                        <div className="text-[10px] text-emerald-700">Template linked</div>
                                      ) : (
                                        <div className="text-[10px]">No template</div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </TableCell>
                              <TableCell className="align-top text-right" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Actions">
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-44">
                                    <DropdownMenuItem onClick={() => void openEdit(f)}>
                                      <Pencil className="h-3.5 w-3.5 mr-2" />
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => void copyShareLink(f)}>
                                      <Copy className="h-3.5 w-3.5 mr-2" />
                                      Share link
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        try {
                                          await api.docForms.duplicate(f.id);
                                          toast({ title: "Form duplicated" });
                                          await load();
                                        } catch (e: any) {
                                          toast({ variant: "destructive", title: "Duplicate failed", description: e?.message });
                                        }
                                      }}
                                    >
                                      <Copy className="h-3.5 w-3.5 mr-2" />
                                      Duplicate
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => openAssign(f)}>
                                      <Users className="h-3.5 w-3.5 mr-2" />
                                      Assign
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => void toggleFormActive(f)}>
                                      <Power className="h-3.5 w-3.5 mr-2" />
                                      {isOn ? "Set Inactive" : "Set Active"}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={() => void removeForm(f.id)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!assignForm} onOpenChange={(o) => !o && setAssignForm(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign form</DialogTitle>
            <DialogDescription>
              Assigned people/roles see this on their dashboard. Anyone with the public link can also fill it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs mb-2 block">Roles</Label>
              <div className="space-y-2">
                {DOC_FORM_ASSIGNABLE_ROLES.map((r) => (
                  <label key={r.key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={assignRoles.includes(r.key)}
                      onCheckedChange={(c) => {
                        setAssignRoles((prev) => (c ? [...prev, r.key] : prev.filter((x) => x !== r.key)));
                      }}
                    />
                    {r.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Individuals (org downline / roster)</Label>
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {filterAndSortAssignRoster(team).map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={assignUsers.includes(m.id)}
                      onCheckedChange={(c) => {
                        setAssignUsers((prev) => (c ? [...prev, m.id] : prev.filter((x) => x !== m.id)));
                      }}
                    />
                    <span className="truncate">{m.full_name}</span>
                    <span className="text-[10px] text-muted-foreground truncate">
                      {m.role}
                      {m.reports_to_name ? ` · ${m.reports_to_name}` : ""}
                    </span>
                  </label>
                ))}
                {team.length === 0 ? <p className="text-xs text-muted-foreground">No team members loaded.</p> : null}
              </div>
            </div>
            {assignForm ? (
              <p className="text-[11px] text-muted-foreground break-all">
                Public link: <code className="rounded bg-muted px-1">{shareLinkFor(assignForm)}</code>
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignForm(null)}>Cancel</Button>
            <Button onClick={() => void saveAssign()} disabled={assignSaving}>
              {assignSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Save assignments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!embedded ? (
        <p className="text-[11px] text-muted-foreground">Signed in as {user?.full_name || user?.email || "admin"}</p>
      ) : null}

      <ShareFormLinkDialog
        open={!!shareForm}
        onOpenChange={(o) => !o && setShareForm(null)}
        url={shareForm ? shareLinkFor(shareForm) : ""}
        title={shareForm?.name || "Form"}
        hint="This link includes your staff ID so submissions are attributed to you."
        prefillFields={(shareForm?.fields_json || [])
          .filter((q) => q.type !== "section_break" && q.type !== "image" && q.type !== "video")
          .map((q) => ({ key: q.key, label: q.label }))}
      />

      <DocFormDetailDialog
        open={detailOpen}
        onOpenChange={(o) => {
          setDetailOpen(o);
          if (!o) setDetailForm(null);
        }}
        form={detailForm}
        publicLink={detailForm ? shareLinkFor(detailForm) : ""}
        canEdit={!!detailForm}
        createdByLabel={detailForm && showCreatedByColumn ? resolveCreatorLabel(detailForm) : undefined}
        onEdit={detailForm ? () => void openEdit(detailForm) : undefined}
        onOpenSubmissions={
          detailForm
            ? () => {
                toast({
                  title: "Open submissions workspace",
                  description:
                    detailForm.form_type === "certificate"
                      ? "Use Certificates → Forms to map columns and issue certificates."
                      : "Use Offer Letters → Forms to map columns and issue letters.",
                });
              }
            : undefined
        }
        onCopyLink={(url, label) => {
          void navigator.clipboard.writeText(url).then(
            () => toast({ title: `${label} copied` }),
            () => toast({ variant: "destructive", title: "Copy failed" }),
          );
        }}
      />
    </div>
  );
}

const A4_W_PX = Math.round((210 * 96) / 25.4);
const A4_H_PX = Math.round((297 * 96) / 25.4);

/** Isolated, scale-to-fit A4 preview so template CSS cannot overlap the dialog chrome. */
function OfferLetterA4Preview({ html }: { html: string }) {
  const pages = useMemo(
    () => splitOfferHtmlPages(html).map((page) => ensureHtmlDocument(page)),
    [html],
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      setScale(Math.min(1, w / A4_W_PX));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const t = window.setTimeout(update, 80);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [html, pages.length]);

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md bg-muted/40 p-3">
      <div ref={wrapRef} className="mx-auto w-full">
        <div className="flex flex-col items-center gap-6">
        {pages.map((pageHtml, idx) => (
          <div key={idx} className="relative shrink-0">
            {pages.length > 1 ? (
              <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                Page {idx + 1} of {pages.length}
              </div>
            ) : null}
            <div
              className="overflow-hidden bg-white shadow-lg"
              style={{ width: A4_W_PX * scale, height: A4_H_PX * scale }}
            >
              <iframe
                srcDoc={pageHtml}
                title={`Offer letter preview page ${idx + 1}`}
                sandbox="allow-same-origin"
                className="border-0 bg-white"
                style={{
                  width: A4_W_PX,
                  height: A4_H_PX,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                }}
              />
            </div>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}

/** Forms tab panel used inside Offer Letters / Certificates pages. */
export function DocFormsWorkspace({ formType }: { formType: DocFormType }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<DocForm[]>([]);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; raw?: any }>>([]);
  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<DocFormSubmission[]>([]);
  const [columnMaps, setColumnMaps] = useState<DocFormColumnMap[]>([]);
  const [placeholders, setPlaceholders] = useState<string[]>([]);
  const [linking, setLinking] = useState<string | null>(null);
  const [playRow, setPlayRow] = useState<DocFormSubmission | null>(null);
  const [playValues, setPlayValues] = useState<Record<string, string>>({});
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<DocFormSubmission | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fRes = await api.docForms.list(formType);
      setForms((((fRes as any).data || []) as DocForm[]));
      if (formType === "offer_letter") {
        const tRes = await api.offerLetters.templates();
        const list = (((tRes as any).data || []) as OfferTpl[]).map((t) => ({
          id: t.id,
          name: t.template_name,
          raw: t,
        }));
        setTemplates(list);
      } else {
        const tRes = await api.certificates.listTemplates();
        const list = (((tRes as any).data || (tRes as any).templates || []) as CertTpl[]).map((t) => ({
          id: t.id,
          name: t.name,
          raw: t,
        }));
        setTemplates(list);
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to load forms", description: e?.message });
    } finally {
      setLoading(false);
    }
  }, [formType, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openSubmissions = async (form: DocForm) => {
    setActiveFormId(form.id);
    setBusy(true);
    try {
      const res = await api.docForms.submissions(form.id);
      const rows = (((res as any).data || []) as DocFormSubmission[]);
      setSubmissions(rows);
      const link = (res as any).template_link || form.template_link;
      const maps: DocFormColumnMap[] = Array.isArray(link?.column_maps_json) ? link.column_maps_json : [];
      setColumnMaps(maps.length ? maps : []);

      // Build placeholder list from linked template
      const tplId = link?.template_id || form.template_link?.template_id;
      const tpl = templates.find((t) => t.id === tplId)?.raw;
      let keys: string[] = [];
      if (formType === "offer_letter" && tpl) {
        const mail = parseMailJson(tpl.mail_json);
        keys = extractPlaceholderKeys(
          String(tpl.html_content || ""),
          mail.mail_subject || "",
          mail.mail_body || "",
          mail.pdf_filename_pattern || "",
        );
        const emailKey = String(mail.recipient_email_placeholder || "recipient_email")
          .replace(/^\{\{\s*|\s*\}\}$/g, "")
          .trim();
        if (emailKey && !keys.includes(emailKey)) keys.push(emailKey);
        keys = keys.filter((k) => !["date", "ref_number", "letterhead_url"].includes(k));
      } else if (formType === "certificate" && tpl) {
        const style = (tpl.style || {}) as TemplateMailConfig & Record<string, unknown>;
        const fields = tpl.fields || {};
        const layers = Array.isArray(tpl.layers) ? tpl.layers : [];
        const layerText = layers.map((l: any) => String(l.content || "")).join(" ");
        keys = extractPlaceholderKeys(
          layerText,
          String(fields.title || ""),
          String(style.mail_subject || ""),
          String(style.mail_body || ""),
          String(style.pdf_filename_pattern || ""),
        );
        // Only typed layers that actually exist on this template
        const layerTypeToKey: Record<string, string> = {
          name: "name",
          domain: "domain",
          date: "date",
          company: "company",
        };
        for (const layer of layers) {
          const mapped = layerTypeToKey[String(layer?.type || "")];
          if (mapped && !keys.includes(mapped)) keys.push(mapped);
        }
        // Email for sending when issuing from forms
        if (!keys.includes("email") && !keys.includes("recipient_email")) keys.push("email");
      }
      if (!keys.length) {
        keys = (form.fields_json || []).map((f) => fieldKeyToPlaceholder(f.key));
      }
      setPlaceholders(keys);
      // Always sync table columns to the linked template's placeholders only
      const synced: DocFormColumnMap[] = keys.map((k) => {
        const existing = maps.find((m) => m.placeholder_key === k);
        return (
          existing || {
            id: crypto.randomUUID(),
            label: k.replace(/_/g, " "),
            placeholder_key: k,
            editable: true,
          }
        );
      });
      setColumnMaps(synced);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not load submissions", description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const linkTemplate = async (formId: string, templateId: string) => {
    setLinking(formId);
    try {
      await api.docForms.linkTemplate({
        form_id: formId,
        template_id: templateId,
        template_kind: formType,
        column_maps: [],
      });
      toast({ title: "Template linked" });
      await load();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Link failed", description: e?.message });
    } finally {
      setLinking(null);
    }
  };

  const unlinkTemplate = async (form: DocForm) => {
    const tplName = templates.find((t) => t.id === form.template_link?.template_id)?.name || "the template";
    if (!window.confirm(`Unlink ${tplName} from "${form.name}"?\n\nSubmissions are kept. You can link a different template afterwards.`)) return;
    setLinking(form.id);
    try {
      await api.docForms.unlinkTemplate(form.id);
      toast({ title: "Template unlinked", description: `${form.name} has no template now.` });
      if (activeFormId === form.id) {
        setActiveFormId(null);
        setSubmissions([]);
        setColumnMaps([]);
        setPlaceholders([]);
      }
      await load();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Unlink failed", description: e?.message });
    } finally {
      setLinking(null);
    }
  };

  const saveMaps = async () => {
    if (!activeFormId) return;
    try {
      await api.docForms.saveColumnMaps(activeFormId, columnMaps);
      toast({ title: "Column mappings saved" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e?.message });
    }
  };

  const addEmptyRow = async () => {
    if (!activeFormId) return;
    setBusy(true);
    try {
      const emptyValues: Record<string, string> = {};
      for (const col of columnMaps) {
        const key = String(col.placeholder_key || "").trim();
        if (key) emptyValues[key] = "";
      }
      const res = await api.docForms.addManualRow({
        form_id: activeFormId,
        values: emptyValues,
      });
      const row = ((res as any)?.data || null) as DocFormSubmission | null;
      if (row?.id) {
        setSubmissions((prev) => [row, ...prev]);
      } else {
        const form = forms.find((f) => f.id === activeFormId);
        if (form) await openSubmissions(form);
      }
      toast({ title: "Empty row added", description: "Fill the cells, then Play to issue." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not add row", description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const patchCell = async (row: DocFormSubmission, key: string, value: string) => {
    const next = { ...(row.values_json || {}), [key]: value };
    setSubmissions((prev) => prev.map((r) => (r.id === row.id ? { ...r, values_json: next } : r)));
    try {
      await api.docForms.updateSubmissionValues({ submission_id: row.id, values: next });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Update failed", description: e?.message });
    }
  };

  const openPlay = (row: DocFormSubmission) => {
    setPlayRow(row);
    setPlayValues({ ...(row.values_json || {}) });
  };

  const confirmIssue = async () => {
    if (!playRow || !activeFormId) return;
    const form = forms.find((f) => f.id === activeFormId);
    const link = form?.template_link;
    const tplId = link?.template_id;
    const tpl = templates.find((t) => t.id === tplId)?.raw;
    if (!tplId || !tpl) {
      toast({ variant: "destructive", title: "Link a template first" });
      return;
    }

    const filled: Record<string, string> = { ...playValues };
    if (formType === "offer_letter") {
      if (!String(filled.date || "").trim()) {
        filled.date = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
      }
      if (!String(filled.ref_number || "").trim()) {
        filled.ref_number = `OL-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
      }
      if (!String(filled.letterhead_url || "").trim()) {
        const htmlSrc = String(tpl.html_content || "");
        const m = htmlSrc.match(/class="letterhead-bg"[^>]*src="([^"]+)"/) || htmlSrc.match(/src="(https?:[^"]+)"/);
        if (m?.[1] && !m[1].includes("letterhead_url")) filled.letterhead_url = m[1];
      }
    }
    const requiredKeys = placeholders.filter((k) => !OFFER_AUTO_PLACEHOLDER_KEYS.has(k));
    const missing = requiredKeys.filter((k) => !String(filled[k] ?? "").trim());
    if (missing.length) {
      toast({ variant: "destructive", title: "Missing required fields", description: missing.join(", ") });
      return;
    }

    setBusy(true);
    try {
      // Persist latest values
      await api.docForms.updateSubmissionValues({
        submission_id: playRow.id,
        values: filled,
        respondent_name: filled.candidate_name || filled.name || playRow.respondent_name || undefined,
        respondent_email: filled.recipient_email || filled.email || playRow.respondent_email || undefined,
      });

      let issuedPdfUrl = "";
      if (formType === "offer_letter") {
        const mail = parseMailJson(tpl.mail_json);
        const html = applyPlaceholders(String(tpl.html_content || ""), filled);
        const subject = applyPlaceholders(mail.mail_subject || "Offer Letter", filled);
        const body = applyPlaceholders(mail.mail_body || "<p>Please find your offer letter attached.</p>", filled);
        const emailKey = fieldKeyToPlaceholder(mail.recipient_email_placeholder || "recipient_email");
        const email = String(filled[emailKey] || filled.recipient_email || filled.email || "").trim();
        const name = String(filled.candidate_name || filled.name || "Candidate");
        const filename = applyPlaceholders(mail.pdf_filename_pattern || "{{candidate_name}}_OfferLetter.pdf", filled);
        if (!email) throw new Error("Recipient email is empty");
        const pdfBase64 = await (await import("@/utils/offerLetterPdf")).buildHtmlDocumentPdfBase64(html);
        await api.offerLetters.send({
          template_id: tplId,
          recipient_name: name,
          recipient_email: email,
          role_title: filled.role_title || tpl.role_title || "",
          html_content: html,
          email_subject: subject,
          email_html: body,
          attachment_name: filename,
          pdf_base64: pdfBase64,
        });
      } else {
        const email = String(filled.email || filled.recipient_email || "").trim();
        const name = String(filled.name || filled.candidate_name || "Recipient");
        if (!email) throw new Error("Recipient email is empty");
        const { captureCertificatePdfBase64 } = await import("@/pages/CertificatesPage");
        const pdfBase64 = await captureCertificatePdfBase64({
          template: tpl,
          recipientName: name,
          domainName: filled.domain || filled.course || "",
          companyName: filled.company,
          date: filled.date || new Date().toISOString().slice(0, 10),
          certID: filled.certID || filled.cert_id || filled.certificate_id,
          placeholderValues: filled,
        });
        const issued = await api.certificates.issue({
          recipientId: `docform-${playRow.id}`,
          templateId: tplId,
          syncId: filled.certID || filled.cert_id || `CF-${Date.now()}`,
          recipientName: name,
          recipientEmail: email,
          courseName: filled.domain || "",
          issueDate: filled.date || new Date().toISOString().slice(0, 10),
          pdf_base64: pdfBase64,
        });
        issuedPdfUrl = String((issued as any)?.pdfUrl || "").trim();
        const mail = parseMailJson(tpl.mail_json || tpl.style);
        const subject = applyPlaceholders(mail.mail_subject || "Certificate", filled);
        const body = applyPlaceholders(mail.mail_body || "<p>Please find your certificate attached.</p>", { ...filled, recipient_name: name });
        if (issuedPdfUrl) {
          await api.certificates.sendEmail({
            certificateId: String((issued as any)?.certificateId || (issued as any)?.syncId || ""),
            to: email,
            subject,
            body,
            attachmentUrl: issuedPdfUrl,
            attachmentName: `Certificate_${name.replace(/\s+/g, "_")}.pdf`,
          });
        }
      }

      await api.docForms.issue({
        submission_id: playRow.id,
        values: filled,
        recipient_email: filled.recipient_email || filled.email,
        recipient_name: filled.candidate_name || filled.name,
        pdf_url: issuedPdfUrl || undefined,
        email_subject: formType === "offer_letter" ? applyPlaceholders(parseMailJson(tpl.mail_json).mail_subject || "Offer Letter", filled) : "Certificate",
      });

      toast({ title: "Issued", description: formType === "certificate" ? "Certificate generated and emailed." : "Offer letter generated and emailed." });
      setPlayRow(null);
      if (form) await openSubmissions(form);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Issue failed", description: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  };

  const openPreview = (row: DocFormSubmission) => {
    const form = forms.find((f) => f.id === activeFormId);
    const tplId = form?.template_link?.template_id;
    const tpl = templates.find((t) => t.id === tplId)?.raw;
    if (!tpl) {
      toast({ variant: "destructive", title: "No linked template" });
      return;
    }
    const values = row.values_json || {};
    if (formType === "offer_letter") {
      setPreviewHtml(applyPlaceholders(String(tpl.html_content || ""), values));
    } else {
      setPreviewHtml(
        `<div style="padding:24px;font-family:Georgia,serif">
          <h2>Certificate preview</h2>
          <p><strong>Name:</strong> ${values.name || values.candidate_name || ""}</p>
          <p><strong>Domain:</strong> ${values.domain || ""}</p>
          <p><strong>Date:</strong> ${values.date || ""}</p>
          <p class="muted">Full canvas preview is available from the Certificates template editor.</p>
        </div>`,
      );
    }
  };

  if (activeFormId) {
    const form = forms.find((f) => f.id === activeFormId);
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setActiveFormId(null)}><ArrowLeft className="h-4 w-4 mr-1" />Forms</Button>
            <div>
              <h2 className="text-sm font-semibold">{form?.name || "Submissions"}</h2>
              <p className="text-[10px] text-muted-foreground">Columns follow template placeholders. Map each column, then Play to issue.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void addEmptyRow()} disabled={busy}>
              <Plus className="h-3 w-3 mr-1" />Add row
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={submissions.length === 0}
              onClick={() => {
                const headers = ["Person", "Email", "Staff ID", "Status", ...columnMaps.map((c) => c.label || c.placeholder_key)];
                const rows = submissions.map((row) => [
                  row.respondent_name || row.values_json?.candidate_name || row.values_json?.name || "",
                  row.respondent_email || row.values_json?.email || "",
                  row.referred_by || "",
                  row.status || "",
                  ...columnMaps.map((c) => row.values_json?.[c.placeholder_key] ?? ""),
                ]);
                downloadCsv(`${(form?.slug || form?.name || "submissions").replace(/[^\w.-]+/g, "_")}.csv`, [headers, ...rows]);
              }}
            >
              <Download className="h-3 w-3 mr-1" />CSV
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => {
              setColumnMaps((prev) => [...prev, { id: crypto.randomUUID(), label: "New column", placeholder_key: placeholders[0] || "", editable: true }]);
            }}>
              <Plus className="h-3 w-3 mr-1" />Add Column
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={() => void saveMaps()}><Save className="h-3 w-3 mr-1" />Save mappings</Button>
          </div>
        </div>

        {busy ? <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : null}

        <div className="overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Person</TableHead>
                {columnMaps.map((col) => (
                  <TableHead key={col.id} className="min-w-[140px]">
                    <div className="space-y-1">
                      <Input
                        className="h-7 text-xs"
                        value={col.label}
                        onChange={(e) => setColumnMaps((prev) => prev.map((c) => (c.id === col.id ? { ...c, label: e.target.value } : c)))}
                      />
                      <Select
                        value={col.placeholder_key || undefined}
                        onValueChange={(v) => setColumnMaps((prev) => prev.map((c) => (c.id === col.id ? { ...c, placeholder_key: v } : c)))}
                      >
                        <SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Placeholder…" /></SelectTrigger>
                        <SelectContent>
                          {placeholders.map((p) => (
                            <SelectItem key={p} value={p} className="text-xs">{"{{"}{p}{"}}"}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TableHead>
                ))}
                <TableHead className="w-[150px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnMaps.length + 2} className="text-center text-sm text-muted-foreground py-8">
                    No rows yet. Use <strong>Add row</strong> to enter details manually, or wait for submissions from assigned dashboards.
                  </TableCell>
                </TableRow>
              ) : (
                submissions.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs">
                      <div className="font-medium">{row.respondent_name || row.values_json?.candidate_name || row.values_json?.name || "—"}</div>
                      <div className="text-muted-foreground">{row.respondent_email || row.values_json?.email || ""}</div>
                      {row.referred_by ? <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{row.referred_by}</div> : null}
                      <Badge variant="secondary" className="text-[9px] mt-1">{row.status}</Badge>
                    </TableCell>
                    {columnMaps.map((col) => (
                      <TableCell key={col.id}>
                        <Input
                          className="h-8 text-xs bg-white"
                          value={row.values_json?.[col.placeholder_key] ?? ""}
                          onChange={(e) => void patchCell(row, col.placeholder_key, e.target.value)}
                        />
                      </TableCell>
                    ))}
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="outline" className="h-7 w-7" title="Play / Issue" onClick={() => openPlay(row)}>
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="outline" className="h-7 w-7" title="Preview" onClick={() => openPreview(row)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="outline" className="h-7 w-7" title="Edit" onClick={() => { setEditRow(row); setPlayValues({ ...(row.values_json || {}) }); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 text-destructive"
                          title="Delete row"
                          onClick={async () => {
                            if (!confirm("Delete this submission?")) return;
                            try {
                              await api.docForms.deleteSubmission(row.id);
                              setSubmissions((prev) => prev.filter((r) => r.id !== row.id));
                              toast({ title: "Row deleted" });
                            } catch (e: any) {
                              toast({ variant: "destructive", title: "Delete failed", description: e?.message });
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <Dialog open={!!playRow} onOpenChange={(o) => !o && setPlayRow(null)}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Review & issue</DialogTitle>
              <DialogDescription>Confirm placeholder values, then OK to generate PDF and email.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {placeholders.filter(Boolean).map((key) => (
                <div key={key}>
                  <Label className="text-xs">{key}</Label>
                  <Input className="h-8 text-xs" value={playValues[key] ?? ""} onChange={(e) => setPlayValues((p) => ({ ...p, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPlayRow(null)}>Cancel</Button>
              <Button onClick={() => void confirmIssue()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                OK — Issue
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit submission</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              {placeholders.filter(Boolean).map((key) => (
                <div key={key}>
                  <Label className="text-xs">{key}</Label>
                  <Input className="h-8 text-xs" value={playValues[key] ?? ""} onChange={(e) => setPlayValues((p) => ({ ...p, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
              <Button
                onClick={async () => {
                  if (!editRow) return;
                  await api.docForms.updateSubmissionValues({ submission_id: editRow.id, values: playValues });
                  setSubmissions((prev) => prev.map((r) => (r.id === editRow.id ? { ...r, values_json: playValues } : r)));
                  setEditRow(null);
                  toast({ title: "Saved" });
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={previewHtml != null} onOpenChange={(o) => !o && setPreviewHtml(null)}>
          <DialogContent
            className={cn(
              "flex w-[min(56rem,calc(100%-1.5rem))] max-w-4xl flex-col gap-3 overflow-hidden p-4 sm:p-6",
              "h-[min(92dvh,calc(100dvh-1.5rem))] max-h-[min(92dvh,calc(100dvh-1.5rem))]",
            )}
          >
            <DialogHeader className="shrink-0 space-y-1 pr-10">
              <DialogTitle>Preview</DialogTitle>
              <DialogDescription>Not issued — review only.</DialogDescription>
            </DialogHeader>
            {formType === "offer_letter" ? (
              <OfferLetterA4Preview html={previewHtml || ""} />
            ) : (
              <div
                className="min-h-0 flex-1 overflow-auto rounded-md border bg-white p-4"
                dangerouslySetInnerHTML={{ __html: previewHtml || "" }}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{formType === "offer_letter" ? "Offer letter forms" : "Certificate forms"}</h2>
          <p className="text-[11px] text-muted-foreground">
            Created under Form Management → Certificates & Offer Letters Forms. Link a template, then open submissions.
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="h-8 text-xs">
          <Link to="/form-management?tab=doc">Manage forms</Link>
        </Button>
      </div>
      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : forms.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No {formType === "offer_letter" ? "offer" : "certificate"} forms yet.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {forms.map((f) => (
            <Card key={f.id}>
              <CardContent className="py-3 px-4 flex flex-wrap items-center gap-3 justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{f.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {f.submission_count ?? 0} submissions
                    {f.template_link?.template_id ? (
                      <>
                        {" · "}
                        Linked: {templates.find((t) => t.id === f.template_link?.template_id)?.name || "template no longer exists"}
                      </>
                    ) : (
                      " · No template linked"
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={f.template_link?.template_id || undefined}
                    onValueChange={(v) => void linkTemplate(f.id, v)}
                    disabled={linking === f.id}
                  >
                    <SelectTrigger className="h-8 w-[200px] text-xs">
                      <SelectValue placeholder="Link template…" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {f.template_link?.template_id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={linking === f.id}
                      title="Remove the template link (submissions are kept)"
                      onClick={() => void unlinkTemplate(f)}
                    >
                      {linking === f.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Unlink className="h-3.5 w-3.5 mr-1" />}
                      Unlink
                    </Button>
                  ) : null}
                  <Button size="sm" className="h-8 text-xs" disabled={!f.template_link?.template_id} onClick={() => void openSubmissions(f)}>
                    Open submissions
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function issuedPdfIdsFromRow(
  row: import("@/modules/docForms/types").DocIssuedDocument,
): { certificateId: string; offerLetterId: string } {
  const raw = String(row.pdf_url || "").trim();
  let certificateId = "";
  let offerLetterId = "";
  try {
    const u = new URL(raw, typeof window !== "undefined" ? window.location.origin : "https://local.invalid");
    const path = u.pathname.toLowerCase();
    if (path.includes("certificates.php")) {
      certificateId = (u.searchParams.get("certificate_id") || "").trim();
    }
    if (path.includes("offer-letters.php")) {
      offerLetterId = (u.searchParams.get("id") || "").trim();
    }
  } catch {
    const cert = raw.match(/[?&]certificate_id=([^&#]+)/i);
    if (cert) certificateId = decodeURIComponent(cert[1]).trim();
    const offer = raw.match(/offer-letters\.php\?[^#]*[?&]id=([^&#]+)/i);
    if (offer) offerLetterId = decodeURIComponent(offer[1]).trim();
  }
  let meta: Record<string, unknown> = {};
  const rawMeta = row.meta_json as unknown;
  if (rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)) {
    meta = rawMeta as Record<string, unknown>;
  } else if (typeof rawMeta === "string" && rawMeta.trim()) {
    try {
      const parsed = JSON.parse(rawMeta) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
  }
  if (!certificateId) {
    const fromMeta = String(meta.cert_id || meta.certificate_id || meta.sync_id || "").trim();
    if (fromMeta) certificateId = fromMeta;
  }
  if (!certificateId && /^[A-Z]{2}-[A-Z]{2}-[A-Z0-9-]+$/i.test(raw)) {
    certificateId = raw;
  }
  if (!offerLetterId) {
    const fromMeta = String(meta.offer_letter_id || meta.sent_id || "").trim();
    if (fromMeta) offerLetterId = fromMeta;
  }
  return { certificateId, offerLetterId };
}

function IssuedDocPdfViewer({ row }: { row: import("@/modules/docForms/types").DocIssuedDocument }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError("");
    setUrl("");
    void (async () => {
      try {
        const ids = issuedPdfIdsFromRow(row);
        let blob: Blob;
        if (ids.certificateId) {
          blob = await api.certificates.pdf(ids.certificateId);
        } else if (ids.offerLetterId) {
          blob = await api.offerLetters.fetchSentPdfBlob(ids.offerLetterId);
        } else {
          throw new Error("No stored PDF is linked to this document.");
        }
        if (cancelled) return;
        const next = URL.createObjectURL(blob);
        revoked = next;
        setUrl(next);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load PDF");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [row]);

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading PDF…
      </div>
    );
  }
  if (error || !url) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        {error || "PDF not available."}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/20">
      <iframe
        title="Issued document PDF"
        src={url}
        className="h-[min(70vh,820px)] w-full bg-white"
      />
    </div>
  );
}

export function DocIssuedPanel({ docKind, canDelete = false }: { docKind: DocFormType; canDelete?: boolean }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<import("@/modules/docForms/types").DocIssuedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");
  const [preview, setPreview] = useState<import("@/modules/docForms/types").DocIssuedDocument | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await api.docForms.issued(docKind);
        if (!alive) return;
        setRows((((res as any).data || []) as any[]));
      } catch (e: any) {
        toast({ variant: "destructive", title: "Could not load issued docs", description: e?.message });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [docKind, toast]);

  async function deleteIssued(row: import("@/modules/docForms/types").DocIssuedDocument) {
    if (!canDelete) return;
    const label = row.recipient_name || row.recipient_email || "this document";
    if (!window.confirm(`Delete the issued document for ${label}? This also removes the PDF from storage.`)) {
      return;
    }
    setDeletingId(row.id);
    try {
      await api.docForms.deleteIssued(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast({ title: "Issued document deleted" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not delete", description: e?.message || "Try again." });
    } finally {
      setDeletingId("");
    }
  }

  if (loading) return <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!rows.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No documents issued from forms yet. Use Forms → submissions → Play.
        </CardContent>
      </Card>
    );
  }

  const previewIds = preview ? issuedPdfIdsFromRow(preview) : { certificateId: "", offerLetterId: "" };

  return (
    <>
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Recipient</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Actions</TableHead>
            {canDelete ? <TableHead className="w-12" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-sm">{r.recipient_name || "—"}</TableCell>
              <TableCell className="text-xs">{r.recipient_email || "—"}</TableCell>
              <TableCell className="text-xs">{r.subject || "—"}</TableCell>
              <TableCell><Badge variant="secondary" className="text-[10px]">{r.status}</Badge></TableCell>
              <TableCell className="text-xs">{r.issued_at ? new Date(r.issued_at).toLocaleString() : "—"}</TableCell>
              <TableCell>
                {(() => {
                  const ids = issuedPdfIdsFromRow(r);
                  const canPreview = Boolean(r.pdf_url || ids.certificateId || ids.offerLetterId);
                  if (!canPreview) return <span className="text-xs text-muted-foreground">—</span>;
                  return (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPreview(r);
                    }}
                  >
                    Preview
                  </Button>
                  );
                })()}
              </TableCell>
              {canDelete ? (
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    disabled={deletingId === r.id}
                    onClick={() => void deleteIssued(r)}
                    aria-label="Delete issued letter"
                  >
                    {deletingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
      <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="max-w-4xl max-h-[min(90dvh,100%)]">
          <DialogHeader>
            <DialogTitle>{docKind === "certificate" ? "Certificate Preview" : "Offer letter preview"}</DialogTitle>
            <DialogDescription className="text-xs">
              {preview?.recipient_name || preview?.recipient_email || "Issued document"}
              {docKind === "certificate" ? " — same PDF generated at issue time." : ""}
            </DialogDescription>
          </DialogHeader>
          {preview ? <IssuedDocPdfViewer row={preview} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPreview(null)}>
              Close
            </Button>
            <Button
              type="button"
              className="gap-1.5"
              disabled={!previewIds.certificateId && !previewIds.offerLetterId}
              onClick={() => {
                void (async () => {
                  if (!preview) return;
                  try {
                    const ids = issuedPdfIdsFromRow(preview);
                    const blob = ids.certificateId
                      ? await api.certificates.pdf(ids.certificateId)
                      : await api.offerLetters.fetchSentPdfBlob(ids.offerLetterId);
                    const url = URL.createObjectURL(blob);
                    const w = window.open(url, "_blank");
                    if (!w) {
                      toast({
                        variant: "destructive",
                        title: "Popup blocked",
                        description: "Allow popups to print or save the PDF.",
                      });
                    } else {
                      w.addEventListener("load", () => {
                        try {
                          w.print();
                        } catch {
                          /* user can print from the tab */
                        }
                      });
                    }
                    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
                  } catch (e: unknown) {
                    toast({
                      variant: "destructive",
                      title: "PDF unavailable",
                      description: e instanceof Error ? e.message : "Could not open PDF.",
                    });
                  }
                })();
              }}
            >
              <Printer className="h-3.5 w-3.5" /> Print / Save as PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
