/**
 * Payslip domain types and helpers.
 *
 * Salary follows a fixed CTC split:
 *   Basic 40% · HRA 20% · Special 30% · Other 10% (all of monthly CTC).
 * Deductions: PF (12% of basic, employee + employer mirrored), PT (₹200 flat),
 * TDS and other deductions are manually editable. Net = gross − total deductions.
 */

// ── Employee ────────────────────────────────────────────────────────────────
export interface Employee {
  id: string;
  employeeCode: string; // e.g. SYNC-EMP-001
  name: string;
  designation: string;
  department: string;
  email: string;
  phone: string;
  panNumber: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  ctc: number; // annual CTC in INR
  pfApplicable: boolean;
  ptApplicable: boolean;
  joiningDate: string; // YYYY-MM-DD
  createdAt: string; // ISO datetime
}

// ── Salary breakdown ───────────────────────────────────────────────────────
export interface SalaryComponents {
  basic: number;
  hra: number;
  specialAllowance: number;
  otherAllowance: number;
  grossEarnings: number;

  pfEmployee: number;
  pfEmployer: number;
  professionalTax: number;
  tds: number;
  otherDeductions: number;
  totalDeductions: number;

  netPay: number;
}

// ── Payslip ────────────────────────────────────────────────────────────────
export type PayslipStatus = "draft" | "generated" | "sent";

export interface Payslip {
  id: string; // SYNC-PAY-YYYYMM-XXXXX
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  designation: string;
  department: string;
  panNumber: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  month: string; // YYYY-MM
  monthLabel: string; // "May 2025"
  components: SalaryComponents;
  pfApplicable: boolean;
  ptApplicable: boolean;
  workingDays: number;
  paidDays: number;
  generatedBy: string;
  generatedAt: string; // ISO datetime
  status: PayslipStatus;
}

// ── CTC Split Utility ──────────────────────────────────────────────────────
export function calculateSalaryComponents(
  annualCTC: number,
  paidDays: number,
  workingDays: number,
  pfApplicable: boolean,
  ptApplicable: boolean,
  tds: number = 0,
  otherDeductions: number = 0,
): SalaryComponents {
  const safeCTC = Math.max(0, Number(annualCTC) || 0);
  const safeWorking = Math.max(1, Number(workingDays) || 1);
  const safePaid = Math.min(safeWorking, Math.max(0, Number(paidDays) || 0));
  const monthlyCTC = safeCTC / 12;
  const factor = safePaid / safeWorking;

  const basic = Math.round(monthlyCTC * 0.4 * factor);
  const hra = Math.round(monthlyCTC * 0.2 * factor);
  const special = Math.round(monthlyCTC * 0.3 * factor);
  const other = Math.round(monthlyCTC * 0.1 * factor);
  const gross = basic + hra + special + other;

  const pfEmp = pfApplicable ? Math.round(basic * 0.12) : 0;
  const pfEr = pfApplicable ? Math.round(basic * 0.12) : 0;
  // PT prorates only if no days were paid (i.e., absent entire month).
  const pt = ptApplicable && safePaid > 0 ? 200 : 0;
  const safeTds = Math.max(0, Number(tds) || 0);
  const safeOther = Math.max(0, Number(otherDeductions) || 0);
  const totalDed = pfEmp + pt + safeTds + safeOther;
  const netPay = gross - totalDed;

  return {
    basic,
    hra,
    specialAllowance: special,
    otherAllowance: other,
    grossEarnings: gross,
    pfEmployee: pfEmp,
    pfEmployer: pfEr,
    professionalTax: pt,
    tds: safeTds,
    otherDeductions: safeOther,
    totalDeductions: totalDed,
    netPay,
  };
}

// ── Amount in Words (Indian numbering: lakhs/crores) ───────────────────────
const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigit(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return TENS[t] + (u ? "-" + ONES[u] : "");
}

function threeDigit(n: number): string {
  if (n === 0) return "";
  const h = Math.floor(n / 100);
  const r = n % 100;
  const hStr = h ? ONES[h] + " Hundred" : "";
  const rStr = twoDigit(r);
  if (hStr && rStr) return `${hStr} and ${rStr}`;
  return hStr || rStr;
}

/**
 * Returns "Rupees ... Only" using the Indian numbering system.
 * Examples:
 *   45250 -> "Rupees Forty Thousand Two Hundred and Fifty Only"
 *   12345678 -> "Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred and Seventy-Eight Only"
 */
export function amountInWords(amount: number): string {
  let n = Math.round(Math.max(0, Number(amount) || 0));
  if (n === 0) return "Rupees Zero Only";

  const parts: string[] = [];

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  if (crore) parts.push(`${twoDigit(crore) || ONES[crore]} Crore`);

  const lakh = Math.floor(n / 100000);
  n %= 100000;
  if (lakh) parts.push(`${twoDigit(lakh) || ONES[lakh]} Lakh`);

  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (thousand) parts.push(`${twoDigit(thousand) || ONES[thousand]} Thousand`);

  const rest = threeDigit(n);
  if (rest) parts.push(rest);

  return `Rupees ${parts.join(" ")} Only`;
}

// ── Currency formatter (Indian grouping) ───────────────────────────────────
export function formatINR(amount: number): string {
  const v = Math.round(Number(amount) || 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
}
