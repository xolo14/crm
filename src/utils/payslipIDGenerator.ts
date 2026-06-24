/**
 * Payslip + Employee code generators.
 *
 * Payslip ID format:  SYNC-PAY-[YYYYMM]-[XXXXX]   e.g. SYNC-PAY-202505-A3K9P
 * Employee code:      SYNC-EMP-[NNN]              e.g. SYNC-EMP-001
 *
 * The suffix alphabet intentionally excludes ambiguous characters (I, O, 0, 1).
 */

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomChar(): string {
  return CHARS.charAt(Math.floor(Math.random() * CHARS.length));
}

export function generatePayslipID(month: string): string {
  const ym = (month || "").replace("-", "").slice(0, 6).padEnd(6, "0");
  const suffix = Array.from({ length: 5 }, randomChar).join("");
  return `SYNC-PAY-${ym}-${suffix}`;
}

export function generateEmployeeCode(index: number): string {
  const n = Math.max(0, Math.floor(Number(index) || 0));
  return `SYNC-EMP-${String(n).padStart(3, "0")}`;
}

/**
 * Splits a payslip ID into its four labelled segments for colour-coded rendering.
 * Returns null on malformed input.
 */
export function parsePayslipID(id: string): { prefix: string; type: string; period: string; suffix: string } | null {
  if (!id) return null;
  const parts = id.split("-");
  if (parts.length !== 4) return null;
  return { prefix: parts[0], type: parts[1], period: parts[2], suffix: parts[3] };
}
