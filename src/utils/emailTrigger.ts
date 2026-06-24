import type { PhaseEmailPayload, EmailTriggerRecord } from "@/types/phaseEmail";
import type { FresherMember } from "@/modules/fresherSalary/types";
import { currentPhaseProgress } from "@/modules/fresherSalary/phaseProgress";
import {
  getNextPhaseDef,
  getPhaseActivity,
  getPhaseInfoForMember,
  shouldTriggerEmail,
} from "@/utils/phaseCalculator";
import { getApiBase } from "@/lib/apiBase";

const API_BASE = getApiBase();

export const EMAIL_TRIGGER_STORAGE_KEY = "syncpedia_email_triggers";

export async function sendPhaseEmail(payload: PhaseEmailPayload): Promise<boolean> {
  try {
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}/email.php?action=phase_update`, {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify({ payload }),
    });
    const text = await res.text();
    const data = text.trim()
      ? (JSON.parse(text) as { success?: boolean })
      : { success: false };
    return data.success === true;
  } catch (err) {
    console.error("[EMAIL TRIGGER ERROR]", err);
    return false;
  }
}

function storageKey(memberId: string, phase: number, triggerDay: number): string {
  return `${memberId}_p${phase}_d${triggerDay}`;
}

function readRecords(): EmailTriggerRecord[] {
  const raw = localStorage.getItem(EMAIL_TRIGGER_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (r): r is EmailTriggerRecord =>
          r != null &&
          typeof r === "object" &&
          typeof (r as EmailTriggerRecord).memberId === "string",
      );
    }
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, boolean>).map(([key, ok]) => {
        const m = /^(.+)_p(\d+)_d(\d+)$/.exec(key);
        if (!m) return null;
        return {
          memberId: m[1],
          memberName: "—",
          phase: Number(m[2]),
          phaseName: `Phase ${m[2]}`,
          triggerDay: Number(m[3]) as 10 | 15 | 30,
          sentAt: "",
          success: ok === true,
        };
      }).filter((r): r is EmailTriggerRecord => r != null);
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function getEmailTriggerRecords(): EmailTriggerRecord[] {
  return readRecords().sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || ""));
}

export function hasEmailBeenSent(memberId: string, phase: number, triggerDay: number): boolean {
  const key = storageKey(memberId, phase, triggerDay);
  const hit = readRecords().some(
    (r) => storageKey(r.memberId, r.phase, r.triggerDay) === key && r.success,
  );
  if (hit) return true;
  const raw = localStorage.getItem(EMAIL_TRIGGER_STORAGE_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed[key] === true;
  } catch {
    return false;
  }
}

function writeRecord(record: EmailTriggerRecord): void {
  const list = readRecords().filter(
    (r) => storageKey(r.memberId, r.phase, r.triggerDay) !== storageKey(record.memberId, record.phase, record.triggerDay),
  );
  list.unshift(record);
  localStorage.setItem(EMAIL_TRIGGER_STORAGE_KEY, JSON.stringify(list.slice(0, 200)));
}

export function clearEmailTriggerLog(): void {
  localStorage.removeItem(EMAIL_TRIGGER_STORAGE_KEY);
}

export async function checkAndSendPhaseEmails(
  members: FresherMember[],
  onSent?: (memberName: string) => void,
): Promise<void> {
  const now = new Date().toISOString();

  for (const member of members) {
    const memberEmail = (member.email || "").trim();
    if (!memberEmail || !member.joiningDate) continue;
    if (member.currentPhase === "completed") continue;

    const phaseInfo = getPhaseInfoForMember(member);
    if (!phaseInfo) continue;

    const triggerDay = shouldTriggerEmail(
      phaseInfo.dayInPhase,
      phaseInfo.totalDays,
    );
    if (!triggerDay) continue;
    if (hasEmailBeenSent(member.id, phaseInfo.phaseNumber, triggerDay)) continue;

    const prog = currentPhaseProgress(member);
    const activity = getPhaseActivity(member);
    const nextDef = phaseInfo.isPhaseComplete
      ? getNextPhaseDef(member.currentPhase)
      : null;

    let nextPhase: PhaseEmailPayload["nextPhase"];
    if (nextDef) {
      const joined = new Date(
        Number(member.joiningDate.slice(0, 4)),
        Number(member.joiningDate.slice(5, 7)) - 1,
        Number(member.joiningDate.slice(8, 10)),
      );
      const start = new Date(joined);
      start.setDate(joined.getDate() + nextDef.startDay - 1);
      nextPhase = {
        phaseNumber: nextDef.num,
        phaseName: nextDef.name,
        targetAmount: nextDef.target,
        durationDays: nextDef.duration,
        startDate: start.toISOString().slice(0, 10),
      };
    }

    const achieved = prog.achieved;
    const target = prog.target;
    const remaining = Math.max(0, target - achieved);
    const achievementPct = target > 0 ? Math.round((achieved / target) * 100) : 0;

    const payload: PhaseEmailPayload = {
      memberName: member.name,
      memberEmail,
      memberRole: member.role,
      joiningDate: member.joiningDate,
      phase: {
        phaseNumber: phaseInfo.phaseNumber,
        phaseName: phaseInfo.phaseName,
        dayInPhase: phaseInfo.dayInPhase,
        totalDaysInPhase: phaseInfo.totalDays,
        startDate: phaseInfo.startDate.toISOString().slice(0, 10),
        endDate: phaseInfo.endDate.toISOString().slice(0, 10),
        isPhaseComplete: phaseInfo.isPhaseComplete,
      },
      target: {
        monthlyTarget: target,
        achieved,
        remaining,
        achievementPct,
      },
      totalCalls: activity.totalCalls,
      totalDemos: activity.totalDemos,
      totalFollowUps: activity.totalFollowUps,
      totalEnrolled: activity.totalEnrolled,
      nextPhase,
      triggerDay,
      sentAt: now,
    };

    const ok = await sendPhaseEmail(payload);
    writeRecord({
      memberId: member.id,
      memberName: member.name,
      phase: phaseInfo.phaseNumber,
      phaseName: phaseInfo.phaseName,
      triggerDay,
      sentAt: now,
      success: ok,
    });
    if (ok && onSent) onSent(member.name);
  }
}
