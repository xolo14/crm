import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '@/lib/api';

interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  phone?: string | null;
  avatar_url?: string | null;
  referral_code?: string | null;
  org_id?: string | null;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
  plan?: string;
  industry?: string;
  features?: Record<string, boolean>;
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
  hasFeature: (feature: string) => boolean;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = api.auth.getToken();
    const stored = api.auth.getStoredUser();
    const storedOrg = api.auth.getStoredOrg();
    if (token && stored) {
      setUser(stored);
      if (storedOrg) setOrganization(storedOrg);
      api.auth.me().then(data => {
        setUser(data.user);
        if (data.organization) {
          setOrganization(data.organization);
          api.auth.setStoredOrg(data.organization);
        }
      }).catch(() => {
        api.auth.logout();
        setUser(null);
        setOrganization(null);
      });
    }
    setLoading(false);
  }, []);

  const signIn = async (email: string, password: string) => {
    const data = await api.auth.login(email, password);
    setUser(data.user);
    if (data.organization) {
      setOrganization(data.organization);
    }
  };

  const signInWithGoogle = async (credential: string) => {
    const data = await api.auth.loginWithGoogle(credential);
    setUser(data.user);
    if (data.organization) {
      setOrganization(data.organization);
    }
  };

  const signUp = async (email: string, password: string, fullName: string, role?: string, inviteCode?: string) => {
    const data = await api.auth.signup(email, password, fullName, role, inviteCode);
    setUser(data.user);
  };

  const signOut = async () => {
    api.auth.logout();
    setUser(null);
    setOrganization(null);
  };

  const switchOrg = async (orgId: string | null) => {
    const data = await api.auth.switchOrg(orgId);
    if (data.organization) {
      setOrganization(data.organization);
    } else {
      setOrganization(null);
    }
  };

  const hasFeature = (feature: string) => {
    // Super admin always has access
    if (user?.role === 'super_admin') return true;
    // If no org or no features defined, allow all
    if (!organization?.features) return true;
    return organization.features[feature] !== false;
  };

  const normalizeRole = (rawRole?: string | null) => {
    if (!rawRole) return null;
    const cleaned = String(rawRole).trim().toLowerCase();
    if (cleaned === 'sales_executive') return 'sales_representative';
    if (cleaned === 'organisation') return 'org';
    if (cleaned === 'team_lead' || cleaned === 'sales_manager') return 'manager';
    if (cleaned.startsWith('marketing')) return 'marketing';
    return cleaned;
  };

  const role = normalizeRole(user?.role) || null;
  const profile = user ? { full_name: user.full_name, email: user.email, phone: user.phone || null, avatar_url: user.avatar_url || null, referral_code: user.referral_code || null } : null;

  return (
    <AuthContext.Provider value={{ user: user as any, role, profile, organization, loading, signIn, signInWithGoogle, signUp, signOut, switchOrg, hasFeature }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
