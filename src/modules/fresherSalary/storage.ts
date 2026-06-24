import { STORAGE_KEY } from './constants';
import type { FresherMember } from './types';
import { recomputeMember } from './logic';

export function loadMembers(): FresherMember[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row: FresherMember) => recomputeMember(row));
  } catch {
    return [];
  }
}

export function saveMembers(members: FresherMember[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(members));
  } catch {
    /* ignore quota */
  }
}
