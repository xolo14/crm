import * as React from "react";

/** True below Tailwind `md` (768px). Keep CSS `md:` and shell layout in sync. */
export const MOBILE_BREAKPOINT = 768;

function getIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

/**
 * Matches CSS `@media (max-width: 767px)`.
 * Initial state is detected synchronously in the browser to avoid a desktop→mobile flash.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(getIsMobile);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setIsMobile(getIsMobile());
    mql.addEventListener("change", onChange);
    setIsMobile(getIsMobile());
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
