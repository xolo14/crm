/** Load GTM/gtag only on public form pages — never on internal CRM routes. */
let loadPromise: Promise<void> | null = null;

export function loadPublicAnalytics(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (typeof window.gtag === "function") return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[data-syncpedia-analytics="1"]');
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "/analytics-deferred.js";
    s.async = true;
    s.dataset.syncpediaAnalytics = "1";
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });

  return loadPromise;
}
