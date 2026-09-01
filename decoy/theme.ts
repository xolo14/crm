/**
 * DECOY-ONLY theme tokens — distinct from real Syncpedia green.
 * Used so screenshots/alerts are visually identifiable as Layer 1.
 */
export const decoyTheme = {
  name: 'Syncpedia Legacy',
  cssVars: {
    '--decoy-bg': '#0f172a',
    '--decoy-surface': '#1e293b',
    '--decoy-surface-2': '#334155',
    '--decoy-border': '#475569',
    '--decoy-text': '#f1f5f9',
    '--decoy-muted': '#94a3b8',
    '--decoy-accent': '#0d9488',
    '--decoy-accent-hover': '#14b8a6',
    '--decoy-danger': '#f87171',
    '--decoy-warn': '#fbbf24',
  } as Record<string, string>,
};

export function applyDecoyTheme(el: HTMLElement = document.documentElement): void {
  Object.entries(decoyTheme.cssVars).forEach(([k, v]) => el.style.setProperty(k, v));
}
