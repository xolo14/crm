import type { EmbeddedSignupLaunchConfig } from "@/types/communications";

export type EmbeddedSignupFinishPayload = {
  code: string;
  phone_number_id: string;
  waba_id: string;
};

type FbLoginResponse = {
  authResponse?: { code?: string };
  status?: string;
};

type FbStatusResponse = {
  status?: "connected" | "not_authorized" | "unknown" | string;
  authResponse?: {
    accessToken?: string;
    expiresIn?: number;
    signedRequest?: string;
    userID?: string;
  };
};

type WaEmbeddedSignupMessage = {
  type?: string;
  event?: string;
  data?: {
    phone_number_id?: string;
    waba_id?: string;
    business_id?: string;
    current_step?: string;
    code?: string;
  };
};

/** v4 FINISH events that include a phone number ID (Cloud API ready). */
const PHONE_FINISH_EVENTS = new Set([
  "FINISH",
  "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
]);

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
      getLoginStatus: (callback: (response: FbStatusResponse) => void) => void;
      login: (
        callback: (response: FbLoginResponse) => void,
        opts: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

function isFacebookOrigin(origin: string): boolean {
  try {
    return origin.endsWith("facebook.com");
  } catch {
    return false;
  }
}

let sdkLoadPromise: Promise<void> | null = null;

export function loadFacebookSdk(appId: string, version = "v21.0"): Promise<void> {
  if (!appId) {
    return Promise.reject(new Error("Meta App ID is not configured"));
  }
  if (window.FB) {
    return Promise.resolve();
  }
  if (sdkLoadPromise) {
    return sdkLoadPromise;
  }

  sdkLoadPromise = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      try {
        window.FB?.init({ appId, cookie: true, xfbml: true, version });
        resolve();
      } catch (e) {
        reject(e instanceof Error ? e : new Error("Facebook SDK init failed"));
      }
    };

    const existing = document.querySelector('script[src*="connect.facebook.net"]');
    if (existing) {
      const wait = setInterval(() => {
        if (window.FB) {
          clearInterval(wait);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(wait);
        if (!window.FB) reject(new Error("Facebook SDK load timed out"));
      }, 15000);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Facebook SDK"));
    document.body.appendChild(script);
  });

  return sdkLoadPromise;
}

/**
 * Launch Meta WhatsApp Embedded Signup v4 (Facebook Login for Business).
 * Captures exchangeable code + WABA ID + phone_number_id per Meta docs.
 * @see https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4
 */
export async function launchMetaEmbeddedSignup(
  config: Pick<EmbeddedSignupLaunchConfig, "meta_app_id" | "embedded_signup_config_id" | "graph_api_version">,
): Promise<EmbeddedSignupFinishPayload> {
  const appId = config.meta_app_id.trim();
  const configId = config.embedded_signup_config_id.trim();
  if (!appId || !configId) {
    throw new Error("Embedded Signup v4 is not configured. Ask your platform admin to create a v4 config in Meta Embedded Signup Builder.");
  }

  await loadFacebookSdk(appId, config.graph_api_version || "v21.0");

  return new Promise((resolve, reject) => {
    let authCode = "";
    let phoneNumberId = "";
    let wabaId = "";
    let settled = false;
    let loginSeen = false;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };

    const finish = () => {
      if (settled) return;
      if (!authCode || !phoneNumberId || !wabaId) return;
      settled = true;
      cleanup();
      resolve({ code: authCode, phone_number_id: phoneNumberId, waba_id: wabaId });
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const onMessage = (event: MessageEvent) => {
      if (!isFacebookOrigin(event.origin)) return;
      try {
        const payload = JSON.parse(String(event.data)) as WaEmbeddedSignupMessage;
        if (payload.type !== "WA_EMBEDDED_SIGNUP") return;

        if (payload.event === "CANCEL") {
          fail("WhatsApp setup was cancelled");
          return;
        }
        if (payload.event === "ERROR") {
          fail("Meta reported an error during WhatsApp setup. Try again or contact support.");
          return;
        }
        if (payload.event === "FINISH_ONLY_WABA") {
          fail("WhatsApp account was created but no phone number was added. Complete phone verification in Meta and try again.");
          return;
        }
        if (payload.event && PHONE_FINISH_EVENTS.has(payload.event) && payload.data) {
          phoneNumberId = String(payload.data.phone_number_id || "").trim();
          wabaId = String(payload.data.waba_id || "").trim();
          const msgCode = String(payload.data.code || "").trim();
          if (msgCode) authCode = msgCode;
          finish();
        }
      } catch {
        /* ignore non-JSON postMessage payloads */
      }
    };

    window.addEventListener("message", onMessage);

    const timer = setTimeout(() => {
      fail("WhatsApp setup timed out. Complete the Meta login popup and try again.");
    }, 10 * 60 * 1000);

    // Mirrors Meta sample flow: read current FB login state before triggering FB.login.
    try {
      window.FB?.getLoginStatus(() => {
        /* best-effort preflight only */
      });
    } catch {
      /* ignore and continue to login */
    }

    window.FB?.login(
      (response) => {
        loginSeen = true;
        if (response.authResponse?.code) {
          authCode = String(response.authResponse.code).trim();
          finish();
          return;
        }
        if (response.status === "not_authorized" || response.status === "unknown") {
          return;
        }
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  });
}
