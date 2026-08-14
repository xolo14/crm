import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  Eye,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Power,
  Save,
  Trash2,
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
  applyPlaceholders,
  defaultDocFormFields,
  extractPlaceholderKeys,
  type DocForm,
  type DocFormAccessRow,
  type DocFormColumnMap,
  type DocFormField,
  type DocFormSubmission,
  type DocFormType,
  type TemplateMailConfig,
} from "@/modules/docForms/types";
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
import { buildHtmlDocumentPdfBase64 } from "@/utils/offerLetterPdf";
import { filterAndSortAssignRoster } from "@/lib/assignRoster";

type TeamMember = {
  id: string;
  full_name: string;
  email?: string;
  role?: string;
  reports_to_id?: string | null;
  reports_to_name?: string | null;
  is_active?: number | boolean;
};
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

export default function DocFormsHubPage({
  embedded = false,
  createSignal = 0,
}: {
  embedded?: boolean;
  createSignal?: number;
} = {}) {
  const { toast } = useToast();
  const { user } = useAuth();
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
    if (tab === "all") return forms;
    return forms.filter((f) => f.form_type === tab);
  }, [forms, tab]);

  const openEdit = async (form: DocForm) => {
    setCreating(false);
    setEditing(form);
    setDraftName(form.name);
    setDraftType(form.form_type);
    setDraftDesc(form.description || "");
    setDraftFields(Array.isArray(form.fields_json) && form.fields_json.length ? form.fields_json : defaultDocFormFields(form.form_type));
    setDraftBrand(brandStateFromMeta(form.meta_json));
    setBuilderTab("questions");
    try {
      const res = await api.docForms.get(form.id);
      const full = (res as any).data as DocForm;
      const access = full.access || [];
      setSelectedUsers(access.filter((a) => a.access_type === "user" && a.user_id).map((a) => String(a.user_id)));
      setSelectedRoles(access.filter((a) => a.access_type === "role" && a.role_key).map((a) => String(a.role_key)));
      if (Array.isArray(full.fields_json) && full.fields_json.length) setDraftFields(full.fields_json);
      setDraftBrand(brandStateFromMeta(full.meta_json ?? form.meta_json));
      if (full.description != null) setDraftDesc(String(full.description));
    } catch {
      /* use list row */
    }
  };

  const saveForm = async () => {
    if (!draftName.trim()) {
      toast({ variant: "destructive", title: "Name is required" });
      return;
    }
    setSaving(true);
    try {
      let formId = editing?.id;
      const meta_json = metaFromBrandState(draftBrand);
      if (editing) {
        await api.docForms.update(editing.id, {
          name: draftName.trim(),
          description: draftDesc,
          form_type: draftType,
          fields_json: draftFields,
          meta_json,
          is_active: true,
        });
      } else {
        const created = (await api.docForms.create({
          name: draftName.trim(),
          description: draftDesc,
          form_type: draftType,
          fields_json: draftFields,
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
      toast({ title: editing ? "Form updated" : "Form created" });
      setCreating(false);
      setEditing(null);
      await load();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e?.message });
    } finally {
      setSaving(false);
    }
  };

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
    `${window.location.origin}/doc-form/${encodeURIComponent(String(form.slug || "").trim())}`;

  const copyShareLink = async (form: DocForm) => {
    const link = shareLinkFor(form);
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Link copied", description: "Share this link so people can fill the form." });
    } catch {
      toast({ variant: "destructive", title: "Copy failed", description: link });
    }
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
    setDraftFields((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        key: `field_${prev.length + 1}`,
        label: "New field",
        type: "text",
        required: false,
      },
    ]);
  };

  if (creating || editing) {
    const brandPreview = builderBrandFromState(draftBrand);
    const patchBrand = (patch: Partial<DocFormBrandState>) =>
      setDraftBrand((p) => ({ ...p, ...patch }));

    const renderFieldInputs = (interactive: boolean) => (
      <section className="sp-form-section">
        {draftFields.map((f) => (
          <div key={f.id} className="sp-form-group">
            <label className="sp-form-label">
              {f.label || "Untitled"}
              {f.required ? <span className="sp-form-required"> *</span> : null}
            </label>
            {f.type === "textarea" ? (
              <textarea className="sp-form-input" rows={3} placeholder={f.placeholder || ""} readOnly={!interactive} disabled={!interactive} />
            ) : (
              <input
                className="sp-form-input"
                type={f.type === "email" ? "email" : f.type === "date" ? "date" : "text"}
                placeholder={f.placeholder || "Your answer"}
                readOnly={!interactive}
                disabled={!interactive}
              />
            )}
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
                          onChange={(e) => {
                            const next = [...draftFields];
                            next[idx] = { ...f, label: e.target.value };
                            setDraftFields(next);
                          }}
                          placeholder="Question"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Select
                            value={f.type}
                            onValueChange={(v) => {
                              const next = [...draftFields];
                              next[idx] = { ...f, type: v as DocFormField["type"] };
                              setDraftFields(next);
                            }}
                          >
                            <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">Short answer</SelectItem>
                              <SelectItem value="email">Email</SelectItem>
                              <SelectItem value="textarea">Paragraph</SelectItem>
                              <SelectItem value="date">Date</SelectItem>
                              <SelectItem value="select">Dropdown</SelectItem>
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
                              className="h-8 text-xs font-mono"
                              value={f.key}
                              onChange={(e) => {
                                const next = [...draftFields];
                                next[idx] = { ...f, key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") };
                                setDraftFields(next);
                              }}
                            />
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
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive shrink-0"
                        onClick={() => setDraftFields((p) => p.filter((x) => x.id !== f.id))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
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
                <CardDescription className="text-xs">Who can open this under My Document Forms.</CardDescription>
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
                  <Label>Logo URL</Label>
                  <Input className="mt-1" value={draftBrand.companyLogoUrl} onChange={(e) => patchBrand({ companyLogoUrl: e.target.value })} placeholder="https://…" />
                </div>
                <div>
                  <Label>Header image URL</Label>
                  <Input className="mt-1" value={draftBrand.headerImageUrl} onChange={(e) => patchBrand({ headerImageUrl: e.target.value })} placeholder="https://…" />
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
          <div className="mt-3 flex justify-end">
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
                        <TableHead className="w-[28%]">Name</TableHead>
                        <TableHead className="w-[12%]">Type</TableHead>
                        <TableHead className="w-[10%]">Status</TableHead>
                        <TableHead className="w-[8%] text-right">Subs</TableHead>
                        <TableHead className="w-[8%]">Link</TableHead>
                        <TableHead className="w-[10%]">Assign</TableHead>
                        <TableHead className="w-[16%]">Assigned</TableHead>
                        <TableHead className="w-[8%] text-right"> </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-sm text-muted-foreground">
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
                              onClick={() => void openEdit(f)}
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
                                {assignedSummary(f)}
                                {f.template_link ? (
                                  <div className="text-[10px] text-emerald-700 mt-0.5">Template linked</div>
                                ) : (
                                  <div className="text-[10px] mt-0.5">No template</div>
                                )}
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
                                      Copy link
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
              Assigned people/roles see this under My Document Forms. Anyone with the public link can also fill it.
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

    const requiredKeys = placeholders.filter(Boolean);
    const missing = requiredKeys.filter((k) => !String(playValues[k] ?? "").trim());
    if (missing.length) {
      toast({ variant: "destructive", title: "Missing required fields", description: missing.join(", ") });
      return;
    }

    setBusy(true);
    try {
      // Persist latest values
      await api.docForms.updateSubmissionValues({
        submission_id: playRow.id,
        values: playValues,
        respondent_name: playValues.candidate_name || playValues.name || playRow.respondent_name || undefined,
        respondent_email: playValues.recipient_email || playValues.email || playRow.respondent_email || undefined,
      });

      if (formType === "offer_letter") {
        const mail = parseMailJson(tpl.mail_json);
        const html = applyPlaceholders(String(tpl.html_content || ""), playValues);
        const subject = applyPlaceholders(mail.mail_subject || "Offer Letter", playValues);
        const body = applyPlaceholders(mail.mail_body || "<p>Please find your offer letter attached.</p>", playValues);
        const emailKey = fieldKeyToPlaceholder(mail.recipient_email_placeholder || "recipient_email");
        const email = String(playValues[emailKey] || playValues.recipient_email || playValues.email || "").trim();
        const name = String(playValues.candidate_name || playValues.name || "Candidate");
        const filename = applyPlaceholders(mail.pdf_filename_pattern || "{{candidate_name}}_OfferLetter.pdf", playValues);
        if (!email) throw new Error("Recipient email is empty");
        const pdfBase64 = await buildHtmlDocumentPdfBase64(html);
        await api.offerLetters.send({
          template_id: tplId,
          recipient_name: name,
          recipient_email: email,
          role_title: playValues.role_title || tpl.role_title || "",
          html_content: html,
          email_subject: subject,
          email_html: body,
          attachment_name: filename,
          pdf_base64: pdfBase64,
        });
      } else {
        // Certificates: record issued via doc_forms; canvas PDF email can follow from Certificates Issued wizard.
        const email = String(playValues.email || playValues.recipient_email || "").trim();
        const name = String(playValues.name || playValues.candidate_name || "Recipient");
        if (!email) throw new Error("Recipient email is empty");
        void name;
      }

      await api.docForms.issue({
        submission_id: playRow.id,
        values: playValues,
        recipient_email: playValues.recipient_email || playValues.email,
        recipient_name: playValues.candidate_name || playValues.name,
        email_subject: formType === "offer_letter" ? applyPlaceholders(parseMailJson(tpl.mail_json).mail_subject || "Offer Letter", playValues) : "Certificate",
      });

      toast({ title: "Issued", description: "Document issued and emailed where supported." });
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
                    No rows yet. Use <strong>Add row</strong> to enter details manually, or wait for submissions from My Document Forms.
                  </TableCell>
                </TableRow>
              ) : (
                submissions.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs">
                      <div className="font-medium">{row.respondent_name || row.values_json?.candidate_name || row.values_json?.name || "—"}</div>
                      <div className="text-muted-foreground">{row.respondent_email || row.values_json?.email || ""}</div>
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
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>Preview</DialogTitle>
              <DialogDescription>Not issued — review only.</DialogDescription>
            </DialogHeader>
            <div className="border rounded-md bg-white p-2" dangerouslySetInnerHTML={{ __html: previewHtml || "" }} />
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
                  <p className="text-[11px] text-muted-foreground">{f.submission_count ?? 0} submissions</p>
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

export function DocIssuedPanel({ docKind }: { docKind: DocFormType }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<import("@/modules/docForms/types").DocIssuedDocument[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Recipient</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>PDF</TableHead>
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
              <TableCell className="text-xs">
                {r.pdf_url ? <a className="text-primary underline" href={r.pdf_url} target="_blank" rel="noreferrer">View</a> : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
