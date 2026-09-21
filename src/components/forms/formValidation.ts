/**
 * Response validation shared by Lead forms and Certificate / Offer-letter forms.
 * Modelled on Google Forms "Response validation": text / number / length / regex rules.
 */

export type ValidationKind = "text" | "number" | "length" | "regex";

export type TextValidationOp = "contains" | "not_contains" | "email" | "url";
export type NumberValidationOp =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "eq"
  | "neq"
  | "between"
  | "not_between"
  | "is_number"
  | "whole";
export type LengthValidationOp = "max" | "min";
export type RegexValidationOp = "contains" | "not_contains" | "matches" | "not_matches";

export type ValidationRule = {
  kind?: ValidationKind;
  op?: TextValidationOp | NumberValidationOp | LengthValidationOp | RegexValidationOp | string;
  value?: string;
  value2?: string;
  /** Custom error shown under the field. */
  message?: string;
};

export const VALIDATION_OPS: Record<ValidationKind, Array<{ value: string; label: string; needsValue: boolean; needsValue2?: boolean }>> = {
  text: [
    { value: "contains", label: "Contains", needsValue: true },
    { value: "not_contains", label: "Doesn't contain", needsValue: true },
    { value: "email", label: "Email address", needsValue: false },
    { value: "url", label: "URL", needsValue: false },
  ],
  number: [
    { value: "gt", label: "Greater than", needsValue: true },
    { value: "gte", label: "Greater than or equal to", needsValue: true },
    { value: "lt", label: "Less than", needsValue: true },
    { value: "lte", label: "Less than or equal to", needsValue: true },
    { value: "eq", label: "Equal to", needsValue: true },
    { value: "neq", label: "Not equal to", needsValue: true },
    { value: "between", label: "Between", needsValue: true, needsValue2: true },
    { value: "not_between", label: "Not between", needsValue: true, needsValue2: true },
    { value: "is_number", label: "Is number", needsValue: false },
    { value: "whole", label: "Whole number", needsValue: false },
  ],
  length: [
    { value: "max", label: "Maximum character count", needsValue: true },
    { value: "min", label: "Minimum character count", needsValue: true },
  ],
  regex: [
    { value: "contains", label: "Contains", needsValue: true },
    { value: "not_contains", label: "Doesn't contain", needsValue: true },
    { value: "matches", label: "Matches", needsValue: true },
    { value: "not_matches", label: "Doesn't match", needsValue: true },
  ],
};

