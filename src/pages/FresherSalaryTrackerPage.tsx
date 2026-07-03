import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MONTHLY_TARGET } from "@/modules/fresherSalary/constants";
import type { FresherPhase, FresherMember } from "@/modules/fresherSalary/types";
import {
  AddMemberForm,
  MemberDetail,
  RulesReferencePanel,
  roleDisplayLabel,
} from "@/modules/fresherSalary/components";
import type { FresherTeamPick } from "@/modules/fresherSalary/components";
import { downloadMembersCsv } from "@/modules/fresherSalary/exportCsv";
import { totalPipelineAchieved, estimateEarnings } from "@/modules/fresherSalary/logic";
import { currentPhaseProgress } from "@/modules/fresherSalary/phaseProgress";
import { nextPhaseLabel } from "@/modules/fresherSalary/uiTokens";
import { useFresherSalaryStore } from "@/modules/fresherSalary/useFresherSalaryStore";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import {
  ChevronDown,
  Download,
  Eye,
  Loader2,
  Mail,
  MoreVertical,
  Pencil,
  Search,
  Target,
  Trash2,
  TrendingUp,
  Users2,
  Wallet,
} from "lucide-react";
import {
  checkAndSendPhaseEmails,
  clearEmailTriggerLog,
  getEmailTriggerRecords,
} from "@/utils/emailTrigger";
import type { EmailTriggerRecord } from "@/types/phaseEmail";

const PICK_ROLES = new Set(["sales_representative"]);
const KPI_TARGET_LS = "fresher_salary_kpi_monthly_target_display_v1";

const PHASE_LABEL: Record<FresherMember["currentPhase"], string> = {
  training: "Training",
  month1: "Month 1",
  month2: "Month 2",
  month3: "Month 3",
  completed: "Completed",
};

function isTeamRowActive(m: { is_active?: number | boolean | string }): boolean {
  return m.is_active === 1 || m.is_active === true || String(m.is_active) === "1";
}

