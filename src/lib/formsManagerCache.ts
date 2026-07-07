/** Org-scoped Form Management list cache (avoid showing another tenant's forms). */
export function formsManagerCacheKey(role: string, orgId: string | null | undefined): string {
  const r = String(role || "unknown").trim().toLowerCase();
  const o = orgId ? String(orgId).trim() : "master";
  return `forms_manager_cache_v3_${r}_${o}`;
}

export function clearFormsManagerCache(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("forms_manager_cache")) {
        keys.push(k);
      }
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
