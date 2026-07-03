/** Normalize PHP API list responses (`{ data: [...] }` or bare array). */
export function phpList<T = any>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === 'object' && Array.isArray((res as { data?: unknown }).data)) {
    return (res as { data: T[] }).data;
  }
  return [];
}

export function inDateRange(row: { created_at?: string }, from: Date, to: Date): boolean {
  if (!row.created_at) return false;
  const d = new Date(row.created_at);
  return d >= from && d <= to;
}
