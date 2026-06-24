export type BatchScheduleStatus = 'upcoming' | 'active' | 'completed';

function parseScheduleDate(value: string | null | undefined): Date | null {
  if (!value || !String(value).trim()) return null;
  const iso = String(value).slice(0, 10);
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
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

/** Team lead / sales reps: view-only list limited to upcoming + active intakes. */
export const BATCH_READ_ONLY_ROLES = ['sales_representative'] as const;

export function isOpenBatchSchedule(
  startDate?: string | null,
  endDate?: string | null,
): boolean {
  const status = batchScheduleStatus(startDate, endDate);
  return status === 'upcoming' || status === 'active';
}
