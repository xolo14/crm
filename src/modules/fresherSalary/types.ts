export type FresherPhase = 'training' | 'month1' | 'month2' | 'month3' | 'completed';

export type SalaryType = 'fixed' | 'performance' | 'target_based';

export type SubStatus = 'pending' | 'passed' | 'failed';

export interface TrainingBlock {
  achieved: number;
  target: 30000;
  /** Training is unpaid per business rules. */
  isPaid: false;
  status: SubStatus;
}

export interface Month1Block {
  achieved: number;
  target: 160000;
  status: 'pending' | 'fixed_eligible' | 'performance';
}

export interface Month2First10 {
  achieved: number;
  target: 50000;
  status: SubStatus;
}

export interface Month2Next15 {
  achieved: number;
  target: 80000;
  status: SubStatus;
}

export type Month2AggregateStatus =
  | 'pending'
  | 'full_fixed'
  | 'target_based'
  | 'disqualified'
  | 'fixed_eligible_month3';

export interface Month2Block {
  first10Days: Month2First10;
  next15Days: Month2Next15;
  /** Total sales across full 30 days of Month 2. */
  totalAchieved: number;
  status: Month2AggregateStatus;
}

export type Month3Status = 'pending' | 'confirmed' | 'probation' | 'performance';

export interface Month3Block {
  achieved: number;
  target: 160000;
  status: Month3Status;
}

export interface FresherMember {
  id: string;
  name: string;
  role: string;
  joiningDate: string;
  /** When added from CRM team picklist — used for training invite email. */
  email?: string | null;
  /** CRM user id when picked from team list — used to link join date on server. */
  trainee_user_id?: string | null;
  currentPhase: FresherPhase;
  salaryType: SalaryType;
  training: TrainingBlock;
  month1: Month1Block;
  month2: Month2Block;
  month3: Month3Block;
  /** Latest computed headline from business rules. */
  headlineStatus: string;
}
