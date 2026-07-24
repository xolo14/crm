import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PublicFormShell, builderBrandFromState } from "@/components/forms/PublicFormShell";
import { PublicFormFields } from "@/components/forms/PublicFormFields";
import { buildFormSections } from "@/components/forms/formBuilderTypes";
import { FormDescriptionEditor } from "@/components/forms/FormDescriptionEditor";
import { descriptionPlainPreview } from "@/components/forms/formDescriptionHtml";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Link as LinkIcon, Loader2, Plus, RefreshCw, Save, Users, Trash2, ArrowLeft, GripVertical, Eye, Briefcase, UserRound, MoreHorizontal, Pencil, Power } from "lucide-react";
import { normalizeFormColor, parseFormMetaJson } from "@/components/forms/publicFormTypes";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormDetailDialog } from "@/components/forms/FormDetailDialog";
import { FormPublishCampaignDialog } from "@/components/forms/FormPublishCampaignDialog";
import { canManageFormCampaigns, parseFormCampaign, type FormCampaignConfig } from "@/components/forms/formCampaignTypes";
import { isL3AdminRole, isMarketingFamilyRole, normalizeAppRole } from "@/lib/roleUtils";
import { formsManagerCacheKey } from "@/lib/formsManagerCache";

type LeadDestination = "form_leads" | "hr_leads";

function formLeadDestinationFromMeta(meta: ReturnType<typeof parseFormMetaJson>): LeadDestination {
  const dest = String(meta?.lead_destination || "").trim().toLowerCase();
  return dest === "hr_leads" ? "hr_leads" : "form_leads";
}

interface LeadForm {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: number | boolean;
  fields_json?: FormField[];
  source?: "system" | "custom";
  assigned_count?: number;
  submission_count?: number;
  created_at?: string;
  created_by?: string | null;
  org_id?: string | null;
  org_name?: string | null;
  meta_json?: {
    company_name?: string;
    logo_url?: string;
    form_bg?: string;
    field_bg?: string;
    text_color?: string;
    builder_questions?: Question[];
    collect_email?: boolean;
    allow_multiple_responses?: boolean;
    edit_after_submit?: boolean;
    show_progress_bar?: boolean;
    shuffle_questions?: boolean;
    confirmation_message?: string;
    is_quiz?: boolean;
    lead_destination?: LeadDestination;
  };
}

interface TeamMember {
  id: string;
  full_name: string;
  email?: string;
  referral_code?: string | null;
  role?: string;
  reports_to_id?: string | null;
  org_id?: string | null;
  org_name?: string | null;
}

interface FormAssignment {
  id: string;
  form_id: string;
  member_id: string;
  full_name?: string;
  email?: string;
  referral_code?: string | null;
}

type FieldType = "text" | "email" | "phone" | "textarea" | "select" | "number" | "date";
type QuestionType =
  | "short_answer"
  | "paragraph"
  | "multiple_choice"
  | "checkboxes"
  | "dropdown"
  | "file_upload"
  | "linear_scale"
  | "mc_grid"
  | "checkbox_grid"
  | "date"
  | "time"
  | "section_break";

interface FormField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

interface Question {
  id: string;
  type: QuestionType;
  title: string;
  description?: string;
  required: boolean;
  options?: string[];
  rows?: string[];
  columns?: string[];
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
  points?: number;
  validation?: { kind?: "text" | "number" | "length" | "regex"; value?: string };
  includeOther?: boolean;
}

interface FormBuilderState {
  id: string;
  title: string;
  description: string;
  slug: string;
  companyName: string;
  companyLogoUrl: string;
  headerImageUrl: string;
  formBg: string;
  fieldBg: string;
  textColor: string;
  isActive: boolean;
  collectEmail: boolean;
  allowMultipleResponses: boolean;
  editAfterSubmit: boolean;
  showProgressBar: boolean;
  shuffleQuestions: boolean;
  confirmationMessage: string;
  isQuiz: boolean;
  accentColor: string;
  fieldBorderColor: string;
  fieldBorderWidth: number;
  sectionBorderColor: string;
  sectionBorderWidth: number;
  descriptionColor: string;
  companyNameFontSize: number;
  questions: Question[];
  leadDestination: LeadDestination;
  orgId: string;
}

const PRIMARY_GREEN = "#1D9E75";

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_answer: "Short answer",
  paragraph: "Paragraph",
  multiple_choice: "Multiple choice",
  checkboxes: "Checkboxes",
  dropdown: "Dropdown",
  file_upload: "File upload",
  linear_scale: "Linear scale",
  mc_grid: "Multiple choice grid",
  checkbox_grid: "Checkbox grid",
  date: "Date",
  time: "Time",
  section_break: "Section break",
};

const NEW_QUESTION = (type: QuestionType = "short_answer"): Question => ({
  id: crypto.randomUUID(),
  type,
  title: "Question",
  required: false,
  options: type === "multiple_choice" || type === "checkboxes" || type === "dropdown" ? ["Option 1"] : [],
  rows: type === "mc_grid" || type === "checkbox_grid" ? ["Row 1"] : [],
  columns: type === "mc_grid" || type === "checkbox_grid" ? ["Column 1"] : [],
  scaleMin: type === "linear_scale" ? 1 : undefined,
  scaleMax: type === "linear_scale" ? 5 : undefined,
});

const DEFAULT_BUILDER_QUESTIONS = (): Question[] => [
  {
    id: crypto.randomUUID(),
    type: "short_answer",
    title: "Full Name",
    required: true,
    description: "",
    options: [],
  },
  {
    id: crypto.randomUUID(),
    type: "short_answer",
    title: "Email Address",
    required: true,
    description: "",
    options: [],
    validation: { kind: "regex", value: "email" },
  },
];

function normalizeQuestionForType(question: Question, type: QuestionType): Question {
  return {
    ...question,
    type,
    options: type === "multiple_choice" || type === "checkboxes" || type === "dropdown" ? (question.options?.length ? question.options : ["Option 1"]) : [],
    rows: type === "mc_grid" || type === "checkbox_grid" ? (question.rows?.length ? question.rows : ["Row 1"]) : [],
    columns: type === "mc_grid" || type === "checkbox_grid" ? (question.columns?.length ? question.columns : ["Column 1"]) : [],
    scaleMin: type === "linear_scale" ? (question.scaleMin ?? 1) : undefined,
    scaleMax: type === "linear_scale" ? (question.scaleMax ?? 5) : undefined,
    includeOther: type === "multiple_choice" || type === "checkboxes" ? !!question.includeOther : false,
  };
}

const INITIAL_BUILDER: FormBuilderState = {
  id: "",
  title: "Untitled Form",
  description: "",
  slug: "",
  companyName: "",
  companyLogoUrl: "",
  headerImageUrl: "",
  formBg: "#ffffff",
  fieldBg: "#ffffff",
  textColor: "#111827",
  isActive: true,
  collectEmail: false,
  allowMultipleResponses: true,
  editAfterSubmit: false,
  showProgressBar: false,
  shuffleQuestions: false,
  confirmationMessage: "Your response has been recorded.",
  isQuiz: false,
  accentColor: PRIMARY_GREEN,
  fieldBorderColor: "#000000",
  fieldBorderWidth: 1,
  sectionBorderColor: "#000000",
  sectionBorderWidth: 2,
  descriptionColor: "#6b7280",
  companyNameFontSize: 17,
  questions: DEFAULT_BUILDER_QUESTIONS(),
  leadDestination: "form_leads",
  orgId: "",
};

type BuilderAction =
  | { type: "set"; patch: Partial<FormBuilderState> }
  | { type: "set_questions"; questions: Question[] }
  | { type: "add_question"; questionType?: QuestionType }
  | { type: "update_question"; id: string; patch: Partial<Question> }
  | { type: "duplicate_question"; id: string }
  | { type: "delete_question"; id: string }
  | { type: "reset"; next: FormBuilderState };

function builderReducer(state: FormBuilderState, action: BuilderAction): FormBuilderState {
  if (action.type === "set") return { ...state, ...action.patch };
  if (action.type === "set_questions") return { ...state, questions: action.questions };
  if (action.type === "add_question") return { ...state, questions: [...state.questions, NEW_QUESTION(action.questionType)] };
  if (action.type === "update_question") {
    return {
      ...state,
      questions: state.questions.map((q) => (q.id === action.id ? { ...q, ...action.patch } : q)),
    };
  }
  if (action.type === "duplicate_question") {
    const idx = state.questions.findIndex((q) => q.id === action.id);
    if (idx < 0) return state;
    const copy = { ...state.questions[idx], id: crypto.randomUUID(), title: `${state.questions[idx].title} (copy)` };
    const next = [...state.questions];
    next.splice(idx + 1, 0, copy);
    return { ...state, questions: next };
  }
  if (action.type === "delete_question") {
    const remaining = state.questions.filter((q) => q.id !== action.id);
    return { ...state, questions: remaining.length ? remaining : [NEW_QUESTION("short_answer")] };
  }
  return action.next;
}

