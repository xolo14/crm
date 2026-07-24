import type { WaConversation } from "@/types/communications";

export function convDisplayName(c: WaConversation): string {
  return (c.contact_name || "").trim() || c.contact_phone || "Unknown";
}

export function previewText(c: WaConversation, max = 40): string {
  const raw = (c.last_message_preview || c.last_message || "").trim();
  if (!raw) return "No messages yet";
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

export function isWindowOpen(c: WaConversation | null | undefined): boolean {
  if (!c) return false;
  if (!(Number(c.window_open) === 1 || c.window_open === true)) return false;
  const exp = c.window_expires_at;
  if (!exp) return true;
  const ts = new Date(exp.includes("T") ? exp : exp.replace(" ", "T")).getTime();
  return !Number.isNaN(ts) && ts > Date.now();
}

export function formatWindowCountdown(expiresAt?: string | null): string {
  if (!expiresAt) return "";
  const ts = new Date(expiresAt.includes("T") ? expiresAt : expiresAt.replace(" ", "T")).getTime();
  if (Number.isNaN(ts)) return "";
  const ms = ts - Date.now();
  if (ms <= 0) return "expired";
  const totalMins = Math.floor(ms / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs <= 0) return `${mins}m`;
  return `${hrs}h ${mins}m`;
}

export function formatMsgTime(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function countTemplateVars(body: string): number {
  const matches = body.match(/\{\{(\d+)\}\}/g) || [];
  const nums = matches.map((m) => Number(m.replace(/\D/g, ""))).filter((n) => n > 0);
  return nums.length ? Math.max(...nums) : 0;
}

/** Prefer {{1}}… placeholders in body; fall back to stored variables length. */
export function templateVarCount(template: { body?: string | null; variables?: unknown } | null | undefined): number {
  if (!template) return 0;
  const fromBody = countTemplateVars(String(template.body || ""));
  if (fromBody > 0) return fromBody;
  const vars = template.variables;
  if (Array.isArray(vars)) return vars.length;
  if (typeof vars === "string") {
    try {
      const parsed = JSON.parse(vars);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

export function fillTemplatePreview(body: string, vars: string[]): string {
  let out = body || "";
  const n = countTemplateVars(out);
  for (let i = 0; i < n; i++) {
    const v = (vars[i] ?? "").trim();
    out = out.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, "g"), v || `{{${i + 1}}}`);
  }
  return out;
}

export function assignableRoleLabel(role?: string): string {
  const r = String(role || "").toLowerCase();
  if (r === "sales_representative" || r === "sales_rep") return "Sales";
  if (r.startsWith("marketing")) return "Marketing";
  return role || "Member";
}