export const VALIDATION_KIND_LABELS: Record<ValidationKind, string> = {
  text: "Text",
  number: "Number",
  length: "Length",
  regex: "Regular expression",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const URL_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#].*)?$/i;

/** Older lead forms stored `{ kind: "regex", value: "email" }` / `{ kind: "number" }` / `{ kind: "length", value: "40" }`. */
export function normalizeValidationRule(rule: ValidationRule | null | undefined): ValidationRule | null {
  if (!rule || !rule.kind) return null;
  const r: ValidationRule = { ...rule };
  if (r.kind === "regex" && !r.op && String(r.value || "").toLowerCase() === "email") {
    return { kind: "text", op: "email", message: r.message };
  }
  if (r.kind === "text" && !r.op && String(r.value || "").toLowerCase() === "shuffle") {
    // Legacy hack that abused validation to store "shuffle options": not a validation rule.
    return null;
  }
  if (r.kind === "number" && !r.op) r.op = "is_number";
  if (r.kind === "length" && !r.op) r.op = "max";
  if (r.kind === "regex" && !r.op) r.op = "matches";
  if (r.kind === "text" && !r.op) r.op = "contains";
  return r;
}

export function isEmailRule(rule: ValidationRule | null | undefined): boolean {
  const r = normalizeValidationRule(rule);
  return !!r && r.kind === "text" && r.op === "email";
}

export function isNumberRule(rule: ValidationRule | null | undefined): boolean {
  const r = normalizeValidationRule(rule);
  return !!r && r.kind === "number";
}

function toNum(v: string | undefined): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Returns an error message when `answer` violates `rule`, otherwise null.
 * Empty answers pass here; "required" is checked separately.
 */
export function validateAnswer(rule: ValidationRule | null | undefined, answer: string): string | null {
  const r = normalizeValidationRule(rule);
  if (!r) return null;
  const text = String(answer ?? "");
  if (text.trim() === "") return null;
  const custom = String(r.message || "").trim();
  const fail = (fallback: string) => custom || fallback;
  const v1 = String(r.value ?? "");
  const v2 = String(r.value2 ?? "");

  if (r.kind === "text") {
    switch (r.op) {
      case "contains":
        return v1 && !text.toLowerCase().includes(v1.toLowerCase()) ? fail(`Must contain "${v1}"`) : null;
      case "not_contains":
        return v1 && text.toLowerCase().includes(v1.toLowerCase()) ? fail(`Must not contain "${v1}"`) : null;
      case "email":
        return EMAIL_RE.test(text.trim()) ? null : fail("Enter a valid email address");
      case "url":
        return URL_RE.test(text.trim()) ? null : fail("Enter a valid URL");
      default:
        return null;
    }
  }

  if (r.kind === "number") {
    const n = toNum(text);
    if (n === null) return fail("Enter a number");
    const a = toNum(v1);
    const b = toNum(v2);
    switch (r.op) {
      case "gt":
        return a !== null && !(n > a) ? fail(`Must be greater than ${a}`) : null;
      case "gte":
        return a !== null && !(n >= a) ? fail(`Must be at least ${a}`) : null;
      case "lt":
        return a !== null && !(n < a) ? fail(`Must be less than ${a}`) : null;
      case "lte":
        return a !== null && !(n <= a) ? fail(`Must be at most ${a}`) : null;
      case "eq":
        return a !== null && n !== a ? fail(`Must equal ${a}`) : null;
      case "neq":
        return a !== null && n === a ? fail(`Must not equal ${a}`) : null;
      case "between": {
        if (a === null || b === null) return null;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return n < lo || n > hi ? fail(`Must be between ${lo} and ${hi}`) : null;
      }
      case "not_between": {
        if (a === null || b === null) return null;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return n >= lo && n <= hi ? fail(`Must not be between ${lo} and ${hi}`) : null;
      }
      case "whole":
        return Number.isInteger(n) ? null : fail("Enter a whole number");
      case "is_number":
      default:
        return null;
    }
  }

  if (r.kind === "length") {
    const limit = toNum(v1);
    if (limit === null) return null;
    const len = text.length;
    if (r.op === "min") return len < limit ? fail(`Enter at least ${limit} characters`) : null;
    return len > limit ? fail(`Maximum ${limit} characters (you typed ${len})`) : null;
  }

  if (r.kind === "regex") {
    if (!v1) return null;
    let re: RegExp;
    try {
      re = new RegExp(v1, "i");
    } catch {
      return null; // broken pattern must not block respondents
    }
    const hit = re.test(text);
    const full = new RegExp(`^(?:${v1})$`, "i");
    switch (r.op) {
      case "contains":
        return hit ? null : fail("Answer doesn't match the expected pattern");
      case "not_contains":
        return hit ? fail("Answer contains a disallowed pattern") : null;
      case "not_matches":
        return full.test(text) ? fail("Answer doesn't match the expected format") : null;
      case "matches":
      default:
        return full.test(text) ? null : fail("Answer doesn't match the expected format");
    }
  }
  return null;
}

/** HTML input `type` best matching the rule (browser keyboard hints). */
export function inputTypeForRule(rule: ValidationRule | null | undefined): "email" | "number" | "url" | "text" {
  const r = normalizeValidationRule(rule);
  if (!r) return "text";
  if (r.kind === "text" && r.op === "email") return "email";
  if (r.kind === "text" && r.op === "url") return "url";
  if (r.kind === "number") return "number";
  return "text";
}