function mapLegacyFieldToQuestion(field: FormField): Question {
  const typeMap: Record<FieldType, QuestionType> = {
    text: "short_answer",
    email: "short_answer",
    phone: "short_answer",
    textarea: "paragraph",
    select: "dropdown",
    number: "short_answer",
    date: "date",
  };
  return {
    id: field.id || crypto.randomUUID(),
    type: typeMap[field.type] || "short_answer",
    title: field.label || "Question",
    required: !!field.required,
    description: "",
    options: field.options || [],
    validation: field.type === "email" ? { kind: "regex", value: "email" } : undefined,
  };
}

function toLegacyFields(questions: Question[]): FormField[] {
  return questions
    .filter((q) => q.type !== "section_break")
    .map((q, idx) => {
      const keyBase =
        q.validation?.kind === "regex" && q.validation?.value === "email"
          ? "email"
          : /full\s*name/i.test(q.title || "")
            ? "name"
            : q.title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `field_${idx + 1}`;
      const typeMap: Record<QuestionType, FieldType> = {
        short_answer:
          q.validation?.kind === "regex" && q.validation?.value === "email"
            ? "email"
            : q.validation?.kind === "number"
              ? "number"
              : "text",
        paragraph: "textarea",
        multiple_choice: "select",
        checkboxes: "select",
        dropdown: "select",
        file_upload: "text",
        linear_scale: "number",
        mc_grid: "textarea",
        checkbox_grid: "textarea",
        date: "date",
        time: "text",
        section_break: "text",
      };
      return {
        id: q.id,
        key: keyBase,
        label: q.title || `Question ${idx + 1}`,
        type: typeMap[q.type] || "text",
        required: !!q.required,
        placeholder: q.description || "",
        options: q.options || [],
      };
    });
}

