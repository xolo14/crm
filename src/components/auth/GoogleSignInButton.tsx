import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            el: HTMLElement,
            opts: { theme?: string; size?: string; width?: number; text?: string; shape?: string },
          ) => void;
        };
      };
    };
  }
}

type GoogleSignInButtonProps = {
  clientId: string;
  onCredential: (credential: string) => void;
  disabled?: boolean;
};

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }
  const existing = document.querySelector<HTMLScriptElement>('script[data-gis="1"]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Could not load Google Sign-In')), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.gis = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google Sign-In'));
    document.head.appendChild(script);
  });
}

export function GoogleSignInButton({ clientId, onCredential, disabled }: GoogleSignInButtonProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential;

  useEffect(() => {
    if (!clientId || disabled) return;
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    void (async () => {
      try {
        await loadGisScript();
        if (cancelled || !hostRef.current) return;
        window.google?.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            const cred = String(response?.credential || '').trim();
            if (cred) cbRef.current(cred);
          },
        });
        host.innerHTML = '';
        const width = Math.min(384, Math.max(240, Math.floor(host.clientWidth || 320)));
        window.google?.accounts.id.renderButton(host, {
          theme: 'outline',
          size: 'large',
          width,
          text: 'signin_with',
          shape: 'rectangular',
        });
      } catch {
        /* button stays empty; password login still works */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, disabled]);

  return <div ref={hostRef} className="flex min-h-10 w-full justify-center overflow-hidden" />;
}
