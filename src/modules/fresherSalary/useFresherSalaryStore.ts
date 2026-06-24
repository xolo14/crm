import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ZUSTAND_STORAGE_KEY } from './constants';
import type { FresherMember } from './types';
import {
  advancePhase as advancePhaseEngine,
  canAdvancePhase,
  createNewMember,
  recomputeMember,
} from './logic';

type FresherSalaryState = {
  members: FresherMember[];
  fixedSalaryEstimate: number;
  /** Replace roster from server GET (org-scoped). */
  hydrateMembers: (members: FresherMember[]) => void;
  addMember: (name: string, role: string, joiningDate: string, email?: string | null, traineeUserId?: string | null) => void;
  updatePhaseData: (id: string, patch: (m: FresherMember) => FresherMember) => void;
  /** Returns false if validation fails (no achieved entered for current phase). */
  advancePhase: (id: string) => { ok: true; member: FresherMember } | { ok: false; reason: string };
  removeMember: (id: string) => void;
  setFixedSalaryEstimate: (n: number) => void;
};

export const useFresherSalaryStore = create<FresherSalaryState>()(
  persist(
    (set, get) => ({
      members: [],
      fixedSalaryEstimate: 15_000,

      hydrateMembers: (members) => set({ members: Array.isArray(members) ? members : [] }),

      addMember: (name, role, joiningDate, email, traineeUserId) => {
        const nm = createNewMember(name, role, joiningDate, email, traineeUserId);
        set((s) => ({ members: [...s.members, nm] }));
      },

      updatePhaseData: (id, patch) => {
        set((s) => ({
          members: s.members.map((m) => (m.id === id ? recomputeMember(patch(m)) : m)),
        }));
      },

      advancePhase: (id) => {
        const m = get().members.find((x) => x.id === id);
        if (!m) return { ok: false, reason: 'Member not found.' };
        if (!canAdvancePhase(m)) {
          return {
            ok: false,
            reason: 'Enter achieved sales for the current phase before advancing.',
          };
        }
        const next = advancePhaseEngine(m);
        set((s) => ({
          members: s.members.map((x) => (x.id === id ? next : x)),
        }));
        return { ok: true, member: next };
      },

      removeMember: (id) => {
        set((s) => ({ members: s.members.filter((m) => m.id !== id) }));
      },

      setFixedSalaryEstimate: (n) => set({ fixedSalaryEstimate: n }),
    }),
    {
      name: ZUSTAND_STORAGE_KEY,
      partialize: (s) => ({
        fixedSalaryEstimate: s.fixedSalaryEstimate,
      }),
    },
  ),
);