function SortableQuestionCard({
  question,
  selected,
  onSelect,
  onUpdate,
  onDuplicate,
  onDelete,
}: {
  question: Question;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<Question>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: question.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative rounded-2xl border bg-white/92 backdrop-blur-sm",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]",
        "transition-all duration-200 hover:-translate-y-0.5",
        selected && "border-l-4 border-l-[#1D9E75] shadow-[0_0_0_4px_rgba(29,158,117,0.08),0_16px_40px_rgba(0,0,0,0.08)]"
      )}
      onClick={onSelect}
    >
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <button className="text-muted-foreground cursor-grab" {...attributes} {...listeners}>
            <GripVertical className="h-4 w-4" />
          </button>
          <Input
            value={question.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            placeholder="Question"
            className="bg-slate-50 border-transparent focus:bg-white focus:border-[#1D9E75] focus-visible:ring-4 focus-visible:ring-emerald-100"
          />
          <Select value={question.type} onValueChange={(v) => onUpdate(normalizeQuestionForType(question, v as QuestionType))}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="text-sm text-muted-foreground">
          {question.type === "short_answer" && <Input disabled placeholder="Short answer text" />}
          {question.type === "paragraph" && <Textarea disabled placeholder="Long answer text" />}
          {(question.type === "multiple_choice" || question.type === "checkboxes" || question.type === "dropdown") && (
            <div className="space-y-1.5">
              {(question.options || []).map((opt, idx) => (
                <div key={`${question.id}-opt-${idx}`} className="flex items-center gap-1.5">
                  <Input
                    className="flex-1"
                    value={opt}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const next = [...(question.options || [])];
                      next[idx] = e.target.value;
                      onUpdate({ options: next });
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    title="Remove option"
                    disabled={(question.options || []).length <= 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = (question.options || []).filter((_, i) => i !== idx);
                      onUpdate({ options: next.length ? next : ["Option 1"] });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate({ options: [...(question.options || []), `Option ${(question.options || []).length + 1}`] });
                  }}
                >
                  + Add option
                </Button>
                {(question.type === "multiple_choice" || question.type === "checkboxes") && !question.includeOther ? (
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onUpdate({ includeOther: true }); }}>
                    Add &quot;Other&quot;
                  </Button>
                ) : null}
              </div>
              {question.includeOther ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="flex-1 rounded-md border border-dashed px-3 py-2">Other…</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    title='Remove "Other"'
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdate({ includeOther: false });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : null}
            </div>
          )}
          {question.type === "linear_scale" && <div>Scale: {question.scaleMin || 1} to {question.scaleMax || 5}</div>}
          {(question.type === "mc_grid" || question.type === "checkbox_grid") && <div>Grid question (rows/columns editable in right panel)</div>}
          {question.type === "file_upload" && <Input disabled type="file" />}
          {question.type === "date" && <Input disabled type="date" />}
          {question.type === "time" && <Input disabled type="time" />}
          {question.type === "section_break" && <div className="border-t pt-2 text-sm">Section break</div>}
        </div>
        <div className={cn("flex items-center justify-between border-t pt-3 transition-opacity", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>Duplicate</Button>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={(e) => { e.stopPropagation(); if (confirm("Delete this question?")) onDelete(); }}>Delete</Button>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span>Required</span>
            <Checkbox checked={question.required} onCheckedChange={(c) => onUpdate({ required: c === true })} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function toBool(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

function makeSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Unique enough within an org so invents of "Untitled Form" do not share one slug. */
function uniqueFormSlug(title: string): string {
  const base = makeSlug(title) || "form";
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${base}-${suffix}`;
}

/** Retired global Syncpedia capture form (slug default, no org). */
function isRetiredGlobalBuiltinLeadForm(form: LeadForm): boolean {
  const s = String(form.slug || "").trim().toLowerCase();
  const org = String(form.org_id ?? "").trim();
  return (s === "default" || s === "normal") && org === "";
}

export default function FormsManagerPage() {
  const { role, profile, user, organization } = useAuth();
  const { toast } = useToast();
  const formsCacheKey = useMemo(
    () => formsManagerCacheKey(String(role || ""), organization?.id),
    [role, organization?.id],
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [forms, setForms] = useState<LeadForm[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [assignmentsByForm, setAssignmentsByForm] = useState<Record<string, FormAssignment[]>>({});
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<LeadForm | null>(null);
  const [builder, dispatchBuilder] = useReducer(builderReducer, INITIAL_BUILDER);
  const [builderTab, setBuilderTab] = useState<"questions" | "settings" | "preview">("questions");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [formNameError, setFormNameError] = useState("");
  const [history, setHistory] = useState<FormBuilderState[]>([]);
  const [future, setFuture] = useState<FormBuilderState[]>([]);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [destinationDialogOpen, setDestinationDialogOpen] = useState(false);
  const [detailForm, setDetailForm] = useState<LeadForm | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [publishCampaignOpen, setPublishCampaignOpen] = useState(false);
  const [organizations, setOrganizations] = useState<{ id: string; name: string; slug?: string }[]>([]);
  const [shareHint, setShareHint] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const builderRef = useRef(builder);
  const editingRef = useRef(editing);
  const savingRef = useRef(false);
  const allowAutosaveRef = useRef(false);
  builderRef.current = builder;
  editingRef.current = editing;

  const isSuperAdmin = role === "super_admin";
  const normalizedRole = normalizeAppRole(role);
  // Managers can assign personalized form links to their downline (API enforces team scope).
  const canAssignForms =
    role === "super_admin" ||
    role === "admin" ||
    isL3AdminRole(normalizedRole) ||
    normalizedRole === "manager";
  const canEditForms =
    canAssignForms ||
    isL3AdminRole(normalizedRole) ||
    isMarketingFamilyRole(normalizedRole) ||
    normalizedRole === "manager";
  const tableColCount = 5 + (isSuperAdmin ? 1 : 0) + (canAssignForms ? 2 : 0) + (canEditForms ? 1 : 0);
  const canAccess = canEditForms;
  const isMarketing = normalizeAppRole(role) === "marketing";
  const myReferralCode = String(profile?.referral_code ?? "").trim();

  const baseApplyUrl = useMemo(() => `${window.location.origin}/apply`, []);

  const buildApplyLink = useCallback(
    (slug: string) => {
      const base = `${baseApplyUrl}?form=${encodeURIComponent(slug)}`;
      if (isMarketing && myReferralCode) {
        return `${base}&ref=${encodeURIComponent(myReferralCode)}`;
      }
      return base;
    },
    [baseApplyUrl, isMarketing, myReferralCode],
  );

  const syncpediaOrgId = useMemo(() => {
    const hit = organizations.find((o) => String(o.slug || "").toLowerCase() === "syncpedia");
    if (hit?.id) return hit.id;
    const byName = organizations.find((o) => String(o.name || "").toLowerCase().includes("syncpedia"));
    return byName?.id || "";
  }, [organizations]);

  const resolveSuperAdminFormOrgId = useCallback(
    (rawOrgId: string) => {
      const trimmed = String(rawOrgId || "").trim();
      if (trimmed) return trimmed;
      return syncpediaOrgId || null;
    },
    [syncpediaOrgId],
  );

  const canEditFormRow = useCallback(
    (form: LeadForm) => {
      if (!canEditForms) return false;
      if (canAssignForms) return true;
      if (isL3AdminRole(normalizedRole)) {
        return String(form.org_id || "") === String(organization?.id || "");
      }
      return String(form.created_by || "") === String(user?.id || "");
    },
    [canEditForms, canAssignForms, normalizedRole, organization?.id, user?.id],
  );

  const canManageCampaignsForForm = useCallback(
    (form: LeadForm | null) =>
      canManageFormCampaigns(role, user?.id, form?.created_by, form?.org_id, organization?.id),
    [role, user?.id, organization?.id],
  );

  useEffect(() => {
    if (!canAccess) return;
    void bootstrap();
  }, [canAccess, formsCacheKey]);

  useEffect(() => {
    if (!canAccess || loading) return;
    try {
      localStorage.setItem(formsCacheKey, JSON.stringify(forms));
    } catch {
      /* ignore */
    }
  }, [forms, formsCacheKey, canAccess, loading]);

  async function bootstrap(opts?: { soft?: boolean }) {
    const soft = opts?.soft === true;
    if (!soft) setLoading(true);
    try {
      const orgsPromise = isSuperAdmin
        ? api.organizations.list().then((r) => (Array.isArray(r) ? r : r?.data || []) as { id: string; name: string; slug?: string }[])
        : Promise.resolve([] as { id: string; name: string; slug?: string }[]);
      const [formsRes, teamRes, orgRows] = await Promise.all([api.forms.list(), api.team.list(), orgsPromise]);
      if (isSuperAdmin) setOrganizations(orgRows);
      const rows = Array.isArray(formsRes) ? formsRes : (formsRes?.data || []);
      const mapped: LeadForm[] = rows
        .map((row: any) => ({
          ...row,
          fields_json: Array.isArray(row?.fields_json) ? row.fields_json : [],
          meta_json: parseFormMetaJson(row?.meta_json),
          source: "custom",
        }))
        .filter((row: LeadForm) => !isRetiredGlobalBuiltinLeadForm(row));
      setForms(mapped);
      setTeamMembers(teamRes?.data || []);
      const assignmentPairs = await Promise.all(
        rows.map(async (row: any) => {
          const id = row?.id as string | undefined;
          if (!id) return null;
          const a = await api.forms.assignments(id);
          return [id, (a?.data || []) as FormAssignment[]] as const;
        })
      );
      const nextAssignments: Record<string, FormAssignment[]> = {};
      for (const pair of assignmentPairs) {
        if (!pair) continue;
        nextAssignments[pair[0]] = pair[1];
      }
      setAssignmentsByForm(nextAssignments);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Failed to load forms", description: error?.message || "Try again." });
    } finally {
      if (!soft) setLoading(false);
    }
  }

  async function syncRepFormAssignments() {
    setBackfillRunning(true);
    try {
      const res = await api.forms.backfillSalesFormAssignments();
      const u = typeof res?.users_updated === "number" ? res.users_updated : 0;
      const r = typeof res?.assignment_rows_upserted === "number" ? res.assignment_rows_upserted : 0;
      const s = typeof res?.users_skipped_no_matching_form === "number" ? res.users_skipped_no_matching_form : 0;
      toast({
        title: "Rep form links synced",
        description: `${u} rep(s) updated, ${r} assignment row(s). ${s} skipped (no assignable form).`,
      });
      await bootstrap();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: error?.message || "Try again.",
      });
    } finally {
      setBackfillRunning(false);
    }
  }

  function openCreate() {
    setDestinationDialogOpen(true);
  }

  function startCreateWithDestination(leadDestination: LeadDestination) {
    setDestinationDialogOpen(false);
    setEditing(null);
    editingRef.current = null;
    const next = {
      ...INITIAL_BUILDER,
      id: crypto.randomUUID(),
      leadDestination,
      slug: uniqueFormSlug(INITIAL_BUILDER.title),
    };
    allowAutosaveRef.current = false;
    setSaveStatus("idle");
    dispatchBuilder({ type: "reset", next });
    setHistory([next]);
    setFuture([]);
    setBuilderTab("questions");
    setSelectedQuestionId(null);
    setBuilderOpen(true);
  }

  function openFormDetail(form: LeadForm) {
    setDetailForm(form);
    setDetailOpen(true);
  }

  function openEdit(form: LeadForm) {
    setEditing(form);
    const meta = parseFormMetaJson(form.meta_json);
    const questions = Array.isArray(meta.builder_questions) && meta.builder_questions.length
      ? meta.builder_questions
      : (Array.isArray(form.fields_json) ? form.fields_json.map(mapLegacyFieldToQuestion) : [NEW_QUESTION("short_answer")]);
    const nextState = {
      id: form.id,
      title: form.name || "Untitled Form",
      slug: form.slug || "",
      description: form.description || "",
      companyName: typeof meta.company_name === "string" ? meta.company_name : "",
      companyLogoUrl: String(meta.logo_url || ""),
      headerImageUrl: String(meta.header_image_url || ""),
      formBg: normalizeFormColor(meta.form_bg, "#ffffff"),
      fieldBg: normalizeFormColor(meta.field_bg, "#ffffff"),
      textColor: normalizeFormColor(meta.text_color, "#111827"),
      isActive: toBool(form.is_active),
      collectEmail: !!meta.collect_email,
      allowMultipleResponses: meta.allow_multiple_responses !== false,
      editAfterSubmit: !!meta.edit_after_submit,
      showProgressBar: !!meta.show_progress_bar,
      shuffleQuestions: !!meta.shuffle_questions,
      confirmationMessage: String(meta.confirmation_message || "Your response has been recorded."),
      isQuiz: !!meta.is_quiz,
      accentColor: normalizeFormColor(meta.accent_color, PRIMARY_GREEN),
      fieldBorderColor: normalizeFormColor(meta.field_border_color, "#000000"),
      fieldBorderWidth: Math.min(4, Math.max(1, Number(meta.field_border_width) || 1)),
      sectionBorderColor: normalizeFormColor(meta.section_border_color, "#000000"),
      sectionBorderWidth: Math.min(4, Math.max(1, Number(meta.section_border_width) || 2)),
      descriptionColor: normalizeFormColor(meta.description_color, "#6b7280"),
      companyNameFontSize: Math.min(48, Math.max(12, Number(meta.company_name_font_size) || 17)),
      questions,
      leadDestination: formLeadDestinationFromMeta(meta),
      orgId: String(form.org_id ?? "").trim(),
    };
    allowAutosaveRef.current = false;
    setSaveStatus("idle");
    dispatchBuilder({
      type: "reset",
      next: nextState,
    });
    setHistory([nextState]);
    setFuture([]);
    setFormNameError("");
    setBuilderOpen(true);
  }

  const saveForm = useCallback(
    async (
      publish = false,
      closeAfter = false,
      campaign?: FormCampaignConfig,
      quiet = false,
    ): Promise<string | null> => {
      const current = builderRef.current;
      const currentEditing = editingRef.current;
      if (!current.title.trim()) {
        setFormNameError("Form name is required");
        return null;
      }
      if (savingRef.current) return currentEditing?.id ?? null;
      savingRef.current = true;
      setFormNameError("");
      setSaveStatus("saving");
      setSaving(true);
      let formId: string | null = currentEditing?.id ?? null;
      try {
        const slug = (
          current.slug ||
          (currentEditing ? makeSlug(current.title) : uniqueFormSlug(current.title))
        ).trim();
        const existingCampaign = currentEditing
          ? parseFormCampaign(currentEditing.meta_json)
          : parseFormCampaign(null);
        const meta_json: Record<string, unknown> = {
          company_name: current.companyName.trim(),
          logo_url: current.companyLogoUrl.trim() || "",
          header_image_url: current.headerImageUrl.trim() || "",
          form_bg: current.formBg,
          field_bg: current.fieldBg,
          text_color: current.textColor,
          accent_color: current.accentColor,
          field_border_color: current.fieldBorderColor,
          field_border_width: current.fieldBorderWidth,
          section_border_color: current.sectionBorderColor,
          section_border_width: current.sectionBorderWidth,
          description_color: current.descriptionColor,
          company_name_font_size: current.companyNameFontSize,
          builder_questions: current.questions,
          collect_email: current.collectEmail,
          allow_multiple_responses: current.allowMultipleResponses,
          edit_after_submit: current.editAfterSubmit,
          show_progress_bar: current.showProgressBar,
          shuffle_questions: current.shuffleQuestions,
          confirmation_message: current.confirmationMessage,
          is_quiz: current.isQuiz,
          lead_destination: current.leadDestination,
          campaign: campaign ? { ...existingCampaign, ...campaign } : existingCampaign,
        };
        const payload = {
          name: current.title.trim(),
          slug,
          description: current.description.trim() || null,
          fields_json: toLegacyFields(current.questions),
          meta_json,
          is_active: publish ? true : current.isActive,
        };
        if (isSuperAdmin) {
          (payload as { org_id?: string | null }).org_id = resolveSuperAdminFormOrgId(current.orgId);
        }

        let savedRow: LeadForm;
        if (currentEditing) {
          await api.forms.update(currentEditing.id, payload);
          formId = currentEditing.id;
          savedRow = {
            ...currentEditing,
            name: payload.name,
            slug: payload.slug,
            description: payload.description,
            fields_json: payload.fields_json,
            meta_json: payload.meta_json as LeadForm["meta_json"],
            is_active: payload.is_active ? 1 : 0,
            ...(isSuperAdmin
              ? { org_id: (payload as { org_id?: string | null }).org_id ?? currentEditing.org_id }
              : {}),
          };
          setForms((prev) => prev.map((f) => (f.id === savedRow.id ? savedRow : f)));
          setEditing(savedRow);
          if (!quiet) toast({ title: publish ? "Form published" : "Form saved" });
        } else {
          const created = await api.forms.create(payload);
          formId = created?.id ?? null;
          if (!formId) throw new Error("Form was created but no id was returned");
          const finalSlug = String((created as { slug?: string })?.slug || slug).trim() || slug;
          savedRow = {
            id: formId,
            name: payload.name,
            slug: finalSlug,
            description: payload.description,
            fields_json: payload.fields_json,
            meta_json: payload.meta_json as LeadForm["meta_json"],
            is_active: payload.is_active ? 1 : 0,
            source: "custom",
            created_by: user?.id,
            ...(isSuperAdmin
              ? { org_id: (payload as { org_id?: string | null }).org_id ?? undefined }
              : {}),
          };
          // Pin id immediately so a concurrent autosave cannot INSERT again.
          editingRef.current = savedRow;
          setForms((prev) => [savedRow, ...prev.filter((f) => f.id !== savedRow.id)]);
          setEditing(savedRow);
          if (current.slug !== finalSlug) {
            dispatchBuilder({ type: "set", patch: { slug: finalSlug } });
          }
          if (!quiet) toast({ title: publish ? "Form published" : "Form saved" });
        }

        setSaveStatus("saved");
        window.setTimeout(() => {
          setSaveStatus((s) => (s === "saved" ? "idle" : s));
        }, 1500);
        if (closeAfter) {
          setBuilderOpen(false);
          void bootstrap({ soft: true });
        }
        return formId;
      } catch (error: any) {
        setSaveStatus("idle");
        toast({ variant: "destructive", title: "Save failed", description: error?.message || "Try again." });
        return null;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [isSuperAdmin, resolveSuperAdminFormOrgId, user?.id],
  );

  useEffect(() => {
    if (!builderOpen) return;
    if (!allowAutosaveRef.current) {
      allowAutosaveRef.current = true;
      return;
    }
    if (!builder.title.trim()) return;
    const timer = window.setTimeout(() => {
      void saveForm(false, false, undefined, true);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [builder, builderOpen, saveForm]);

  useEffect(() => {
    if (!builderOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveForm(false, false, undefined, false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [builderOpen, saveForm]);

  async function publishWithCampaign(campaign: FormCampaignConfig) {
    const merged: FormCampaignConfig = {
      ...campaign,
      auto_send_email: campaign.auto_send_email ?? false,
      auto_send_whatsapp: campaign.auto_send_whatsapp ?? false,
    };
    const formId = await saveForm(true, true, merged, false);
    if (!formId) return;
    if (merged.assign_email || merged.assign_whatsapp) {
      try {
        const res = await api.forms.saveCampaignSettings({
          form_id: formId,
          campaign: merged,
          send_to_existing: true,
        });
        const results = res?.send_result?.results;
        const emailSent = results?.email?.sent;
        const waSent = results?.whatsapp?.sent;
        const parts: string[] = [];
        if (emailSent != null) parts.push(`${emailSent} emails`);
        if (waSent != null) parts.push(`${waSent} WhatsApp`);
        toast({
          title: "Published with campaigns",
          description: parts.length ? `Sent to ${parts.join(" and ")}` : "Campaign settings applied",
        });
      } catch (error: any) {
        toast({
          variant: "destructive",
          title: "Published but campaign send failed",
          description: error?.message || "Try sending manually from form details.",
        });
      }
    }
  }

  async function handleShareClick() {
    if (!builder.title.trim()) {
      setFormNameError("Form name is required");
      toast({ variant: "destructive", title: "Add a form name before sharing" });
      return;
    }
    if (!editingRef.current) {
      const id = await saveForm(false, false, undefined, false);
      if (!id) return;
    }
    const slug = (builderRef.current.slug || makeSlug(builderRef.current.title)).trim();
    if (!slug) {
      toast({ variant: "destructive", title: "Form link unavailable" });
      return;
    }
    await copy(buildApplyLink(slug), "Form link");
    setShareHint(true);
    window.setTimeout(() => setShareHint(false), 2000);
  }

  async function toggleFormStatus(form: LeadForm) {
    try {
      await api.forms.update(form.id, { is_active: !toBool(form.is_active) });
      await bootstrap();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Failed to update status", description: error?.message || "Try again." });
    }
  }

  async function deleteForm(form: LeadForm) {
    const ok = window.confirm(`Delete "${form.name}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await api.forms.delete(form.id);
      setForms((prev) => prev.filter((f) => f.id !== form.id));
      setAssignmentsByForm((prev) => {
        const next = { ...prev };
        delete next[form.id];
        return next;
      });
      toast({ title: "Form deleted" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Delete failed", description: error?.message || "Try again." });
    }
  }

  async function updateAssignments(formId: string, nextIds: string[]) {
    try {
      await api.forms.assignMembers(formId, nextIds);
      const refreshed = await api.forms.assignments(formId);
      setAssignmentsByForm((prev) => ({ ...prev, [formId]: refreshed?.data || [] }));
      toast({ title: "Link assignments updated" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Assignment failed", description: error?.message || "Try again." });
    }
  }

  function isSalesRepRole(role?: string): boolean {
    const normalized = String(role || "").toLowerCase();
    return normalized === "sales_representative";
  }

  function isValidMemberId(memberId?: string | null): boolean {
    const id = String(memberId || "").trim();
    // UUIDv4-ish generic matcher used by users.id in this app
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }

  function isGreenChecked(checked: boolean): string {
    return `mr-2 inline-block h-3.5 w-3.5 rounded-[3px] border ${checked ? "border-[#1D9E75] bg-[#1D9E75]" : "border-gray-400 bg-white"}`;
  }

  function getAssignableMembersForForm(_form: LeadForm): TeamMember[] {
    return teamMembers.filter((m) => isValidMemberId(m.id));
  }

  async function updateAssignmentsForForm(form: LeadForm, nextIds: string[]) {
    await updateAssignments(form.id, Array.from(new Set(nextIds.filter((id) => isValidMemberId(id)))));
  }

  function applyBuilderUpdate(updater: () => void) {
    setHistory((prev) => [...prev.slice(-49), builder]);
    setFuture([]);
    updater();
  }

  function undoBuilder() {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [builder, ...f.slice(0, 49)]);
    dispatchBuilder({ type: "reset", next: prev });
  }

  function redoBuilder() {
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h.slice(-49), builder]);
    dispatchBuilder({ type: "reset", next });
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch {
      toast({ variant: "destructive", title: "Copy failed" });
    }
  }

  const selectedQuestion = builder.questions.find((q) => q.id === selectedQuestionId) || null;

  if (!canAccess) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">You do not have access to Form Management.</CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (builderOpen) {
    return (
      <div className="min-h-[calc(100dvh-120px)] bg-[linear-gradient(to_bottom,#f4f1ff_0%,#f7f8fc_100%)] -mx-4 sm:-mx-6 lg:-mx-8" onClick={() => setSelectedQuestionId(null)}>
        <div className="sticky top-0 z-20 h-[72px] backdrop-blur-xl bg-white/80 border-b border-[#ebecef]">
          <div className="px-4 sm:px-6 h-full flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Button variant="ghost" size="sm" onClick={() => setBuilderOpen(false)}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
              <Button variant="ghost" size="sm" onClick={undoBuilder} disabled={history.length === 0}>Undo</Button>
              <Button variant="ghost" size="sm" onClick={redoBuilder} disabled={future.length === 0}>Redo</Button>
              <div className="min-w-0">
                <Input className="h-8 w-64 bg-transparent border-none shadow-none text-sm font-semibold" value={builder.title} onChange={(e) => applyBuilderUpdate(() => dispatchBuilder({ type: "set", patch: { title: e.target.value } }))} />
                <p className="text-[11px] text-muted-foreground px-3">Last edited just now</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant={builderTab === "questions" ? "default" : "outline"} size="sm" onClick={() => setBuilderTab("questions")}>Questions</Button>
              <Button variant={builderTab === "settings" ? "default" : "outline"} size="sm" onClick={() => setBuilderTab("settings")}>Settings</Button>
              <Button variant={builderTab === "preview" ? "default" : "outline"} size="sm" onClick={() => setBuilderTab("preview")}><Eye className="h-4 w-4 mr-1" />Preview</Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground min-w-[4.5rem]">
                {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved ✓" : saving ? "Saving..." : ""}
              </span>
              <Button variant="outline" size="sm" onClick={() => void handleShareClick()} disabled={saving}>
                {shareHint ? "Copied!" : "Share"}
              </Button>
              <Button size="sm" onClick={() => void saveForm(false, false, undefined, false)} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Save
              </Button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-12 gap-6 p-6 sm:p-8">
          <div className={cn("col-span-12 lg:col-span-8", builderTab === "settings" && "lg:col-span-8")}>
            {builderTab === "questions" && (
              <div className="max-w-[720px] mx-auto space-y-4" onClick={(e) => e.stopPropagation()}>
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="rounded-2xl bg-white/90 backdrop-blur-sm shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_rgba(0,0,0,0.06)] overflow-hidden border border-black/5">
                  <div className="h-[10px] rounded-t-2xl" style={{ background: "linear-gradient(90deg,#1D9E75,#35c997)" }} />
                  <CardContent className="p-6 space-y-3">
                    <Input className="text-[2rem] leading-tight font-bold tracking-[-0.03em] border-0 shadow-none px-0 focus-visible:ring-0 bg-transparent" value={builder.title} onChange={(e) => applyBuilderUpdate(() => dispatchBuilder({ type: "set", patch: { title: e.target.value } }))} placeholder="Untitled Form" />
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <FormDescriptionEditor
                          editorKey={editing?.id || builder.id || "new-form"}
                          value={builder.description}
                          color={builder.descriptionColor}
                          onChange={(html) =>
                            applyBuilderUpdate(() => dispatchBuilder({ type: "set", patch: { description: html } }))
                          }
                        />
                      </div>
                      <Input
                        type="color"
                        className="h-9 w-12 shrink-0 p-1 mt-10"
                        title="Intro text color"
                        value={normalizeFormColor(builder.descriptionColor, "#6b7280")}
                        onChange={(e) => dispatchBuilder({ type: "set", patch: { descriptionColor: e.target.value } })}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Intro under the title — use Enter for new lines, and the toolbar for font, size, and style.
                    </p>
                  </CardContent>
                </Card>
                </motion.div>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => {
                  const { active, over } = event;
                  if (!over || active.id === over.id) return;
                  const oldIndex = builder.questions.findIndex((q) => q.id === active.id);
                  const newIndex = builder.questions.findIndex((q) => q.id === over.id);
                  applyBuilderUpdate(() => dispatchBuilder({ type: "set_questions", questions: arrayMove(builder.questions, oldIndex, newIndex) }));
                }}>
                  <SortableContext items={builder.questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-6">
                      {builder.questions.map((q) => (
                        <motion.div key={q.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
                          <SortableQuestionCard
                            question={q}
                            selected={selectedQuestionId === q.id}
                            onSelect={() => setSelectedQuestionId(q.id)}
                            onUpdate={(patch) => applyBuilderUpdate(() => dispatchBuilder({ type: "update_question", id: q.id, patch }))}
                            onDuplicate={() => applyBuilderUpdate(() => dispatchBuilder({ type: "duplicate_question", id: q.id }))}
                            onDelete={() => applyBuilderUpdate(() => dispatchBuilder({ type: "delete_question", id: q.id }))}
                          />
                          {selectedQuestionId === q.id ? (
                            <div className="absolute right-[-72px] mt-[-120px] hidden xl:block">
                              <Card className="rounded-2xl w-[52px] bg-white shadow-[0_12px_32px_rgba(0,0,0,0.12)] border-0">
                                <CardContent className="p-2 space-y-2">
                                  <Button variant="ghost" size="icon" onClick={() => applyBuilderUpdate(() => dispatchBuilder({ type: "add_question", questionType: "short_answer" }))}><Plus className="h-4 w-4" /></Button>
                                  <Button variant="ghost" size="icon" onClick={() => applyBuilderUpdate(() => dispatchBuilder({ type: "add_question", questionType: "section_break" }))}>T</Button>
                                  <Button variant="ghost" size="icon">Img</Button>
                                  <Button variant="ghost" size="icon">Vid</Button>
                                  <Button variant="ghost" size="icon">Sec</Button>
                                </CardContent>
                              </Card>
                            </div>
                          ) : null}
                        </motion.div>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                {builder.questions.length === 0 ? (
                  <Card className="rounded-2xl border-dashed border-2 bg-white/70">
                    <CardContent className="py-10 text-center">
                      <p className="font-medium">Start building your form</p>
                      <p className="text-sm text-muted-foreground mt-1">Drag blocks here or add your first question.</p>
                    </CardContent>
                  </Card>
                ) : null}
                <Button className="w-full rounded-xl" variant="outline" onClick={() => applyBuilderUpdate(() => dispatchBuilder({ type: "add_question", questionType: "short_answer" }))}>+ Add question</Button>
              </div>
            )}
            {builderTab === "settings" && (
              <div className="max-w-[720px] mx-auto space-y-4">
                <Card><CardHeader><CardTitle className="text-base">General</CardTitle></CardHeader><CardContent className="space-y-3">
                  {isSuperAdmin ? (
                    <div>
                      <Label>Organization</Label>
                      <Select
                        value={builder.orgId || syncpediaOrgId || ""}
                        onValueChange={(v) => dispatchBuilder({ type: "set", patch: { orgId: v } })}
                      >
                        <SelectTrigger><SelectValue placeholder="Select organization" /></SelectTrigger>
                        <SelectContent>
                          {syncpediaOrgId ? (
                            <SelectItem value={syncpediaOrgId}>Syncpedia (platform)</SelectItem>
                          ) : null}
                          {organizations
                            .filter((o) => o.id !== syncpediaOrgId)
                            .map((o) => (
                              <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">Forms belong to one organization. Groot/Nivon admins only see forms assigned to their org. Syncpedia admins see super-admin forms assigned to Syncpedia.</p>
                    </div>
                  ) : null}
                  <div><Label>Form URL slug</Label><Input value={builder.slug} onChange={(e) => dispatchBuilder({ type: "set", patch: { slug: makeSlug(e.target.value) } })} /></div>
                  <div>
                    <Label>Company Name</Label>
                    <Input
                      value={builder.companyName}
                      placeholder="Optional — leave blank to hide on the public form"
                      onChange={(e) => dispatchBuilder({ type: "set", patch: { companyName: e.target.value } })}
                    />
                  </div>
                  <div>
                    <Label>Company name font size (px)</Label>
                    <Select
                      value={String(builder.companyNameFontSize)}
                      onValueChange={(v) => dispatchBuilder({ type: "set", patch: { companyNameFontSize: Number(v) } })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="14">14 px — small</SelectItem>
                        <SelectItem value="17">17 px — default</SelectItem>
                        <SelectItem value="20">20 px — medium</SelectItem>
                        <SelectItem value="24">24 px — large</SelectItem>
                        <SelectItem value="28">28 px — extra large</SelectItem>
                        <SelectItem value="32">32 px — headline</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">Shown centered under the header image.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Company Logo URL</Label>
                    <Input value={builder.companyLogoUrl} onChange={(e) => dispatchBuilder({ type: "set", patch: { companyLogoUrl: e.target.value } })} />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = "image/png,image/jpeg,image/jpg,image/webp,image/svg+xml";
                          input.onchange = async () => {
                            const f = input.files?.[0];
                            if (!f) return;
                            try {
                              const data = await readFileAsDataUrl(f);
                              dispatchBuilder({ type: "set", patch: { companyLogoUrl: data } });
                              toast({ title: "Logo uploaded" });
                            } catch {
                              toast({ variant: "destructive", title: "Upload failed", description: "Unable to read logo file." });
                            }
                          };
                          input.click();
                        }}
                      >
                        Upload Logo
                      </Button>
                      {builder.companyLogoUrl ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => dispatchBuilder({ type: "set", patch: { companyLogoUrl: "" } })}>
                          Clear
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Header image</Label>
                    <p className="text-xs text-muted-foreground">Recommended 1600×400 px (4:1). Shown above company name on the public form.</p>
                    <Input value={builder.headerImageUrl} onChange={(e) => dispatchBuilder({ type: "set", patch: { headerImageUrl: e.target.value } })} placeholder="https://... or upload below" />
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = "image/png,image/jpeg,image/jpg,image/webp";
                          input.onchange = async () => {
                            const f = input.files?.[0];
                            if (!f) return;
                            try {
                              const reader = new FileReader();
                              const data = await new Promise<string>((resolve, reject) => {
                                reader.onload = () => resolve(String(reader.result || ""));
                                reader.onerror = () => reject(new Error("read failed"));
                                reader.readAsDataURL(f);
                              });
                              dispatchBuilder({ type: "set", patch: { headerImageUrl: data } });
                              toast({ title: "Header image uploaded" });
                            } catch {
                              toast({ variant: "destructive", title: "Upload failed", description: "Unable to read image file." });
                            }
                          };
                          input.click();
                        }}
                      >
                        Upload Header
                      </Button>
                      {builder.headerImageUrl ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => dispatchBuilder({ type: "set", patch: { headerImageUrl: "" } })}>
                          Clear
                        </Button>
                      ) : null}
                    </div>
                    {builder.headerImageUrl ? (
                      <img src={builder.headerImageUrl} alt="Header preview" className="w-full max-h-28 object-cover rounded-md border" />
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between"><span>Collect email addresses</span><Checkbox checked={builder.collectEmail} onCheckedChange={(c) => dispatchBuilder({ type: "set", patch: { collectEmail: c === true } })} /></div>
                  <div className="flex items-center justify-between"><span>Allow only one response</span><Checkbox checked={!builder.allowMultipleResponses} onCheckedChange={(c) => dispatchBuilder({ type: "set", patch: { allowMultipleResponses: c !== true } })} /></div>
                  <div className="flex items-center justify-between"><span>Edit after submit</span><Checkbox checked={builder.editAfterSubmit} onCheckedChange={(c) => dispatchBuilder({ type: "set", patch: { editAfterSubmit: c === true } })} /></div>
                  <div className="flex items-center justify-between"><span>Form is active</span><Checkbox checked={builder.isActive} onCheckedChange={(c) => dispatchBuilder({ type: "set", patch: { isActive: c === true } })} /></div>
                </CardContent></Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Lead destination</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">Where new submissions appear after someone fills this form.</p>
                    <Select
                      value={builder.leadDestination}
                      onValueChange={(v) => dispatchBuilder({ type: "set", patch: { leadDestination: v as LeadDestination } })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="form_leads">Form Leads — sales & course inquiries</SelectItem>
                        <SelectItem value="hr_leads">HR Leads — job applications & resumes</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {builder.leadDestination === "hr_leads"
                        ? "Submissions go to Leads → HR Leads. Add a file upload field for resumes."
                        : "Submissions go to Leads → Form Leads and are assigned to the form creator."}
                    </p>
                  </CardContent>
                </Card>
                <Card><CardHeader><CardTitle className="text-base">Presentation</CardTitle></CardHeader><CardContent className="space-y-3">
                  <div className="rounded-lg overflow-hidden border">
                    <p className="text-xs text-muted-foreground px-3 py-2 border-b bg-muted/30">Live preview — updates as you change colors</p>
                    <PublicFormShell
                      preview
                      brand={builderBrandFromState(builder)}
                      formTitle={builder.title || "Form title"}
                      formDescription={builder.description || "Fill in your details to submit this form."}
                    >
                      <section className="sp-form-section">
                        <div className="sp-form-group">
                          <label className="sp-form-label">Sample field</label>
                          <input className="sp-form-input" readOnly placeholder="Your answer" />
                        </div>
                      </section>
                      <button type="button" className="sp-form-submit" disabled>Submit</button>
                    </PublicFormShell>
                  </div>
                  <div>
                    <Label>Form Background</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input type="color" className="h-10 w-16 p-1" value={normalizeFormColor(builder.formBg, "#ffffff")} onChange={(e) => dispatchBuilder({ type: "set", patch: { formBg: e.target.value } })} />
                      <Input value={builder.formBg} onChange={(e) => dispatchBuilder({ type: "set", patch: { formBg: e.target.value } })} />
                    </div>
                  </div>
                  <div>
                    <Label>Field Background</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input type="color" className="h-10 w-16 p-1" value={normalizeFormColor(builder.fieldBg, "#ffffff")} onChange={(e) => dispatchBuilder({ type: "set", patch: { fieldBg: e.target.value } })} />
                      <Input value={builder.fieldBg} onChange={(e) => dispatchBuilder({ type: "set", patch: { fieldBg: e.target.value } })} />
                    </div>
                  </div>
                  <div>
                    <Label>Text Color</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input type="color" className="h-10 w-16 p-1" value={normalizeFormColor(builder.textColor, "#111827")} onChange={(e) => dispatchBuilder({ type: "set", patch: { textColor: e.target.value } })} />
                      <Input value={builder.textColor} onChange={(e) => dispatchBuilder({ type: "set", patch: { textColor: e.target.value } })} />
                    </div>
                  </div>
                  <div>
                    <Label>Accent / button color</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input type="color" className="h-10 w-16 p-1" value={normalizeFormColor(builder.accentColor, PRIMARY_GREEN)} onChange={(e) => dispatchBuilder({ type: "set", patch: { accentColor: e.target.value } })} />
                      <Input value={builder.accentColor} onChange={(e) => dispatchBuilder({ type: "set", patch: { accentColor: e.target.value } })} />
                    </div>
                  </div>
                  <div>
                    <Label>Field border color</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input type="color" className="h-10 w-16 p-1" value={normalizeFormColor(builder.fieldBorderColor, "#000000")} onChange={(e) => dispatchBuilder({ type: "set", patch: { fieldBorderColor: e.target.value } })} />
                      <Input value={builder.fieldBorderColor} onChange={(e) => dispatchBuilder({ type: "set", patch: { fieldBorderColor: e.target.value } })} />
                    </div>
                  </div>
                  <div>
                    <Label>Field border size (px)</Label>
                    <Select
                      value={String(builder.fieldBorderWidth)}
                      onValueChange={(v) => dispatchBuilder({ type: "set", patch: { fieldBorderWidth: Number(v) } })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 px — thin</SelectItem>
                        <SelectItem value="2">2 px — medium</SelectItem>
                        <SelectItem value="3">3 px — bold</SelectItem>
                        <SelectItem value="4">4 px — extra bold</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Section border color</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input type="color" className="h-10 w-16 p-1" value={normalizeFormColor(builder.sectionBorderColor, "#000000")} onChange={(e) => dispatchBuilder({ type: "set", patch: { sectionBorderColor: e.target.value } })} />
                      <Input value={builder.sectionBorderColor} onChange={(e) => dispatchBuilder({ type: "set", patch: { sectionBorderColor: e.target.value } })} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Borders around each section, form card, header, and submit button.</p>
                  </div>
                  <div>
                    <Label>Section border size (px)</Label>
                    <Select
                      value={String(builder.sectionBorderWidth)}
                      onValueChange={(v) => dispatchBuilder({ type: "set", patch: { sectionBorderWidth: Number(v) } })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 px — thin</SelectItem>
                        <SelectItem value="2">2 px — medium</SelectItem>
                        <SelectItem value="3">3 px — bold</SelectItem>
                        <SelectItem value="4">4 px — extra bold</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Intro text color</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input type="color" className="h-10 w-16 p-1" value={normalizeFormColor(builder.descriptionColor, "#6b7280")} onChange={(e) => dispatchBuilder({ type: "set", patch: { descriptionColor: e.target.value } })} />
                      <Input value={builder.descriptionColor} onChange={(e) => dispatchBuilder({ type: "set", patch: { descriptionColor: e.target.value } })} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Color for &quot;Fill in your details…&quot; under the form title.</p>
                  </div>
                  <div className="flex items-center justify-between"><span>Show progress bar</span><Checkbox checked={builder.showProgressBar} onCheckedChange={(c) => dispatchBuilder({ type: "set", patch: { showProgressBar: c === true } })} /></div>
                  <div className="flex items-center justify-between"><span>Shuffle question order</span><Checkbox checked={builder.shuffleQuestions} onCheckedChange={(c) => dispatchBuilder({ type: "set", patch: { shuffleQuestions: c === true } })} /></div>
                  <div><Label>Confirmation message</Label><Textarea value={builder.confirmationMessage} onChange={(e) => dispatchBuilder({ type: "set", patch: { confirmationMessage: e.target.value } })} /></div>
                </CardContent></Card>
                <Card><CardHeader><CardTitle className="text-base">Quizzes</CardTitle></CardHeader><CardContent>
                  <div className="flex items-center justify-between"><span>Make this a quiz</span><Checkbox checked={builder.isQuiz} onCheckedChange={(c) => dispatchBuilder({ type: "set", patch: { isQuiz: c === true } })} /></div>
                </CardContent></Card>
              </div>
            )}
            {builderTab === "preview" && (
              <div className="max-w-[720px] mx-auto rounded-xl overflow-hidden border">
                <PublicFormShell
                  brand={builderBrandFromState(builder)}
                  formTitle={builder.title}
                  formDescription={builder.description || "Fill in your details to submit this form."}
                >
                  {builder.showProgressBar ? (
                    <div className="h-2 rounded-full mb-4" style={{ background: `${builder.fieldBg}88` }}>
                      <div className="h-2 w-1/3 rounded-full" style={{ background: builder.accentColor }} />
                    </div>
                  ) : null}
                  <PublicFormFields
                    sections={buildFormSections(builder.questions)}
                    values={{}}
                    onChange={() => {}}
                    disabled
                  />
                  <button type="button" className="sp-form-submit" disabled>
                    Submit
                  </button>
                </PublicFormShell>
              </div>
            )}
          </div>
          <div className="col-span-3 hidden lg:block">
            <AnimatePresence>
            <motion.div initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 14 }} transition={{ duration: 0.22 }}>
            <Card className="rounded-none sticky top-20 bg-white/70 backdrop-blur-xl border-l border-black/5 border-y-0 border-r-0 shadow-none">
              <CardHeader><CardTitle className="text-sm">Field Settings</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {!selectedQuestion ? <p className="text-xs text-muted-foreground">Select a question card to edit settings.</p> : (
                  <>
                    <div><Label className="text-xs">Field type</Label>
                      <Select value={selectedQuestion.type} onValueChange={(v) => dispatchBuilder({ type: "update_question", id: selectedQuestion.id, patch: normalizeQuestionForType(selectedQuestion, v as QuestionType) })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between"><span className="text-sm">Required</span><Checkbox checked={selectedQuestion.required} onCheckedChange={(c) => dispatchBuilder({ type: "update_question", id: selectedQuestion.id, patch: { required: c === true } })} /></div>
                    <div><Label className="text-xs">Description</Label><Textarea value={selectedQuestion.description || ""} onChange={(e) => dispatchBuilder({ type: "update_question", id: selectedQuestion.id, patch: { description: e.target.value } })} /></div>
                    {selectedQuestion.type === "short_answer" ? (
                      <div className="space-y-2">
                        <Label className="text-xs">Validation rule</Label>
                        <Select value={selectedQuestion.validation?.kind || "text"} onValueChange={(v) => dispatchBuilder({ type: "update_question", id: selectedQuestion.id, patch: { validation: { ...(selectedQuestion.validation || {}), kind: v as "text" | "number" | "length" | "regex" } } })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="length">Length</SelectItem>
                            <SelectItem value="regex">Regex</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input placeholder="Validation value (optional)" value={selectedQuestion.validation?.value || ""} onChange={(e) => dispatchBuilder({ type: "update_question", id: selectedQuestion.id, patch: { validation: { ...(selectedQuestion.validation || {}), value: e.target.value } } })} />
                      </div>
                    ) : null}
                    {(selectedQuestion.type === "multiple_choice" || selectedQuestion.type === "checkboxes" || selectedQuestion.type === "dropdown") ? (
                      <div className="space-y-2">
                        <Label className="text-xs">Options</Label>
                        {(selectedQuestion.options || []).map((opt, idx) => (
                          <div key={`${selectedQuestion.id}-settings-opt-${idx}`} className="flex items-center gap-1">
                            <Input
                              className="h-8 text-sm"
                              value={opt}
                              onChange={(e) => {
                                const next = [...(selectedQuestion.options || [])];
                                next[idx] = e.target.value;
                                dispatchBuilder({ type: "update_question", id: selectedQuestion.id, patch: { options: next } });
                              }}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                              title="Remove option"
                              disabled={(selectedQuestion.options || []).length <= 1}
                              onClick={() => {
                                const next = (selectedQuestion.options || []).filter((_, i) => i !== idx);
                                dispatchBuilder({
                                  type: "update_question",
                                  id: selectedQuestion.id,
                                  patch: { options: next.length ? next : ["Option 1"] },
                                });
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() =>
                            dispatchBuilder({
                              type: "update_question",
                              id: selectedQuestion.id,
                              patch: {
                                options: [
                                  ...(selectedQuestion.options || []),
                                  `Option ${(selectedQuestion.options || []).length + 1}`,
                                ],
                              },
                            })
                          }
                        >
                          + Add option
                        </Button>
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Shuffle options</span>
                          <Checkbox
                            checked={selectedQuestion.validation?.kind === "text" && selectedQuestion.validation?.value === "shuffle"}
                            onCheckedChange={(c) =>
                              dispatchBuilder({
                                type: "update_question",
                                id: selectedQuestion.id,
                                patch: { validation: c === true ? { kind: "text", value: "shuffle" } : undefined },
                              })
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                    {(selectedQuestion.type === "multiple_choice" || selectedQuestion.type === "checkboxes") ? (
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Add "Other"</span>
                        <Checkbox checked={!!selectedQuestion.includeOther} onCheckedChange={(c) => dispatchBuilder({ type: "update_question", id: selectedQuestion.id, patch: { includeOther: c === true } })} />
                      </div>
                    ) : null}
                    {builder.isQuiz && <div><Label className="text-xs">Point value</Label><Input type="number" value={selectedQuestion.points ?? 0} onChange={(e) => dispatchBuilder({ type: "update_question", id: selectedQuestion.id, patch: { points: Number(e.target.value) } })} /></div>}
                  </>
                )}
              </CardContent>
            </Card>
            </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Dialog open={destinationDialogOpen} onOpenChange={setDestinationDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Where should submissions go?</DialogTitle>
            <DialogDescription>
              Choose once when creating the form. You can change this later in Settings.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="rounded-lg border p-4 text-left hover:border-primary hover:bg-primary/5 transition-colors"
              onClick={() => startCreateWithDestination("form_leads")}
            >
              <div className="flex items-center gap-2 font-medium">
                <UserRound className="h-4 w-4 text-primary" />
                Form Leads
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Course inquiries, contact forms, and sales leads. Shows in Leads → Form Leads.
              </p>
            </button>
            <button
              type="button"
              className="rounded-lg border p-4 text-left hover:border-primary hover:bg-primary/5 transition-colors"
              onClick={() => startCreateWithDestination("hr_leads")}
            >
              <div className="flex items-center gap-2 font-medium">
                <Briefcase className="h-4 w-4 text-primary" />
                HR Leads
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Job applications and hiring. Shows in Leads → HR Leads with resume preview.
              </p>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <FormDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        form={detailForm}
        assignments={detailForm ? assignmentsByForm[detailForm.id] || [] : []}
        publicLink={detailForm ? buildApplyLink(detailForm.slug) : ""}
        canEdit={detailForm ? canEditFormRow(detailForm) : false}
        canManageCampaigns={detailForm ? canManageCampaignsForForm(detailForm) : false}
        onEdit={() => {
          if (!detailForm) return;
          setDetailOpen(false);
          openEdit(detailForm);
        }}
        onCopyLink={copy}
      />

      <FormPublishCampaignDialog
        open={publishCampaignOpen}
        onOpenChange={setPublishCampaignOpen}
        formId={editing?.id ?? null}
        initial={editing ? parseFormCampaign(editing.meta_json) : undefined}
        onConfirm={publishWithCampaign}
      />

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Form Management</h1>
          <p className="text-sm text-muted-foreground">
            {canAssignForms
              ? "Create/edit forms and assign personalized form links to team members."
              : "Create and edit your forms. Copy link includes your referral code so leads appear in My Leads."}
          </p>
        </div>
        {canEditForms ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/form-api-integrations">Form API Integrations</Link>
            </Button>
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Form
            </Button>
          </div>
        ) : null}
      </div>

      {isMarketing && !myReferralCode ? (
        <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
          Your account has no referral code yet. Ask an admin to set one so copied form links attribute leads to you in My Leads.
        </p>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Forms</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <div className="w-full overflow-x-auto">
          <Table className="w-full min-w-0 table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className={canAssignForms ? "w-[22%]" : "w-[28%]"}>Name</TableHead>
                {isSuperAdmin ? <TableHead className="w-[12%]">Organization</TableHead> : null}
                <TableHead className="w-[10%]">Destination</TableHead>
                <TableHead className="w-[8%]">Status</TableHead>
                <TableHead className="w-[8%] text-right">Subs</TableHead>
                <TableHead className="w-[8%]">Link</TableHead>
                {canAssignForms ? <TableHead className="w-[10%]">Assign</TableHead> : null}
                {canAssignForms ? <TableHead className="w-[16%]">Assigned</TableHead> : null}
                {canEditForms ? <TableHead className="w-[6%] text-right"> </TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={tableColCount} className="text-center py-8 text-sm text-muted-foreground">
                    No forms yet. Create your first form.
                  </TableCell>
                </TableRow>
              ) : (
                forms.map((form) => {
                  const isOn = toBool(form.is_active);
                  const directLink = buildApplyLink(form.slug);
                  const assigned = assignmentsByForm[form.id] || [];
                  const selectedIds = assigned.map((a) => a.member_id);
                  const assignableMembers = getAssignableMembersForForm(form);
                  const salesManagers = assignableMembers.filter((m) => String(m.role || "").toLowerCase() === "manager");
                  const managerIds = new Set(salesManagers.map((l) => l.id));
                  const standaloneSalesReps = assignableMembers.filter((m) => isSalesRepRole(m.role) && (!m.reports_to_id || !managerIds.has(String(m.reports_to_id))));
                  const leadDest = formLeadDestinationFromMeta(parseFormMetaJson(form.meta_json));
                  return (
                    <TableRow
                      key={form.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openFormDetail(form)}
                    >
                      <TableCell className="align-top">
                        <div className="min-w-0">
                          <div className="font-medium truncate" title={form.name}>{form.name}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
                            <Badge variant="outline" className="text-[10px] shrink-0">Custom</Badge>
                            <code className="text-[10px] text-muted-foreground truncate" title={form.slug}>{form.slug}</code>
                          </div>
                          {form.description ? (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1" title={descriptionPlainPreview(form.description)}>
                              {descriptionPlainPreview(form.description)}
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      {isSuperAdmin ? (
                        <TableCell className="align-top">
                          <span className="text-sm truncate block" title={form.org_name || undefined}>{form.org_name || "—"}</span>
                        </TableCell>
                      ) : null}
                      <TableCell className="align-top">
                        <Badge variant={leadDest === "hr_leads" ? "secondary" : "default"} className="text-[10px] whitespace-nowrap">
                          {leadDest === "hr_leads" ? "HR Leads" : "Form Leads"}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant={isOn ? "default" : "secondary"}>{isOn ? "Active" : "Inactive"}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums align-top">
                        {Number(form.submission_count ?? 0)}
                      </TableCell>
                      <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          title="Copy public link"
                          onClick={() => copy(directLink, "Form link")}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                      {canAssignForms ? (
                      <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2">
                              <Users className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Assign</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="start"
                            side="bottom"
                            sideOffset={6}
                            className="w-72 max-h-80 overflow-y-auto"
                          >
                            <DropdownMenuLabel>Select Team Members</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                              {salesManagers.map((manager) => {
                                const reps = assignableMembers.filter((m) => isSalesRepRole(m.role) && m.reports_to_id === manager.id);
                                const autoAssignIds = reps.map((r) => r.id);
                                const checked = autoAssignIds.length > 0 && autoAssignIds.every((id) => selectedIds.includes(id));
                                return (
                                  <div key={`manager-group-${manager.id}`} className="px-1 py-1.5">
                                    <DropdownMenuItem
                                      className="pl-2"
                                      onSelect={(e) => {
                                        e.preventDefault();
                                        const ids = new Set(selectedIds);
                                        if (checked) autoAssignIds.forEach((id) => ids.delete(id));
                                        else autoAssignIds.forEach((id) => ids.add(id));
                                        void updateAssignmentsForForm(form, Array.from(ids));
                                      }}
                                    >
                                      <span
                                        className={isGreenChecked(checked)}
                                        title={checked ? "Assigned" : "Click to assign"}
                                      />
                                      Manager: {manager.full_name}
                                    </DropdownMenuItem>
                                    <div className="ml-4 mt-1 space-y-0.5 border-l border-border/70 pl-2">
                                      {reps.length === 0 ? (
                                        <p className="px-2 text-[11px] text-muted-foreground">No sales reps assigned</p>
                                      ) : (
                                        reps.map((rep) => {
                                          const repChecked = selectedIds.includes(rep.id);
                                          return (
                                            <DropdownMenuItem
                                              className="pl-2"
                                              key={rep.id}
                                              onSelect={(e) => {
                                                e.preventDefault();
                                                const ids = repChecked ? selectedIds.filter((id) => id !== rep.id) : [...selectedIds, rep.id];
                                                void updateAssignmentsForForm(form, Array.from(new Set(ids)));
                                              }}
                                            >
                                              <span
                                                className={isGreenChecked(repChecked)}
                                                title={repChecked ? "Assigned" : "Click to assign"}
                                              />
                                              ↳ {rep.full_name}
                                            </DropdownMenuItem>
                                          );
                                        })
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                              {standaloneSalesReps.length > 0 ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuLabel>Standalone Sales Reps</DropdownMenuLabel>
                                  {standaloneSalesReps.map((rep) => {
                                    const checked = selectedIds.includes(rep.id);
                                    return (
                                      <DropdownMenuItem
                                        className="pl-2"
                                        key={rep.id}
                                        onSelect={(e) => {
                                          e.preventDefault();
                                          const ids = checked ? selectedIds.filter((id) => id !== rep.id) : [...selectedIds, rep.id];
                                          void updateAssignmentsForForm(form, Array.from(new Set(ids)));
                                        }}
                                      >
                                        <span
                                          className={isGreenChecked(checked)}
                                          title={checked ? "Assigned" : "Click to assign"}
                                        />
                                        {rep.full_name}
                                      </DropdownMenuItem>
                                    );
                                  })}
                                </>
                              ) : null}
                              {salesManagers.length === 0 && standaloneSalesReps.length === 0 ? (
                                <p className="px-2 py-1 text-xs text-muted-foreground">
                                  No assignable members found.
                                </p>
                              ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      ) : null}
                      {canAssignForms ? (
                      <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                        {assigned.length === 0 ? (
                          <span className="text-xs text-muted-foreground">None</span>
                        ) : (
                          <div className="space-y-1 min-w-0">
                            {assigned.slice(0, 2).map((a) => {
                              const memberRef = a.referral_code || "";
                              const memberLink = `${baseApplyUrl}?form=${encodeURIComponent(form.slug)}${memberRef ? `&ref=${encodeURIComponent(memberRef)}` : ""}`;
                              return (
                                <div key={a.id} className="flex items-center gap-1 min-w-0">
                                  <span className="text-xs truncate" title={a.full_name || a.email || "Member"}>{a.full_name || a.email || "Member"}</span>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Copy assigned link" onClick={() => copy(memberLink, "Assigned link")}>
                                    <LinkIcon className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              );
                            })}
                            {assigned.length > 2 ? <div className="text-[11px] text-muted-foreground">+{assigned.length - 2} more</div> : null}
                          </div>
                        )}
                      </TableCell>
                      ) : null}
                      {canEditForms ? (
                      <TableCell className="align-top text-right" onClick={(e) => e.stopPropagation()}>
                        {canEditFormRow(form) ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Actions">
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Open actions</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onClick={() => openEdit(form)}>
                                <Pencil className="h-3.5 w-3.5 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void toggleFormStatus(form)}>
                                <Power className="h-3.5 w-3.5 mr-2" />
                                {isOn ? "Set Inactive" : "Set Active"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => void deleteForm(form)}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

