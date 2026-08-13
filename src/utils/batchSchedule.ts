export type BatchScheduleStatus = 'upcoming' | 'active' | 'completed';

/** Parse Y-m-d; rejects blank, 0000-00-00, and invalid calendar dates. */
export function parseScheduleDate(value: string | null | undefined): Date | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  if (iso.startsWith('0000-')) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Guard against JS accepting nonsense like 2026-13-40 via overflow
  const [y, m, day] = iso.split('-').map(Number);
  if (d.getFullYear() !== y || d.getMonth() + 1 !== m || d.getDate() !== day) return null;
  return d;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** upcoming → before start; active → between start and end (inclusive); completed → after end. */
export function batchScheduleStatus(
  startDate?: string | null,
  endDate?: string | null,
  today: Date = startOfToday(),
): BatchScheduleStatus {
  const start = parseScheduleDate(startDate);
  const end = parseScheduleDate(endDate);

  if (start && today < start) return 'upcoming';
  // Only complete when end date is a real past date (ignore 0000-00-00 / Invalid Date).
  if (end && today > end) return 'completed';
  if (start && today >= start) return 'active';
  if (end && today <= end) return 'active';

  return 'upcoming';
}

export function batchStatusLabel(status: string): string {
  if (status === 'active') return 'Active';
  if (status === 'completed') return 'Completed';
  return 'Upcoming';
}

/** Safe locale date for tables; blank / 0000-00-00 / invalid → null. */
export function formatBatchDate(value?: string | null): string | null {
  const d = parseScheduleDate(value);
  return d ? d.toLocaleDateString() : null;
}

/** L1 sales reps: view-only list of upcoming + all active batches (for enrollment). */
export const BATCH_READ_ONLY_ROLES = ['sales_representative'] as const;

/** True when a batch is enrollable: upcoming or active (schedule or stored status). */
export function isOpenBatchSchedule(
  startDate?: string | null,
  endDate?: string | null,
  storedStatus?: string | null,
  ref: Date = startOfToday(),
): boolean {
  const stored = String(storedStatus || '').trim().toLowerCase();
  if (stored === 'active' || stored === 'upcoming') return true;
  const status = batchScheduleStatus(startDate, endDate, ref);
  return status === 'upcoming' || status === 'active';
}

/** Display badge for sales: prefer stored active, else schedule. */
export function batchSalesDisplayStatus(
  startDate?: string | null,
  endDate?: string | null,
  storedStatus?: string | null,
  today: Date = startOfToday(),
): BatchScheduleStatus {
  const schedule = batchScheduleStatus(startDate, endDate, today);
  const stored = String(storedStatus || '').trim().toLowerCase();

  // Real schedule wins when dates are valid.
  if (schedule === 'active') return 'active';
  if (schedule === 'upcoming') return 'upcoming';

  // Stored active still enrollable even if dates were bad / previously demoted.
  if (stored === 'active') return 'active';
  if (stored === 'upcoming') return 'upcoming';

  return schedule;
}
