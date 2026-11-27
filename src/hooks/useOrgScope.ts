import { useCallback, useSyncExternalStore } from "react";

/**
 * Super-admin organization scope shared by the header switcher and every page
 * that filters by organization. "all" = every organization.
 *
 * Persisted in localStorage (survives refresh) and mirrored into the `?org=`
 * query parameter so a shared link opens the same view.
 */
export const ORG_SCOPE_ALL = "all";
const STORAGE_KEY = "crm_org_scope";
const listeners = new Set<() => void>();

function readUrlScope(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = new URLSearchParams(window.location.search).get("org");
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function readStoredScope(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? v.trim() : ORG_SCOPE_ALL;
  } catch {
    return ORG_SCOPE_ALL;
  }
}

let current: string = readUrlScope() ?? readStoredScope();

function writeUrl(value: string) {
  try {
    const url = new URL(window.location.href);
    if (value === ORG_SCOPE_ALL) url.searchParams.delete("org");
    else url.searchParams.set("org", value);
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    /* ignore */
  }
}

export function setOrgScope(value: string) {
  const next = String(value || "").trim() || ORG_SCOPE_ALL;
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage unavailable: keep in memory */
  }
  writeUrl(next);
  listeners.forEach((l) => l());
}

/** Re-apply `?org=` after an in-app navigation dropped it. */
export function syncOrgScopeToUrl() {
  if (current !== ORG_SCOPE_ALL && readUrlScope() !== current) writeUrl(current);
}

export function getOrgScope(): string {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `[scope, setScope]` — scope is "all" or an organization id. */
export function useOrgScope(): [string, (value: string) => void] {
  const scope = useSyncExternalStore(subscribe, getOrgScope, getOrgScope);
  const set = useCallback((v: string) => setOrgScope(v), []);
  return [scope, set];
}

function viewerIsSuperAdmin(): boolean {
  try {
    const raw = localStorage.getItem("auth_user");
    const role = raw ? String(JSON.parse(raw)?.role || "") : "";
    return role.toLowerCase().replace(/[^a-z]/g, "") === "superadmin";
  } catch {
    return false;
  }
}

/** Endpoints that must never be narrowed to the picked org (sign-in, the org list itself). */
const ORG_SCOPE_SKIP = /(^|\/)(auth|hr_auth|organizations)\.php/i;

/**
 * Adds `org_id=<picked org>` to a super admin's read (GET) requests, so every page
 * follows the header organization picker without wiring it page by page.
 * Writes, requests that already name an org, and "All organizations" are left unchanged.
 */
export function withOrgScope(endpoint: string, method?: string): string {
  if (current === ORG_SCOPE_ALL) return endpoint;
  if (String(method || "GET").toUpperCase() !== "GET") return endpoint;
  if (ORG_SCOPE_SKIP.test(endpoint) || /[?&]org_id=/.test(endpoint)) return endpoint;
  if (!viewerIsSuperAdmin()) return endpoint;
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}org_id=${encodeURIComponent(current)}`;
}

/** Org id for API calls: undefined when the scope is "all". */
export function orgScopeParam(scope: string): string | undefined {
  return scope && scope !== ORG_SCOPE_ALL ? scope : undefined;
}
