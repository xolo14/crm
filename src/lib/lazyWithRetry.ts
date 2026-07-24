import { ComponentType, LazyExoticComponent, lazy } from "react";

const CHUNK_RELOAD_KEY = "crm_chunk_reload_v1";

export function isChunkLoadError(error: unknown): boolean {
  const msg = String(
    (error as { message?: string })?.message ||
      (error as { name?: string })?.name ||
      error ||
      "",
  );
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /Loading chunk [\w.-]+ failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    /Loading CSS chunk/i.test(msg)
  );
}

function reloadOnceForStaleChunk(): never {
  try {
    const already = sessionStorage.getItem(CHUNK_RELOAD_KEY);
    if (!already) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
      // Hard reload picks up a fresh index.html with current asset hashes after deploy.
      window.location.reload();
    } else {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    }
  } catch {
    window.location.reload();
  }
  // Suspend forever while the page reloads so React does not flash the error UI.
  throw new Promise(() => undefined);
}

/**
 * Like React.lazy, but retries once on transient network failure and hard-reloads
 * once when a hashed chunk is missing (common right after a production deploy).
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await factory();
      try {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      } catch {
        /* ignore */
      }
      return mod;
    } catch (first) {
      if (!isChunkLoadError(first)) {
        throw first;
      }
      // Brief delay + retry (covers flaky mobile networks).
      await new Promise((r) => setTimeout(r, 400));
      try {
        const mod = await factory();
        try {
          sessionStorage.removeItem(CHUNK_RELOAD_KEY);
        } catch {
          /* ignore */
        }
        return mod;
      } catch (second) {
        if (isChunkLoadError(second)) {
          reloadOnceForStaleChunk();
        }
        throw second;
      }
    }
  });
}
