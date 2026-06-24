import { useEffect, useRef } from 'react';

const GSI_SCRIPT = 'https://accounts.google.com/gsi/client';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (res: { credential?: string }) => void }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, string | number | boolean>) => void;
        };
      };
    };
  }
}

/**
 * Renders Google's Sign In With Google button when `VITE_GOOGLE_CLIENT_ID` is set at build time.
 */
export function GoogleSignInButton({
  onCredential,
  disabled,
}: {
  onCredential: (credential: string) => void;
  disabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential;
  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();

  useEffect(() => {
    if (!clientId || !containerRef.current) return;

    const el = containerRef.current;

    const render = () => {
      if (!el || !window.google?.accounts?.id) return;
      el.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (res) => {
          if (res?.credential) cbRef.current(res.credential);
        },
      });
      window.google.accounts.id.renderButton(el, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'signin_with',
        locale: 'en',
      });
    };

    const existing = document.querySelector(`script[src="${GSI_SCRIPT}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (window.google?.accounts?.id) {
        render();
      } else {
        existing.addEventListener('load', render);
        return () => existing.removeEventListener('load', render);
      }
    } else {
      const script = document.createElement('script');
      script.src = GSI_SCRIPT;
      script.async = true;
      script.defer = true;
      script.onload = () => render();
      document.body.appendChild(script);
    }

    return () => {
      el.innerHTML = '';
    };
  }, [clientId]);

  if (!clientId) return null;

  return (
    <div className="w-full">
      <div className="relative flex items-center gap-3 py-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[11px] text-muted-foreground shrink-0 uppercase tracking-wide">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div
        ref={containerRef}
        className={`flex w-full justify-center overflow-x-auto ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      />
    </div>
  );
}
