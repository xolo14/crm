import { useEffect, useState } from "react";
import { Loader2, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { FresherMember } from "@/modules/fresherSalary/types";
import {
  DEFAULT_FRESHER_POLICY,
  monthlyGateAmount,
  normalizeFresherPolicy,
  resolveMemberPolicy,
  type FresherOrgPolicy,
} from "@/modules/fresherSalary/policy";
import { SalaryFlowDiagram } from "@/modules/fresherSalary/components/SalaryFlowDiagram";
import { PhaseInputBlock } from "@/modules/fresherSalary/components/PhaseInputBlock";
import { PhaseTimeline } from "@/modules/fresherSalary/components/PhaseTimeline";
import { SalaryTypePill } from "@/modules/fresherSalary/components/SalaryTypePill";
import { PHASE_ACCENTS } from "@/modules/fresherSalary/uiTokens";

type MyProgress = {
  enrolled: boolean;
  joining_date?: string;
  phase_key?: string;
  phase_label?: string;
  window_start?: string | null;
  window_end_exclusive?: string | null;
  target_rupees?: number;
  achieved_rupees?: number;
  remaining_rupees?: number;
  achievement_pct?: number;
  salary_type?: string | null;
  headline_status?: string | null;
  policy?: FresherOrgPolicy;
  member?: FresherMember | null;
};

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/**
 * Read-only Fresher Salary view for enrolled sales reps / managers.
 * Shows current progress + collapsible full flowchart + all phase bars.
 */
export function FresherSalaryTraineeView() {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<MyProgress | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const data = await api.fresherSalary.myProgress();
        if (!cancelled) setProgress(data);
      } catch {
        if (!cancelled) setProgress({ enrolled: false });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!progress?.enrolled) {
    return (
      <div className="-mx-4 min-h-full bg-[#f9fafb] px-4 py-10 md:-mx-6 md:px-6">
        <div className="mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <Target className="mx-auto h-10 w-10 text-gray-300" />
          <h1 className="mt-4 text-xl font-bold text-gray-900">Fresher Salary</h1>
          <p className="mt-2 text-sm text-gray-500">
            You are not enrolled in the fresher training track yet. Ask your org admin to add you on the Fresher Salary
            tracker (pick you from the team list).
          </p>
        </div>
      </div>
    );
  }

  const orgPolicy = normalizeFresherPolicy(progress.policy ?? DEFAULT_FRESHER_POLICY);
  const member = progress.member;
  const policy = resolveMemberPolicy(orgPolicy, member?.salaryTerms);
  const gate = monthlyGateAmount(policy);
  const phaseKey = progress.phase_key || member?.currentPhase || "training";

  return (
    <div className="-mx-4 min-h-full bg-[#f9fafb] px-4 pb-10 pt-2 md:-mx-6 md:px-6 md:pt-4">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-widest text-gray-400">Your training track</p>
          <h1 className="text-2xl font-bold text-gray-900">Fresher Salary</h1>
          <p className="mt-1 text-sm text-gray-500">
            Phases move automatically from your join date. Achieved sales sync from your payment links.
          </p>
          {progress.joining_date ? (
            <p className="mt-1 text-xs text-gray-400">Joined {progress.joining_date}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {member?.salaryType ? <SalaryTypePill type={member.salaryType} /> : null}
            {progress.phase_label ? (
              <Badge variant="secondary" className="font-normal">
                {progress.phase_label}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Target className="h-4 w-4 text-emerald-700" />
            <p className="text-sm font-semibold text-emerald-950">Current phase progress</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-emerald-900/60">Target</p>
              <p className="mt-0.5 text-lg font-bold text-emerald-950">{inr(progress.target_rupees || 0)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-emerald-900/60">Achieved</p>
              <p className="mt-0.5 text-lg font-bold text-emerald-700">{inr(progress.achieved_rupees || 0)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-emerald-900/60">Remaining</p>
              <p className="mt-0.5 text-lg font-bold text-emerald-950">{inr(progress.remaining_rupees || 0)}</p>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80">
            <div
              className="h-2 rounded-full bg-emerald-500 transition-[width] duration-500"
              style={{ width: `${Math.min(100, Math.max(0, progress.achievement_pct || 0))}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-emerald-900/70">
            {progress.achievement_pct ?? 0}% of phase target
            {progress.window_start && progress.window_end_exclusive
              ? ` · ${progress.window_start} → ${progress.window_end_exclusive}`
              : ""}
          </p>
          {progress.headline_status ? (
            <p className="mt-2 text-xs text-emerald-900/80">{progress.headline_status}</p>
          ) : null}
        </div>

        <SalaryFlowDiagram policy={policy} activePhase={phaseKey} compact />

        {member ? (
          <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
            <p className="text-sm font-semibold text-gray-900">All phase progress</p>
            <PhaseTimeline current={member.currentPhase} />
            <PhaseInputBlock
              title={`Training (${policy.training_days} days)`}
              accent={PHASE_ACCENTS.training}
              target={policy.training_target}
              achieved={member.training.achieved}
              disabled
              onAchieved={() => {}}
              help="Synced from payment links in the training window."
              badge={member.training.status}
            />
            <PhaseInputBlock
              title="Month 1"
              accent={PHASE_ACCENTS.month1}
              target={gate}
              achieved={member.month1.achieved}
              disabled
              onAchieved={() => {}}
              help={`Gate ${inr(gate)} (${policy.monthly_gate_percent}% of ${inr(policy.monthly_full_target)}). Met → fixed next; miss → target-based next.`}
              badge={member.month1.status}
            />
            <PhaseInputBlock
              title="Month 2"
              accent={PHASE_ACCENTS.month2}
              target={gate}
              achieved={member.month2.totalAchieved}
              disabled
              onAchieved={() => {}}
              help="Same gate. Missing while on fixed still drops you to target-based next month."
              badge={String(member.month2.status)}
            />
            <PhaseInputBlock
              title="Month 3"
              accent={PHASE_ACCENTS.month3}
              target={gate}
              achieved={member.month3.achieved}
              disabled
              onAchieved={() => {}}
              help="Same rule through probation: achieve → fixed next; miss → target-based next."
              badge={member.month3.status}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
