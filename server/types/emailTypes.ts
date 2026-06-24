export interface PhaseProgress {
  phaseNumber: number;
  phaseName: string;
  dayInPhase: number;
  totalDaysInPhase: number;
  startDate: string;
  endDate: string;
  isPhaseComplete: boolean;
}

export interface MemberTarget {
  monthlyTarget: number;
  achieved: number;
  remaining: number;
  achievementPct: number;
}

export interface PhaseEmailPayload {
  memberName: string;
  memberEmail: string;
  memberRole: string;
  joiningDate: string;
  phase: PhaseProgress;
  target: MemberTarget;
  totalCalls: number;
  totalDemos: number;
  totalFollowUps: number;
  totalEnrolled: number;
  nextPhase?: {
    phaseNumber: number;
    phaseName: string;
    targetAmount: number;
    durationDays: number;
    startDate: string;
  };
  triggerDay: 10 | 15 | 30;
  sentAt: string;
}

export interface SendEmailRequest {
  payload: PhaseEmailPayload;
}

export interface SendEmailResponse {
  success: boolean;
  message: string;
  messageId?: string;
}
