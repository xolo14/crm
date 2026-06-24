import { useState, useEffect, useRef, useCallback } from 'react';
import { Navigate, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Shield, UserCog, UserCheck, Lock, Mail } from 'lucide-react';
import loginHero from '@/assets/login-hero.jpg';
import syncpediaLogo from '@/assets/syncpedia-logo.png';
import { AUTH_PORTAL, pathnameToAuthRoleParam } from '@/lib/portalAuth';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';

const ROLE_CONFIGS: Record<string, { label: string; desc: string; icon: typeof Shield; gradient: string; iconColor: string; signupRole: string }> = {
  superadmin: { label: 'Super Admin Portal', desc: 'Master control for all organizations, analytics & platform settings', icon: Shield, gradient: 'from-amber-600 to-orange-700', iconColor: 'text-amber-100', signupRole: 'super_admin' },
  admin: { label: 'Admin Portal', desc: 'Full platform control, analytics & team management', icon: Shield, gradient: 'from-red-600 to-rose-700', iconColor: 'text-red-100', signupRole: 'admin' },
  manager: { label: 'Manager Portal', desc: 'Team performance, sales pipeline & reports', icon: UserCog, gradient: 'from-blue-600 to-indigo-700', iconColor: 'text-blue-100', signupRole: 'manager' },
  marketing: { label: 'Marketing Portal', desc: 'Campaign execution, email and WhatsApp performance', icon: UserCog, gradient: 'from-fuchsia-600 to-purple-700', iconColor: 'text-fuchsia-100', signupRole: 'marketing' },
  rep: { label: 'Sales Rep Portal', desc: 'Your leads, tasks & form link', icon: UserCheck, gradient: 'from-teal-600 to-emerald-700', iconColor: 'text-teal-100', signupRole: 'sales_representative' },
};

/** `/sales_rep_portal` and `/auth` (no query) are Sales Rep login; `/admin`, `/manager`, `/marketing`, `/super_admin` are path-based portals. */
function resolvePortalKey(portalRole: string): keyof typeof ROLE_CONFIGS {
  if (!portalRole) return 'rep';
  if (portalRole in ROLE_CONFIGS) return portalRole as keyof typeof ROLE_CONFIGS;
  return 'rep';
}

const portalFooterLinkClass = 'text-[11px] text-primary hover:underline font-medium';

/** Same footer link grid as Sales Rep card: row of four + row of two (teal links). */
function PortalLoginFooter({ showSalesRepBackLink = false }: { showSalesRepBackLink?: boolean }) {
  return (
    <div className="mt-4 space-y-2 text-center">
      {showSalesRepBackLink ? (
        <a href={AUTH_PORTAL.salesRep} className={`${portalFooterLinkClass} block text-xs`}>
          ← Sales rep login
        </a>
      ) : null}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        <a href={AUTH_PORTAL.admin} className={portalFooterLinkClass}>
          Admin login
        </a>
        <a href={AUTH_PORTAL.marketing} className={portalFooterLinkClass}>
          Marketing login
        </a>
        <a href={AUTH_PORTAL.manager} className={portalFooterLinkClass}>
          Manager
        </a>
      </div>
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        <a href={AUTH_PORTAL.superAdmin} className={portalFooterLinkClass}>
          Super admin
        </a>
        <a href="/hr-login" className={portalFooterLinkClass}>
          HR login
        </a>
      </div>
    </div>
  );
}

