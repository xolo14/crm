/**
 * One set of number/date formatters for every page (en-IN).
 *   17300        → "17,300"
 *   250232.4     → "₹2,50,232"
 *   pct(93,17300)→ "0.5%"   (one decimal below 10%, whole numbers above)
 *   date         → "18 Nov 2026" / "18 Nov 2026, 3:36 pm"
 */
const INT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function fmtCount(n: number | null | undefined): string {
  return INT.format(Number(n) || 0);
}

export function fmtINR(n: number | null | undefined): string {
  return `₹${INT.format(Math.round(Number(n) || 0))}`;
}

/** Compact rupees for tight tiles: ₹2.5L, ₹1.2Cr, ₹45K. */
export function fmtINRCompact(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (Math.abs(v) >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
}

/** Percentage of part/whole; one decimal below 10% so 0.54% never shows as "1%". */
export function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return fmtPercent((part / whole) * 100);
}

export function fmtPercent(value: number): string {
  const v = Number(value) || 0;
  if (v === 0) return "0%";
  return Math.abs(v) < 10 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
}

function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(typeof v === "string" && /^\d{4}-\d{2}-\d{2} /.test(v) ? v.replace(" ", "T") : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "18 Nov 2026" */
export function fmtDate(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

/** "18 Nov 2026, 3:36 pm" */
export function fmtDateTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  const date = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
  return `${date}, ${time}`;
}

/** Strip invisible characters (U+200B–U+200F, U+2060, U+FEFF) and trim. */
export function cleanName(v: string | null | undefined): string {
  return String(v ?? "").replace(/[​-‏⁠﻿]/g, "").trim();
}

/** "+91 98765 43210" for Indian numbers; anything else is returned trimmed. */
export function fmtPhone(v: string | null | undefined): string {
  const raw = String(v ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 10 ? digits : "";
  return ten ? `+91 ${ten.slice(0, 5)} ${ten.slice(5)}` : raw;
}
