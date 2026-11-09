import { useState, useEffect, useRef, useCallback } from "react";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import loginHero from "@/assets/login-hero.webp";
import superAdminMark from "@/assets/syncpedia-super-admin.png";
import { AUTH_PORTAL, pathnameToAuthRoleParam } from "@/lib/portalAuth";
import { HostingerSetupBanner } from "@/components/HostingerSetupBanner";
import { ForgotPasswordFlow } from "@/components/auth/ForgotPasswordFlow";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { getPostLoginPath, isSuperAdminPortalRole } from "@/lib/postLoginRoute";
import { normalizeAppRole } from "@/lib/roleUtils";

const SUPER_ADMIN_PORTAL = {
  label: "Super Admin Portal",
  desc: "Master control for all organizations, analytics & platform settings",
} as const;

export default function Auth() {
  const location = useLocation();
  if (pathnameToAuthRoleParam(location.pathname) !== "superadmin") {
    return <Navigate to={AUTH_PORTAL.login} replace />;
  }
  return <SuperAdminAuth />;
}

function SuperAdminAuth() {
  const { user, loading, signIn, signInWithGoogle, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const wrongPortalSignOutRef = useRef(false);

  const roleMatchesPortal = (rawRole?: string | null) => isSuperAdminPortalRole(normalizeAppRole(rawRole));

  useEffect(() => {
    try {
      sessionStorage.setItem("auth_login_portal", "superadmin");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const fromEnv = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
    if (fromEnv) {
      setGoogleClientId(fromEnv);
      return;
    }
    void (async () => {
      try {
        const data = await api.auth.googleConfig();
        const id = String(data?.client_id || "").trim();
        if (id) setGoogleClientId(id);
      } catch {
        /* Google button hidden until config is set */
      }
    })();
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    if (roleMatchesPortal(user.role)) return;
    if (normalizeAppRole(user.role) === "assessment_viewer") return;
    if (wrongPortalSignOutRef.current) return;
    wrongPortalSignOutRef.current = true;
    void (async () => {
      await signOut();
      toast({
        variant: "destructive",
        title: "Wrong login page",
        description: `This account must use the Login Portal at ${AUTH_PORTAL.login}.`,
      });
      wrongPortalSignOutRef.current = false;
    })();
  }, [loading, user, signOut, toast]);

  const finalizePortalAndNavigate = useCallback(async () => {
    const storedUser = JSON.parse(localStorage.getItem("auth_user") || "null");
    if (!roleMatchesPortal(storedUser?.role)) {
      await signOut();
      throw new Error(`This account must use the Login Portal at ${AUTH_PORTAL.login}.`);
    }
    navigate(getPostLoginPath(storedUser?.role), { replace: true });
  }, [signOut, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (user && roleMatchesPortal(user.role)) {
    return <Navigate to={getPostLoginPath(user.role)} replace />;
  }

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signIn(loginEmail.trim(), loginPassword);
      await finalizePortalAndNavigate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast({ variant: "destructive", title: "Login failed", description: message });
    }
    setSubmitting(false);
  };

  const handleGoogleCredential = async (credential: string) => {
    setSubmitting(true);
    try {
      await signInWithGoogle(credential, "super_admin");
      await finalizePortalAndNavigate();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast({ variant: "destructive", title: "Google sign-in failed", description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex min-h-screen min-h-[100dvh]">
        <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden items-center justify-center">
          <img src={loginHero} alt="Syncpedia CRM Dashboard" className="absolute inset-0 w-full h-full object-cover" decoding="async" fetchPriority="high" />
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative z-10 px-12 max-w-lg text-center">
            <img
              src={superAdminMark}
              alt="Syncpedia"
              className="h-24 w-24 rounded-2xl object-cover mx-auto mb-6 shadow-lg ring-1 ring-white/20"
              decoding="async"
            />
            <h1 className="text-4xl font-extrabold text-white mb-3 tracking-tight">{SUPER_ADMIN_PORTAL.label}</h1>
            <p className="text-lg text-white/80 font-medium">Syncpedia CRM</p>
            <p className="text-sm text-white/60 mt-3 leading-relaxed">{SUPER_ADMIN_PORTAL.desc}</p>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-5 py-8 sm:p-6 bg-background">
          <div className="w-full max-w-md">
            <HostingerSetupBanner />
            <div className="flex flex-col items-center gap-3 mb-8 lg:hidden">
              <img
                src={superAdminMark}
                alt="Syncpedia"
                className="h-14 w-14 rounded-2xl object-cover shadow-lg ring-1 ring-border"
                decoding="async"
              />
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{SUPER_ADMIN_PORTAL.label}</p>
                <p className="text-xs text-muted-foreground">Syncpedia CRM</p>
              </div>
            </div>

            <Card className="border-border/50 shadow-xl shadow-primary/5 rounded-2xl">
              <CardHeader className="text-center pb-2 px-5 sm:px-6 pt-6">
                <CardTitle className="text-xl font-bold">{SUPER_ADMIN_PORTAL.label}</CardTitle>
                <CardDescription>Sign in with Google, or email and password</CardDescription>
              </CardHeader>
              <CardContent className="px-5 sm:px-6 pb-6">
                {googleClientId ? (
                  <>
                    <GoogleSignInButton
                      clientId={googleClientId}
                      onCredential={(cred) => void handleGoogleCredential(cred)}
                      disabled={submitting}
                    />
                    <div className="relative my-4">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">or</span>
                      </div>
                    </div>
                  </>
                ) : null}
                <form onSubmit={handlePasswordLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Email</Label>
                    <Input
                      type="email"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="you@syncpedia.in"
                      maxLength={255}
                      className="h-12 rounded-xl"
                      autoComplete="username"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Password</Label>
                    <PasswordInput
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="••••••••"
                      className="h-12 rounded-xl"
                      autoComplete="current-password"
                    />
                  </div>
                  <Button type="submit" className="w-full h-12 rounded-xl text-sm font-semibold" disabled={submitting}>
                    {submitting ? "Logging in…" : "Login"}
                  </Button>
                </form>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline w-full text-center mt-4"
                  onClick={() => setForgotOpen(true)}
                >
                  Forgot password?
                </button>
                <p className="text-[11px] text-muted-foreground text-center mt-4">
                  Org admins and staff use the{" "}
                  <a href={AUTH_PORTAL.login} className="text-primary hover:underline">
                    Login Portal
                  </a>
                  .
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <ForgotPasswordFlow open={forgotOpen} onOpenChange={setForgotOpen} loginPath={AUTH_PORTAL.superAdmin} />
    </>
  );
}
