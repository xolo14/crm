import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import { api } from '@/lib/api';
import { isOrgFeatureEnabled } from '@/lib/orgFeatures';
import { clearFormsManagerCache } from '@/lib/formsManagerCache';

interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  phone?: string | null;
  avatar_url?: string | null;
  referral_code?: string | null;
  org_id?: string | null;
  page_access?: { payments?: boolean; offer_letters?: boolean; pages?: Record<string, boolean> } | null;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
  plan?: string;
  industry?: string;
  features?: Record<string, boolean>;
  /** Globally unique 2-letter certificate prefix for this org. */
  cert_prefix?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  role: string | null;
  profile: { full_name: string; email: string; phone: string | null; avatar_url: string | null; referral_code: string | null } | null;
  organization: Organization | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (credential: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, role?: string, inviteCode?: string) => Promise<void>;
  signOut: () => Promise<void>;
  switchOrg: (orgId: string | null) => Promise<void>;
  refreshOrganization: () => Promise<void>;
  hasFeature: (feature: string) => boolean;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshOrganization = useCallback(async () => {
    const hasSession = api.auth.hasSession?.() ?? !!api.auth.getStoredUser();
    if (!hasSession) return;
    try {
      const data = await api.auth.me();
      setUser(data.user);
      setOrganization(data.organization ?? null);
    } catch {
      /* ignore background refresh errors */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const hasSession = api.auth.hasSession?.() ?? !!api.auth.getStoredUser();
      const stored = api.auth.getStoredUser();
      const storedOrg = api.auth.getStoredOrg();

      if (!hasSession) {
        if (!cancelled) setLoading(false);
        return;
      }

      // Hydrate from cache first — avoids blocking first paint on auth.me() (mobile FCP/LCP).
      if (stored) {
        setUser(stored);
        setOrganization(storedOrg);
        if (!cancelled) setLoading(false);
      }

      try {
        const data = await api.auth.me();
        if (cancelled) return;
        setUser(data.user);
        setOrganization(data.organization ?? null);
      } catch {
        if (!cancelled) {
          api.auth.logout();
          setUser(null);
          setOrganization(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user || user.role === 'super_admin') return;
    const onFocus = () => { void refreshOrganization(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user, refreshOrganization]);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await api.auth.login(email, password);
    setUser(data.user);
    setOrganization(data.organization ?? null);
  }, []);

  const signInWithGoogle = useCallback(async (credential: string) => {
    const data = await api.auth.loginWithGoogle(credential);
    setUser(data.user);
    setOrganization(data.organization ?? null);
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string, role?: string, inviteCode?: string) => {
    const data = await api.auth.signup(email, password, fullName, role, inviteCode);
    setUser(data.user);
    if (data.organization) {
      setOrganization(data.organization);
    }
  }, []);

  const signOut = useCallback(async () => {
    api.auth.logout();
    clearFormsManagerCache();
    setUser(null);
    setOrganization(null);
  }, []);

  const switchOrg = useCallback(async (orgId: string | null) => {
    clearFormsManagerCache();
    await api.auth.switchOrg(orgId);
    const me = await api.auth.me();
    setUser(me.user);
    setOrganization(me.organization ?? null);
  }, []);

  const role = user?.role ?? null;

  const hasFeature = useCallback(
    (feature: string) => isOrgFeatureEnabled(role, organization, feature),
    [role, organization],
  );

  const profile = useMemo(
    () =>
      user
        ? {
            full_name: user.full_name,
            email: user.email,
            phone: user.phone ?? null,
            avatar_url: user.avatar_url ?? null,
            referral_code: user.referral_code ?? null,
          }
        : null,
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      role,
      profile,
      organization,
      loading,
      signIn,
      signInWithGoogle,
      signUp,
      signOut,
      switchOrg,
      refreshOrganization,
      hasFeature,
    }),
    [
      user,
      role,
      profile,
      organization,
      loading,
      signIn,
      signInWithGoogle,
      signUp,
      signOut,
      switchOrg,
      refreshOrganization,
      hasFeature,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
