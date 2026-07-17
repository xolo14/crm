import { getApiBase } from "@/lib/apiBase";

const API_BASE = getApiBase();

export function getPaymentLinksApiBase(): string {
  // Direct .php URL — works on Hostinger without depending on /api/payment-links rewrite rules
  return `${API_BASE}/payment-links.php`;
}

/** Build query URL for an action (and optional id). */
export function paymentLinksUrl(
  action?:
    | "list"
    | "create"
    | "fetch"
    | "cancel"
    | "remind"
    | "send_email"
    | "send_form_link"
    | "invoice"
    | "crm_list"
    | "webhook",
  id?: string,
  extraQuery?: Record<string, string>,
): string {
  const base = getPaymentLinksApiBase();
  const params = new URLSearchParams();
  if (action) {
    params.set("action", action);
  }
  if (id) {
    params.set("id", id);
  }
  if (extraQuery) {
    for (const [k, v] of Object.entries(extraQuery)) {
      if (v !== "") params.set(k, v);
    }
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = localStorage.getItem("auth_token");
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function paymentLinksFetchInit(
  options: RequestInit = {},
): RequestInit {
  return {
    cache: "no-store",
    ...options,
    headers: {
      Accept: "application/json",
      ...authHeaders(),
      ...(options.headers as Record<string, string> | undefined),
    },
  };
}

interface ApiEnvelope {
  success?: boolean;
  error?: string;
  errors?: string[];
  status?: string;
  endpoints?: unknown;
}

/** Turn a bad response into a message the user can act on. */
export function explainPaymentLinksApiError(
  res: Response,
  body: unknown,
): string {
  if (typeof body === "object" && body !== null) {
    const b = body as ApiEnvelope;
    if (b.status === "ok" && b.endpoints) {
      return (
        "Payment Links API route not found. Upload api/payment-links.php and " +
        "api/.htaccess to your server, then set Razorpay keys in api/config.php."
      );
    }
    if (Array.isArray(b.errors) && b.errors.length > 0) {
      return b.errors.join(", ");
    }
    if (typeof b.error === "string" && b.error) {
      return b.error;
    }
  }

  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    let hint =
      ct.includes("text/html") || ct.includes("<!DOCTYPE")
        ? " The server returned HTML (often index.html). Check the request URL includes /api/ (e.g. /api/payment-links.php), not /payment-links.php at the site root."
        : "";
    if (res.status === 404) {
      hint +=
        " Upload dist/api/payment-links.php and dist/api/razorpay_service.php, then open /api/payment-links.php?action=health — you should see JSON, not the React app.";
    } else {
      hint += " Rebuild and upload dist/ (frontend + api/). Set VITE_API_URL empty or to /api in .env before build.";
    }
    return (
      `Payment Links API returned non-JSON (HTTP ${res.status}).${hint} ` +
      "Confirm Razorpay keys in api/config.php and that PHP cURL is enabled."
    );
  }

  return `Payment Links API error (HTTP ${res.status})`;
}

export async function parseJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return null;
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const preview = trimmed.slice(0, 120).replace(/\s+/g, " ");
    throw new Error(
      explainPaymentLinksApiError(res, null) +
        (res.status === 200 ? ` Response was not valid JSON. Preview: ${preview}` : ""),
    );
  }
}
