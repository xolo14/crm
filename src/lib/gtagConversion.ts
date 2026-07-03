declare global {
  interface Window {
    gtag_report_conversion?: (url?: string) => boolean;
    gtag?: (...args: unknown[]) => void;
  }
}

const LEAD_FORM_CONVERSION = "AW-18146229952/eAfTCK3sxckcEMD95cxD";

/** Fire Google Ads conversion after a successful public lead form submit. */
export function reportLeadFormConversion(): void {
  if (typeof window.gtag_report_conversion === "function") {
    window.gtag_report_conversion();
    return;
  }
  if (typeof window.gtag === "function") {
    window.gtag("event", "conversion", {
      send_to: LEAD_FORM_CONVERSION,
      value: 1.0,
      currency: "INR",
    });
  }
}