function memberInitials(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

function phaseStatusBadge(member: FresherMember): { label: string; className: string } {
  if (member.currentPhase === "training") {
    return {
      label: "Training",
      className: "border border-blue-100 bg-blue-50 text-blue-700",
    };
  }
  if (member.currentPhase === "completed") {
    return {
      label: "Inactive",
      className: "border border-gray-200 bg-gray-100 text-gray-600",
    };
  }
  if (member.salaryType === "fixed") {
    return {
      label: "On target",
      className: "border border-purple-100 bg-purple-50 text-purple-700",
    };
  }
  return {
    label: "Active",
    className: "border border-emerald-200 bg-[#e6faf0] text-[#0f5230]",
  };
}

export default function FresherSalaryTrackerPage() {
  const { toast } = useToast();
  const { user, role: crmRole, organization } = useAuth();
  const members = useFresherSalaryStore((s) => s.members);
  const hydrateMembers = useFresherSalaryStore((s) => s.hydrateMembers);
  const addMemberStore = useFresherSalaryStore((s) => s.addMember);
  const advancePhaseStore = useFresherSalaryStore((s) => s.advancePhase);
  const removeMemberStore = useFresherSalaryStore((s) => s.removeMember);
  const updatePhaseData = useFresherSalaryStore((s) => s.updatePhaseData);
  const fixedSalary = useFresherSalaryStore((s) => s.fixedSalaryEstimate);
  const setFixedSalary = useFresherSalaryStore((s) => s.setFixedSalaryEstimate);

  const [name, setName] = useState("");
  const [memberRole, setMemberRole] = useState("Sales Executive");
  const [joiningDate, setJoiningDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [traineeUserId, setTraineeUserId] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [subtitleExpanded, setSubtitleExpanded] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(true);
  const lastPersistedMembersJson = useRef<string>("");
  const [kpiMonthlyTarget, setKpiMonthlyTarget] = useState(MONTHLY_TARGET);
  const [kpiTargetHydrated, setKpiTargetHydrated] = useState(false);
  const [kpiTargetEditing, setKpiTargetEditing] = useState(false);
  const [kpiDraft, setKpiDraft] = useState(String(MONTHLY_TARGET));
  const [kpiTargetFlash, setKpiTargetFlash] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [pipelineBarPct, setPipelineBarPct] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmAdvanceId, setConfirmAdvanceId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [emailLogOpen, setEmailLogOpen] = useState(false);
  const [emailLogRecords, setEmailLogRecords] = useState<EmailTriggerRecord[]>(() => getEmailTriggerRecords());

  const authRole = String(crmRole || "").trim().toLowerCase();
  const isSuperAdmin = authRole === "super_admin";
  const switchedOrgId = String(organization?.id || "").trim();

  const { data: teamRows = [], isLoading: teamPicklistLoading } = useQuery({
    queryKey: ["fresher-salary-team-picklist", isSuperAdmin ? switchedOrgId : "tenant", user?.id],
    queryFn: async () => {
      const res = isSuperAdmin && switchedOrgId ? await api.team.list(switchedOrgId) : await api.team.list();
      const data = (res as { data?: FresherTeamPick[] })?.data;
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60_000,
  });

  const fresherPicklist = useMemo(() => {
    const rows = teamRows as Array<FresherTeamPick & { is_active?: number | boolean | string; org_id?: string | null }>;
    return rows.filter((m) => {
      const r = String(m.role || "")
        .trim()
        .toLowerCase();
      if (!PICK_ROLES.has(r)) return false;
      if (!isTeamRowActive(m)) return false;
      if (isSuperAdmin && switchedOrgId) return true;
      if (isSuperAdmin && !switchedOrgId) {
        const uo = String(user?.org_id || "").trim();
        if (uo) return String(m.org_id || "").trim() === uo;
        return false;
      }
      const tenantOrg = String(user?.org_id || organization?.id || "").trim();
      if (!tenantOrg) return true;
      return String(m.org_id || "").trim() === tenantOrg;
    });
  }, [teamRows, isSuperAdmin, switchedOrgId, user?.org_id, organization?.id]);

  const picklistEmptyHint = useMemo(() => {
    if (teamPicklistLoading) return undefined;
    if (isSuperAdmin && !switchedOrgId) {
      return "Switch organisation in the header to load sales reps and team leads for that tenant.";
    }
    return undefined;
  }, [teamPicklistLoading, isSuperAdmin, switchedOrgId]);

  const loadServerRoster = useCallback(async () => {
    setRosterLoading(true);
    try {
      const list = await api.fresherSalary.list();
      const valid = (Array.isArray(list) ? list : []).filter(
        (m): m is FresherMember =>
          m != null &&
          typeof m === "object" &&
          typeof (m as FresherMember).id === "string" &&
          (m as FresherMember).id.length > 0,
      );
      hydrateMembers(valid);
      lastPersistedMembersJson.current = JSON.stringify(valid);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not load fresher roster",
        description: e instanceof Error ? e.message : "Server error",
      });
    } finally {
      setRosterLoading(false);
    }
  }, [hydrateMembers, toast]);

  useEffect(() => {
    void loadServerRoster();
  }, [loadServerRoster, organization?.id, user?.id]);

  const detail = useMemo(() => members.find((m) => m.id === detailId) || null, [members, detailId]);

  const dashboardStats = useMemo(() => {
    const total = members.length;
    const fixed = members.filter((m) => m.salaryType === "fixed" && m.currentPhase !== "completed").length;
    const perf = members.filter(
      (m) =>
        (m.salaryType === "performance" || m.salaryType === "target_based") && m.currentPhase !== "completed",
    ).length;
    const pipeline = members.reduce((s, m) => s + totalPipelineAchieved(m), 0);
    return { total, fixed, perf, pipeline };
  }, [members]);

  const subtitleFull = useMemo(
    () =>
      `Fresher onboarding — 15-day training plus up to three 30-day evaluation months. Track eligibility against ₹${MONTHLY_TARGET.toLocaleString("en-IN")} monthly targets.`,
    [],
  );

  const filteredMembers = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q) ||
        String(m.headlineStatus || "")
          .toLowerCase()
          .includes(q),
    );
  }, [members, teamSearch]);

  const pipelineVsKpiPct = useMemo(() => {
    if (kpiMonthlyTarget <= 0) return 0;
    return Math.min(100, Math.round(((dashboardStats.pipeline / kpiMonthlyTarget) * 1000) / 10));
  }, [dashboardStats.pipeline, kpiMonthlyTarget]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KPI_TARGET_LS);
      if (raw != null) {
        const n = Number(raw);
        if (!Number.isNaN(n) && n >= 0) {
          setKpiMonthlyTarget(n);
          setKpiDraft(String(Math.round(n)));
        }
      }
    } catch {
      /* ignore */
    }
    setKpiTargetHydrated(true);
  }, []);

  useEffect(() => {
    if (!kpiTargetHydrated) return;
    try {
      localStorage.setItem(KPI_TARGET_LS, String(kpiMonthlyTarget));
    } catch {
      /* ignore */
    }
  }, [kpiMonthlyTarget, kpiTargetHydrated]);

  useEffect(() => {
    setPipelineBarPct(0);
    const id = window.requestAnimationFrame(() => {
      setPipelineBarPct(pipelineVsKpiPct);
    });
    return () => window.cancelAnimationFrame(id);
  }, [pipelineVsKpiPct]);

  /** Persist member JSON to fresher_salary_members (debounced — covers manual sheet edits). */
  useEffect(() => {
    if (rosterLoading) return;
    const sig = JSON.stringify(members);
    if (sig === lastPersistedMembersJson.current) return;
    const t = window.setTimeout(() => {
      const current = useFresherSalaryStore.getState().members;
      const s2 = JSON.stringify(current);
      if (s2 === lastPersistedMembersJson.current || current.length === 0) return;
      void (async () => {
        try {
          for (const m of current) {
            await api.fresherSalary.update(m);
          }
          lastPersistedMembersJson.current = s2;
        } catch (e) {
          toast({
            variant: "destructive",
            title: "Could not save roster to server",
            description: e instanceof Error ? e.message : "Update failed",
          });
        }
      })();
    }, 2200);
    return () => window.clearTimeout(t);
  }, [members, rosterLoading, toast]);

  /** Email notification trigger — fires once per page load when roster is ready. */
  useEffect(() => {
    if (rosterLoading || members.length === 0) return;
    checkAndSendPhaseEmails(members, (memberName) => {
      setEmailLogRecords(getEmailTriggerRecords());
      toast({ title: `📧 Progress email sent to ${memberName}` });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterLoading]);

  const addMemberSubmit = async () => {
    const nameTrim = name.trim();
    if (!nameTrim) return;
    setAddSubmitting(true);
    try {
      const tid = traineeUserId.trim();
      addMemberStore(nameTrim, memberRole, joiningDate, memberEmail.trim() || undefined, tid || undefined);
      const created = useFresherSalaryStore.getState().members.at(-1);
      setName("");
      setTraineeUserId("");
      setMemberEmail("");
      if (created) setDetailId(created.id);

      if (created) {
        try {
          await api.fresherSalary.create(created);
          lastPersistedMembersJson.current = JSON.stringify(useFresherSalaryStore.getState().members);
        } catch (e: unknown) {
          removeMemberStore(created.id);
          if (detailId === created.id) setDetailId(null);
          const msg = e instanceof Error ? e.message : "Could not save member on the server.";
          toast({
            variant: "destructive",
            title: "Could not add member",
            description: msg,
          });
          setAddSubmitting(false);
          return;
        }
      }

      if (tid) {
        try {
          await api.fresherSalary.registerTraineeJoin({ trainee_user_id: tid, joining_date: joiningDate });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Could not save training start on the server.";
          toast({
            variant: "destructive",
            title: "Server join date",
            description: msg,
          });
        }
      }

      toast({
        title: "Added to training",
        description: tid
          ? `${nameTrim} was saved to the server. Their training start date is now linked.`
          : `${nameTrim} was saved to the server. Pick from the team list next time to link their CRM user.`,
      });
    } finally {
      setAddSubmitting(false);
    }
  };

  const handleExport = async () => {
    setExportLoading(true);
    toast({ title: "Exporting data...", description: "Preparing your CSV." });
    try {
      await Promise.resolve();
      downloadMembersCsv(members, fixedSalary);
      toast({ title: "CSV downloaded", description: "Your export should begin shortly." });
    } finally {
      setExportLoading(false);
    }
  };

  const commitKpiTargetEdit = () => {
    const n = Math.max(0, Math.round(Number(kpiDraft) || 0));
    const changed = n !== kpiMonthlyTarget;
    setKpiMonthlyTarget(n);
    setKpiDraft(String(n));
    setKpiTargetEditing(false);
    if (changed) {
      setKpiTargetFlash(true);
      window.setTimeout(() => setKpiTargetFlash(false), 600);
      toast({ title: "Target updated", description: `Display target set to ₹${n.toLocaleString("en-IN")}.` });
    }
  };

  const advanceMember = members.find((m) => m.id === confirmAdvanceId) ?? null;
  const removeMember = members.find((m) => m.id === confirmRemoveId) ?? null;

  const glass = "rounded-xl border border-gray-200 bg-white shadow-sm";

  const subtitleShort = subtitleFull.slice(0, 60);
  const showReadMore = subtitleFull.length > 60 && !subtitleExpanded;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="-mx-4 min-h-full bg-[#f9fafb] px-4 pb-10 pt-2 md:-mx-6 md:px-6 md:pt-4">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Page header */}
          <div className="mb-6 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs font-medium uppercase tracking-widest text-gray-400">Internal · HR &amp; Sales</p>
              <h1 className="text-2xl font-bold text-gray-900">Sales Salary Tracker</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                {rosterLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#0f5230]" aria-hidden />
                    Loading roster from server…
                  </>
                ) : (
                  <span className="text-emerald-900/80">Members are saved to the server for your organisation.</span>
                )}
              </p>
              <p className="mt-1 max-w-xl text-sm text-gray-500">
                {subtitleExpanded ? subtitleFull : subtitleShort}
                {showReadMore ? "…" : null}
                {subtitleFull.length > 60 ? (
                  <button
                    type="button"
                    className="ml-1 text-xs font-medium text-[#0f5230] hover:underline"
                    onClick={() => setSubtitleExpanded((v) => !v)}
                  >
                    {subtitleExpanded ? " Show less" : " Read more"}
                  </button>
                ) : null}
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[320px]">
              <Button
                type="button"
                variant="outline"
                disabled={members.length === 0 || exportLoading}
                onClick={() => void handleExport()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm hover:bg-gray-50"
              >
                {exportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 shrink-0" />}
                Export to CSV
              </Button>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div
                  className={cn(
                    "min-w-[160px] rounded-xl border border-gray-200 bg-white p-3 transition-shadow",
                    kpiTargetFlash && "ring-2 ring-emerald-400/60",
                  )}
                >
                  <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Monthly target</p>
                  {kpiTargetEditing ? (
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      className="mt-1 h-9 border-0 p-0 text-xl font-bold text-gray-900 shadow-none focus-visible:ring-0"
                      value={kpiDraft}
                      onChange={(e) => setKpiDraft(e.target.value)}
                      onBlur={() => commitKpiTargetEdit()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") {
                          setKpiDraft(String(kpiMonthlyTarget));
                          setKpiTargetEditing(false);
                        }
                      }}
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      className="mt-1 block w-full text-left text-xl font-bold text-gray-900 transition-colors hover:text-[#0f5230]"
                      onClick={() => {
                        setKpiDraft(String(kpiMonthlyTarget));
                        setKpiTargetEditing(true);
                      }}
                    >
                      ₹{kpiMonthlyTarget.toLocaleString("en-IN")}
                    </button>
                  )}
                </div>
                <div className="min-w-[160px] rounded-xl border border-gray-200 bg-white p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Fixed salary (est.)</p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-sm text-gray-400">₹</span>
                    <Input
                      type="number"
                      min={0}
                      step={500}
                      className="h-auto border-0 p-0 text-xl font-bold text-gray-900 shadow-none focus-visible:ring-0"
                      value={fixedSalary}
                      onChange={(e) => setFixedSalary(+e.target.value || 0)}
                    />
                    <span className="text-xs text-gray-400">/ mo</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* KPI row */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-150 ease-out hover:-translate-y-px hover:shadow-md">
              <div className="flex items-start justify-between">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e6f0fb]">
                  <Users2 className="h-4 w-4 text-blue-500" strokeWidth={2} />
                </div>
              </div>
              <p className="mt-3 text-3xl font-bold text-gray-900">{dashboardStats.total}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Total members</p>
              <p className="mt-2 text-xs text-gray-400">Active in program</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-150 ease-out hover:-translate-y-px hover:shadow-md">
              <div className="flex items-start justify-between">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#faeeda]">
                  <Wallet className="h-4 w-4 text-amber-500" strokeWidth={2} />
                </div>
              </div>
              <p className="mt-3 text-3xl font-bold text-gray-900">{dashboardStats.fixed}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">On fixed salary</p>
              <p className="mt-2 text-xs text-gray-400">Drawing ₹{fixedSalary.toLocaleString("en-IN")}/mo</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-150 ease-out hover:-translate-y-px hover:shadow-md">
              <div className="flex items-start justify-between">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eeedfe]">
                  <TrendingUp className="h-4 w-4 text-violet-500" strokeWidth={2} />
                </div>
              </div>
              <p className="mt-3 text-3xl font-bold text-gray-900">{dashboardStats.perf}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Performance / target</p>
              <p className="mt-2 text-xs text-gray-400">Members on target track</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-150 ease-out hover:-translate-y-px hover:shadow-md">
              <div className="flex items-start justify-between">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e6faf0]">
                  <Target className="h-4 w-4 text-[#2ed573]" strokeWidth={2} />
                </div>
              </div>
              <p className="mt-3 text-3xl font-bold text-gray-900">
                ₹{dashboardStats.pipeline.toLocaleString("en-IN")}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Pipeline achieved</p>
              <p className="mt-2 text-xs text-gray-400">
                vs ₹{kpiMonthlyTarget.toLocaleString("en-IN")} display target
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-1.5 rounded-full bg-[#2ed573] transition-[width] duration-[600ms] ease-out"
                  style={{ width: `${pipelineBarPct}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-gray-400">{pipelineVsKpiPct}% of display target</p>
            </div>
          </div>

          <RulesReferencePanel />

          <AddMemberForm
            name={name}
            role={memberRole}
            joiningDate={joiningDate}
            picklist={fresherPicklist}
            picklistLoading={teamPicklistLoading}
            picklistEmptyHint={picklistEmptyHint}
            submitting={addSubmitting}
            onPickMember={(m) => {
              setName(m.full_name);
              setMemberRole(roleDisplayLabel(m.role));
              setTraineeUserId(String(m.id || "").trim());
              setMemberEmail(String(m.email || "").trim());
            }}
            onRoleChange={setMemberRole}
            onJoiningDateChange={setJoiningDate}
            onSubmit={() => void addMemberSubmit()}
          />

          {/* Team table */}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900">Team</h2>
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                  {members.length}
                </span>
              </div>
              <div className="relative w-full sm:w-48">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder="Search members…"
                  value={teamSearch}
                  onChange={(e) => setTeamSearch(e.target.value)}
                  className="h-9 rounded-lg border border-gray-200 pl-8 text-sm focus-visible:ring-2 focus-visible:ring-[#2ed573]/30"
                />
              </div>
            </div>

            {members.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                  <Users2 className="h-5 w-5 text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-600">No team members yet</p>
                <p className="mt-1 text-xs text-gray-400">Add your first fresher member above</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead className="border-b border-gray-100 bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Salary
                      </th>
                      <th className="hidden px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 md:table-cell">
                        Pipeline
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMembers.map((m, idx) => {
                      const cp = currentPhaseProgress(m);
                      const est = estimateEarnings(m, fixedSalary);
                      const badge = phaseStatusBadge(m);
                      const initials = memberInitials(m.name);
                      return (
                        <tr
                          key={m.id}
                          className={cn(
                            "border-b border-gray-100 transition-colors duration-100 last:border-0",
                            idx % 2 === 1 ? "bg-gray-50/30" : "bg-white",
                            "hover:bg-[#f0fdf6]",
                          )}
                        >
                          <td className="px-6 py-4 text-sm text-gray-700">
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e6faf0] text-xs font-bold text-[#0f5230]">
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-gray-900">{m.name || "?"}</p>
                                <p className="truncate text-xs text-gray-400">{m.role}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", badge.className)}>
                                {badge.label}
                              </span>
                              <span className="text-[10px] text-gray-400">{PHASE_LABEL[m.currentPhase]}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm font-semibold text-gray-900">
                            ₹{est.total.toLocaleString("en-IN")}
                          </td>
                          <td className="hidden px-6 py-4 md:table-cell">
                            <span className="font-semibold text-gray-900">
                              ₹{cp.achieved.toLocaleString("en-IN")}
                            </span>
                            <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-gray-100">
                              <div
                                className="h-1 rounded-full bg-[#2ed573] transition-[width] duration-[600ms] ease-out"
                                style={{ width: `${Math.min(cp.pct, 100)}%` }}
                              />
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-0.5">
                              <div className="hidden items-center gap-0.5 md:flex">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      title="View details"
                                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                                      onClick={() => setDetailId(m.id)}
                                    >
                                      <Eye className="h-[15px] w-[15px]" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>View details</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      title="Edit"
                                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                                      onClick={() => setDetailId(m.id)}
                                    >
                                      <Pencil className="h-[15px] w-[15px]" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      title="Remove"
                                      className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500"
                                      onClick={() => setConfirmRemoveId(m.id)}
                                    >
                                      <Trash2 className="h-[15px] w-[15px]" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>Remove</TooltipContent>
                                </Tooltip>
                              </div>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" aria-label="More actions">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setDetailId(m.id)}>View details</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setDetailId(m.id)}>Edit</DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setConfirmRemoveId(m.id)}
                                  >
                                    Remove
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredMembers.length === 0 && members.length > 0 ? (
                  <p className="px-6 py-8 text-center text-sm text-gray-500">No members match your search.</p>
                ) : null}
              </div>
            )}
          </div>

          {/* ── Email Notification Log ────────────────────────────────── */}
          <div className="mt-5 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <button
              type="button"
              className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-gray-50/80"
              onClick={() => setEmailLogOpen((o) => !o)}
            >
              <span className="flex items-center gap-2">
                <Mail className="h-4 w-4 shrink-0 text-[#2ed573]" aria-hidden />
                <span className="text-sm font-semibold text-gray-700">Email Notifications</span>
                <span className="ml-1 rounded-full bg-[#e6faf0] px-2 py-0.5 text-xs font-semibold text-[#0f5230]">
                  {emailLogRecords.filter((r) => r.success).length} sent
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${emailLogOpen ? "rotate-180" : ""}`}
              />
            </button>
            {emailLogOpen && (
              <div className="border-t border-gray-100 px-5 pb-5 pt-3">
                {emailLogRecords.length === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-400">
                    No emails sent yet. Emails trigger automatically on days 10, 15, and 30 of each phase.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                          <th className="pb-2 pr-4">Member</th>
                          <th className="pb-2 pr-4">Phase</th>
                          <th className="pb-2 pr-4">Trigger Day</th>
                          <th className="pb-2 pr-4">Sent At</th>
                          <th className="pb-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emailLogRecords.map((r, i) => (
                          <tr key={i} className="border-b border-gray-50 last:border-0">
                            <td className="py-2 pr-4 font-medium text-gray-800">{r.memberName || "—"}</td>
                            <td className="py-2 pr-4 text-gray-600">{r.phaseName || `Phase ${r.phase}`}</td>
                            <td className="py-2 pr-4 text-gray-600">Day {r.triggerDay}</td>
                            <td className="py-2 pr-4 text-gray-400 text-xs">
                              {r.sentAt ? new Date(r.sentAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}
                            </td>
                            <td className="py-2">
                              {r.success ? (
                                <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">✅ Sent</span>
                              ) : (
                                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">❌ Failed</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <button
                    type="button"
                    className="text-xs text-gray-400 underline underline-offset-2 hover:text-gray-600"
                    onClick={() => {
                      clearEmailTriggerLog();
                      setEmailLogRecords([]);
                    }}
                  >
                    Reset email log
                  </button>
                </div>
              </div>
            )}
          </div>

          <AlertDialog open={!!confirmAdvanceId} onOpenChange={(o) => !o && setConfirmAdvanceId(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Advance phase?</AlertDialogTitle>
                <AlertDialogDescription>
                  {advanceMember && (
                    <>
                      Move <strong>{advanceMember.name}</strong> from <strong>{advanceMember.currentPhase}</strong> to{" "}
                      <strong>{nextPhaseLabel(advanceMember.currentPhase)}</strong>? This updates their salary track based on
                      rules.
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-[#2ed573] font-semibold text-[#0f2318] hover:bg-[#26c968]"
                  onClick={() => {
                    void (async () => {
                      if (!confirmAdvanceId) return;
                      const res = advancePhaseStore(confirmAdvanceId);
                      setConfirmAdvanceId(null);
                      if ("reason" in res) {
                        toast({
                          variant: "destructive",
                          title: "Cannot advance",
                          description: res.reason,
                        });
                        return;
                      }
                      try {
                        await api.fresherSalary.update(res.member);
                        lastPersistedMembersJson.current = JSON.stringify(useFresherSalaryStore.getState().members);
                        toast({
                          title: "Phase advanced",
                          description: `Now at ${formatPhaseToast(res.member.currentPhase)}.`,
                        });
                      } catch (e) {
                        toast({
                          variant: "destructive",
                          title: "Phase updated locally only",
                          description: e instanceof Error ? e.message : "Server save failed — retry from the sheet.",
                        });
                      }
                    })();
                  }}
                >
                  Confirm advance
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={!!confirmRemoveId} onOpenChange={(o) => !o && setConfirmRemoveId(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove member?</AlertDialogTitle>
                <AlertDialogDescription>
                  {removeMember && (
                    <>
                      Remove <strong>{removeMember.name}</strong> from this tracker? This cannot be undone from the UI.
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    void (async () => {
                      if (!confirmRemoveId) return;
                      const id = confirmRemoveId;
                      setConfirmRemoveId(null);
                      try {
                        await api.fresherSalary.remove(id);
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : "";
                        if (!msg.includes("Not found") && !msg.includes("404")) {
                          toast({
                            variant: "destructive",
                            title: "Could not remove from server",
                            description: msg || "Delete failed",
                          });
                          return;
                        }
                      }
                      removeMemberStore(id);
                      if (detailId === id) setDetailId(null);
                      lastPersistedMembersJson.current = JSON.stringify(useFresherSalaryStore.getState().members);
                      toast({ title: "Member removed", description: "Removed from the server roster." });
                    })();
                  }}
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Sheet open={!!detail} onOpenChange={(o) => !o && setDetailId(null)}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
              {detail && (
                <MemberDetail
                  member={detail}
                  glass={glass}
                  onRequestAdvance={() => setConfirmAdvanceId(detail.id)}
                  onRequestRemove={() => setConfirmRemoveId(detail.id)}
                />
              )}
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </TooltipProvider>
  );
}

function formatPhaseToast(p: FresherPhase): string {
  if (p === "completed") return "completed";
  return p;
}