export default function Auth() {
  const { user, loading, signIn, signInWithGoogle, signUp, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const pathRole = pathnameToAuthRoleParam(location.pathname);
  const portalRole = pathRole !== null ? pathRole : (searchParams.get('role') || '');
  const config = ROLE_CONFIGS[portalRole];

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  const resetToken = searchParams.get('reset');
  const REQUIRED_ROLE_BY_PORTAL: Record<string, string> = {
    superadmin: 'super_admin',
    admin: 'admin',
    manager: 'manager',
    marketing: 'marketing',
    rep: 'sales_representative',
  };
  const normalizeRole = (rawRole?: string | null) => {
    if (!rawRole) return '';
    const cleaned = String(rawRole).trim().toLowerCase();
    if (cleaned === 'sales_marketing') return 'sales_marketing';
    if (cleaned.startsWith('marketing')) return 'marketing';
    if (cleaned === 'superadmin' || cleaned === 'super admin' || cleaned === 'super-admin') return 'super_admin';
    if (cleaned === 'sales_manager' || cleaned === 'team_lead') return 'manager';
    return cleaned;
  };
  /** Sales Rep portal allows `sales_representative` and `sales_marketing` only.
   *  Admin portal accepts `admin` plus organisation-admins (`org` / `organisation`). */
  const roleMatchesPortal = (rawRole: string | undefined, portalKey: string) => {
    const requiredRole = REQUIRED_ROLE_BY_PORTAL[portalKey];
    if (!requiredRole) return false;
    const n = normalizeRole(rawRole);
    if (portalKey === 'rep') {
      return n === 'sales_representative' || n === 'sales_marketing';
    }
    if (portalKey === 'admin') {
      return n === 'admin' || n === 'org' || n === 'organisation';
    }
    return n === requiredRole;
  };

  const portalKey = resolvePortalKey(portalRole);
  const wrongPortalSignOutRef = useRef(false);

  useEffect(() => {
    try {
      const key = portalKey === 'rep' ? 'rep' : portalKey === 'superadmin' ? 'superadmin' : portalKey;
      sessionStorage.setItem('auth_login_portal', key);
    } catch {
      /* ignore */
    }
  }, [portalKey]);

  useEffect(() => {
    if (loading || !user || resetToken) return;
    if (roleMatchesPortal(user.role, portalKey)) return;
    if (wrongPortalSignOutRef.current) return;
    wrongPortalSignOutRef.current = true;
    void (async () => {
      await signOut();
      toast({
        variant: 'destructive',
        title: 'Wrong login page',
        description: `This account cannot use ${ROLE_CONFIGS[portalKey]?.label || 'this portal'}. Open the correct portal for your role and sign in there.`,
      });
      wrongPortalSignOutRef.current = false;
    })();
  }, [loading, user, resetToken, portalKey, signOut, toast]);
  const getDefaultRouteByRole = (rawRole?: string) => {
    const normalized = normalizeRole(rawRole);
    if (normalized === 'super_admin') return '/superadmin';
    if (normalized === 'admin') return '/';
    if (normalized === 'org' || normalized === 'organisation') return '/';
    if (normalized === 'manager') return '/';
    if (normalized === 'marketing') return '/marketing/dashboard';
    return '/';
  };

  const finalizePortalAndNavigate = useCallback(async () => {
    const storedUser = JSON.parse(localStorage.getItem('auth_user') || 'null');
    if (!roleMatchesPortal(storedUser?.role, portalKey)) {
      if (portalKey === 'marketing' && storedUser?.email) {
        try {
          const membersRes = await api.marketing.members();
          const rows = Array.isArray(membersRes) ? membersRes : (membersRes?.data || membersRes?.members || []);
          const email = String(storedUser.email).trim().toLowerCase();
          const found = rows.some((m: any) => String(m?.email || '').trim().toLowerCase() === email);
          if (found) {
            const upgradedUser = { ...storedUser, role: 'marketing' };
            localStorage.setItem('auth_user', JSON.stringify(upgradedUser));
            window.location.href = '/marketing/dashboard';
            return;
          }
        } catch {
          /* ignore */
        }
      }
      await signOut();
      throw new Error(
        `Wrong portal. This account must use the login page for its role — not ${ROLE_CONFIGS[portalKey]?.label || 'this page'}.`,
      );
    }
    navigate(getDefaultRouteByRole(storedUser?.role), { replace: true });
  }, [portalKey, signOut, navigate]);

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      setSubmitting(true);
      try {
        await signInWithGoogle(credential);
        await finalizePortalAndNavigate();
      } catch (err: any) {
        toast({ variant: 'destructive', title: 'Google sign-in failed', description: err?.message || 'Something went wrong' });
      }
      setSubmitting(false);
    },
    [signInWithGoogle, finalizePortalAndNavigate, toast],
  );

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      toast({ variant: 'destructive', title: 'Enter your email' });
      return;
    }
    setForgotBusy(true);
    try {
      const data: any = await api.auth.forgotPassword(forgotEmail.trim());
      toast({ title: 'Check your options', description: data.message || 'If the account exists, use the reset link below.' });
      if (data.reset_url) {
        navigate(String(data.reset_url), { replace: true });
      }
      setForgotOpen(false);
      setForgotEmail('');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Request failed', description: err.message });
    } finally {
      setForgotBusy(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken) return;
    if (newPassword.length < 6) {
      toast({ variant: 'destructive', title: 'Password too short', description: 'Use at least 6 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ variant: 'destructive', title: 'Passwords do not match' });
      return;
    }
    setResetBusy(true);
    try {
      await api.auth.resetPassword(resetToken, newPassword);
      toast({ title: 'Password updated', description: 'You can sign in with your new password.' });
      navigate(AUTH_PORTAL.salesRep, { replace: true });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Reset failed', description: err.message });
    } finally {
      setResetBusy(false);
    }
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  // Only continue into the app when the session role matches this URL's portal. Wrong portal → signed out in effect above.
  if (user && !resetToken && roleMatchesPortal(user.role, portalKey)) {
    return <Navigate to={getDefaultRouteByRole(user.role)} replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const emailTrimmed = loginEmail.trim();
      await signIn(emailTrimmed, loginPassword);
      await finalizePortalAndNavigate();
    }
    catch (err: any) {
      toast({ variant: 'destructive', title: 'Login failed', description: err?.message || 'Something went wrong' });
    }
    setSubmitting(false);
  };

  const handleRepSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signUp(signupEmail, signupPassword, signupName, 'sales_representative');
      toast({ title: 'Account created!' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Signup failed', description: err.message });
    }
    setSubmitting(false);
  };

  const INVITE_CODE_ROLES: Record<string, { role: string; label: string }> = {
    'SYNC-ADMIN-2026': { role: 'admin', label: 'Admin' },
    'SYNC-MG-2026': { role: 'manager', label: 'Manager' },
  };

  const handleCodeSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      toast({ variant: 'destructive', title: 'Invite code required', description: 'Enter the secret invite code for this portal' });
      return;
    }
    const matched = INVITE_CODE_ROLES[code];
    if (!matched) {
      toast({ variant: 'destructive', title: 'Invalid invite code', description: 'The invite code you entered is not recognized' });
      return;
    }
    setSubmitting(true);
    try {
      await signUp(signupEmail, signupPassword, signupName, matched.role, code);
      toast({ title: `Registered as ${matched.label}!`, description: `Your ${matched.label} account has been created successfully.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Signup failed', description: err.message });
    }
    setSubmitting(false);
  };

  // Shared image panel - desktop only
  const ImagePanel = ({ overlay }: { overlay: React.ReactNode }) => (
    <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden items-center justify-center">
      <img src={loginHero} alt="Syncpedia CRM Dashboard" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative z-10 px-12 max-w-lg text-center">{overlay}</div>
    </div>
  );

  // Manager portal
  if (config && (portalRole === 'manager' || portalRole === 'admin' || portalRole === 'superadmin' || portalRole === 'marketing')) {
    const displayConfig = ROLE_CONFIGS[portalRole];
    const Icon = displayConfig.icon;
    return (
      <>
      <div className="flex min-h-screen min-h-[100dvh]">
        <ImagePanel overlay={
          <>
            <div className="h-20 w-20 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center mx-auto mb-6">
              <Icon className={`h-10 w-10 ${displayConfig.iconColor}`} />
            </div>
            <h1 className="text-4xl font-extrabold text-white mb-3 tracking-tight">{displayConfig.label}</h1>
            <p className="text-lg text-white/80 font-medium">Syncpedia CRM</p>
            <p className="text-sm text-white/60 mt-3 leading-relaxed">{displayConfig.desc}</p>
          </>
        } />
        <div className="flex-1 flex flex-col items-center justify-center px-5 py-8 sm:p-6 bg-background">
          <div className="w-full max-w-md">
            {/* Mobile branding */}
            <div className="flex flex-col items-center gap-3 mb-8 lg:hidden">
              <div className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${displayConfig.gradient} flex items-center justify-center shadow-lg`}>
                <Icon className="h-7 w-7 text-white" />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{displayConfig.label}</p>
                <p className="text-xs text-muted-foreground">Syncpedia CRM</p>
              </div>
            </div>

            <Card className="border-border/50 shadow-xl shadow-primary/5 rounded-2xl">
              <CardHeader className="text-center pb-2 px-5 sm:px-6 pt-6">
                <CardTitle className="text-xl font-bold">{displayConfig.label}</CardTitle>
                <CardDescription>Login or register with invite code</CardDescription>
              </CardHeader>
              <CardContent className="px-5 sm:px-6 pb-6">
                {resetToken ? (
                  <form onSubmit={handlePasswordReset} className="space-y-4">
                    <CardTitle className="text-lg">Set new password</CardTitle>
                    <p className="text-xs text-muted-foreground">Enter a new password for your account.</p>
                    <div className="space-y-2"><Label>New password</Label><Input type="password" required minLength={6} value={newPassword} onChange={e => setNewPassword(e.target.value)} className="h-11 rounded-lg" /></div>
                    <div className="space-y-2"><Label>Confirm password</Label><Input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="h-11 rounded-lg" /></div>
                    <Button type="submit" className="w-full h-11 rounded-lg" disabled={resetBusy}>{resetBusy ? 'Saving…' : 'Update password'}</Button>
                  </form>
                ) : (
                <Tabs defaultValue="login">
                  <TabsList className="grid w-full grid-cols-2 mb-5 h-11">
                    <TabsTrigger value="login" className="text-sm">Login</TabsTrigger>
                    <TabsTrigger value="signup" className="text-sm">Register</TabsTrigger>
                  </TabsList>
                  <TabsContent value="login">
                    <div className="space-y-4">
                      <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-2"><Label className="text-sm">Email</Label><Input type="email" required value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="you@institute.com" maxLength={255} className="h-12 rounded-xl" /></div>
                        <div className="space-y-2"><Label className="text-sm">Password</Label><Input type="password" required value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="••••••••" className="h-12 rounded-xl" /></div>
                        <Button type="submit" className="w-full h-12 rounded-xl text-sm font-semibold" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign In'}</Button>
                      </form>
                      <GoogleSignInButton onCredential={handleGoogleCredential} disabled={submitting} />
                      <button type="button" className="text-xs text-primary hover:underline w-full text-center" onClick={() => setForgotOpen(true)}>Forgot password?</button>
                    </div>
                  </TabsContent>
                  <TabsContent value="signup">
                    <form onSubmit={handleCodeSignup} className="space-y-4">
                      <div className="space-y-2"><Label className="text-sm">Full Name</Label><Input required value={signupName} onChange={e => setSignupName(e.target.value)} placeholder="John Doe" maxLength={100} className="h-12 rounded-xl" /></div>
                      <div className="space-y-2"><Label className="text-sm">Email</Label><Input type="email" required value={signupEmail} onChange={e => setSignupEmail(e.target.value)} placeholder="you@institute.com" maxLength={255} className="h-12 rounded-xl" /></div>
                      <div className="space-y-2"><Label className="text-sm">Password</Label><Input type="password" required minLength={6} value={signupPassword} onChange={e => setSignupPassword(e.target.value)} placeholder="••••••••" className="h-12 rounded-xl" /></div>
                      <div className="space-y-2">
                        <Label className="text-sm flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Invite Code</Label>
                        <Input required value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="Enter secret invite code" className="h-12 rounded-xl font-mono tracking-wider" maxLength={50} />
                        <p className="text-[11px] text-muted-foreground">Get this code from your administrator</p>
                      </div>
                      <Button type="submit" className="w-full h-12 rounded-xl text-sm font-semibold" disabled={submitting}>{submitting ? 'Creating account…' : 'Create Account'}</Button>
                    </form>
                  </TabsContent>
                </Tabs>
                )}
                <PortalLoginFooter showSalesRepBackLink />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Forgot password</DialogTitle>
            <DialogDescription>We&apos;ll email you a reset link when mail is configured. Until then, the app returns a one-time reset URL after you submit.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleForgotSubmit} className="space-y-4">
            <div className="space-y-2"><Label>Account email</Label><Input type="email" required value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} placeholder="you@company.com" /></div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setForgotOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={forgotBusy}>{forgotBusy ? 'Sending…' : 'Send reset link'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      </>
    );
  }

  // Main page — Sales Rep login + signup
  return (
    <>
    <div className="flex min-h-screen min-h-[100dvh] relative">
      <ImagePanel overlay={
        <>
          <h1 className="text-4xl font-extrabold text-white mb-3 tracking-tight">Syncpedia CRM</h1>
          <p className="text-sm text-white/60 mt-3 leading-relaxed">Manage leads, enroll students, track batches, courses, and payments — all in one platform.</p>
          <div className="mt-10 grid grid-cols-3 gap-4">
            {[{ label: 'Leads', val: '2.4K+' }, { label: 'Students', val: '850+' }, { label: 'Revenue', val: '₹42L+' }].map(s => (
              <div key={s.label} className="bg-white/10 backdrop-blur-sm rounded-xl py-3 px-2"><div className="text-xl font-bold text-white">{s.val}</div><div className="text-xs text-white/60 mt-0.5">{s.label}</div></div>
            ))}
          </div>
        </>
      } />

      <div className="flex-1 flex flex-col items-center justify-center px-5 py-8 sm:p-6 bg-background">
        <div className="w-full max-w-md">
          {/* Mobile branding - bigger and more prominent */}
          <div className="flex flex-col items-center gap-4 mb-8 lg:hidden">
            <img src={syncpediaLogo} alt="Syncpedia Technologies" className="h-10 object-contain" />
            <p className="text-xs text-muted-foreground text-center">Manage leads, students & payments</p>
          </div>

          <Card className="border-border/50 shadow-xl shadow-primary/5 rounded-2xl">
            <CardHeader className="text-center pb-2 px-5 sm:px-6 pt-6">
              <CardTitle className="text-xl font-bold">Sales Rep Portal</CardTitle>
              <CardDescription>
                Login or create your account. For Admin, Manager, or Super Admin, use the links below this card.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 sm:px-6 pb-6">
              {resetToken ? (
                <form onSubmit={handlePasswordReset} className="space-y-4">
                  <CardTitle className="text-lg">Set new password</CardTitle>
                  <p className="text-xs text-muted-foreground">Choose a new password, then sign in on this page.</p>
                  <div className="space-y-2"><Label>New password</Label><Input type="password" required minLength={6} value={newPassword} onChange={e => setNewPassword(e.target.value)} className="h-11 rounded-lg" /></div>
                  <div className="space-y-2"><Label>Confirm password</Label><Input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="h-11 rounded-lg" /></div>
                  <Button type="submit" className="w-full h-11 rounded-lg" disabled={resetBusy}>{resetBusy ? 'Saving…' : 'Update password'}</Button>
                </form>
              ) : (
              <Tabs defaultValue="login">
                <TabsList className="grid w-full grid-cols-2 mb-5 h-11">
                  <TabsTrigger value="login" className="text-sm">Login</TabsTrigger>
                  <TabsTrigger value="signup" className="text-sm">Sign Up</TabsTrigger>
                </TabsList>
                <TabsContent value="login">
                  <div className="space-y-4">
                    <form onSubmit={handleLogin} className="space-y-4">
                      <div className="space-y-2"><Label className="text-sm">Email</Label><Input type="email" required value={loginEmail} onChange={e => setLoginEmail(e.target.value)} placeholder="you@institute.com" maxLength={255} className="h-12 rounded-xl" /></div>
                      <div className="space-y-2"><Label className="text-sm">Password</Label><Input type="password" required value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="••••••••" className="h-12 rounded-xl" /></div>
                      <Button type="submit" className="w-full h-12 rounded-xl text-sm font-semibold" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign In'}</Button>
                    </form>
                    <GoogleSignInButton onCredential={handleGoogleCredential} disabled={submitting} />
                    <button type="button" className="text-xs text-primary hover:underline w-full text-center" onClick={() => setForgotOpen(true)}>Forgot password?</button>
                  </div>
                </TabsContent>
                <TabsContent value="signup">
                  <form onSubmit={handleRepSignup} className="space-y-4">
                    <div className="space-y-2"><Label className="text-sm">Full Name</Label><Input required value={signupName} onChange={e => setSignupName(e.target.value)} placeholder="John Doe" maxLength={100} className="h-12 rounded-xl" /></div>
                    <div className="space-y-2"><Label className="text-sm">Email</Label><Input type="email" required value={signupEmail} onChange={e => setSignupEmail(e.target.value)} placeholder="you@institute.com" maxLength={255} className="h-12 rounded-xl" /></div>
                    <div className="space-y-2"><Label className="text-sm">Password</Label><Input type="password" required minLength={6} value={signupPassword} onChange={e => setSignupPassword(e.target.value)} placeholder="••••••••" className="h-12 rounded-xl" /></div>
                    <Button type="submit" className="w-full h-12 rounded-xl text-sm font-semibold" disabled={submitting}>{submitting ? 'Creating account…' : 'Create Account'}</Button>
                  </form>
                </TabsContent>
              </Tabs>
              )}
              <PortalLoginFooter />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
    <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Forgot password</DialogTitle>
          <DialogDescription>Submit your email. If an account exists, you will get a reset link (valid 1 hour).</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleForgotSubmit} className="space-y-4">
          <div className="space-y-2"><Label>Account email</Label><Input type="email" required value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} placeholder="you@company.com" /></div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setForgotOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={forgotBusy}>{forgotBusy ? 'Sending…' : 'Send reset link'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}
