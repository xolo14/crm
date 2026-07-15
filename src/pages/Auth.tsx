import { useState, useEffect, useRef, useCallback } from "react";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Shield } from "lucide-react";
import loginHero from "@/assets/login-hero.webp";
import { AUTH_PORTAL, pathnameToAuthRoleParam } from "@/lib/portalAuth";
import { HostingerSetupBanner } from "@/components/HostingerSetupBanner";
import { ForgotPasswordFlow } from "@/components/auth/ForgotPasswordFlow";
import { getPostLoginPath, isSuperAdminPortalRole } from "@/lib/postLoginRoute";
import { normalizeAppRole } from "@/lib/roleUtils";

const SUPER_ADMIN_PORTAL = {
  label: "Super Admin Portal",
  desc: "Master control for all organizations, analytics & platform settings",
  gradient: "from-amber-600 to-orange-700",
  iconColor: "text-amber-100",
} as const;

export default function Auth() {
  const { user, loading, signIn, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const isSuperAdminPortal = pathnameToAuthRoleParam(location.pathname) === "superadmin";

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const wrongPortalSignOutRef = useRef(false);

  if (!isSuperAdminPortal) {
    return <Navigate to={AUTH_PORTAL.login} replace />;
  }

  const roleMatchesPortal = (rawRole?: string | null) => isSuperAdminPortalRole(normalizeAppRole(rawRole));

  useEffect(() => {
    try {
      sessionStorage.setItem("auth_login_portal", "superadmin");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    if (roleMatchesPortal(user.role)) return;
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

  const handleLogin = async (e: React.FormEvent) => {
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

  return (
    <>
      <div className="flex min-h-screen min-h-[100dvh]">
        <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden items-center justify-center">
          <img src={loginHero} alt="Syncpedia CRM Dashboard" className="absolute inset-0 w-full h-full object-cover" decoding="async" fetchPriority="high" />
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative z-10 px-12 max-w-lg text-center">
            <div className="h-20 w-20 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center mx-auto mb-6">
              <Shield className={`h-10 w-10 ${SUPER_ADMIN_PORTAL.iconColor}`} />
            </div>
            <h1 className="text-4xl font-extrabold text-white mb-3 tracking-tight">{SUPER_ADMIN_PORTAL.label}</h1>
            <p className="text-lg text-white/80 font-medium">Syncpedia CRM</p>
            <p className="text-sm text-white/60 mt-3 leading-relaxed">{SUPER_ADMIN_PORTAL.desc}</p>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-5 py-8 sm:p-6 bg-background">
          <div className="w-full max-w-md">
            <HostingerSetupBanner />
            <div className="flex flex-col items-center gap-3 mb-8 lg:hidden">
              <div className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${SUPER_ADMIN_PORTAL.gradient} flex items-center justify-center shadow-lg`}>
                <Shield className="h-7 w-7 text-white" />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{SUPER_ADMIN_PORTAL.label}</p>
                <p className="text-xs text-muted-foreground">Syncpedia CRM</p>
              </div>
            </div>

            <Card className="border-border/50 shadow-xl shadow-primary/5 rounded-2xl">
              <CardHeader className="text-center pb-2 px-5 sm:px-6 pt-6">
                <CardTitle className="text-xl font-bold">{SUPER_ADMIN_PORTAL.label}</CardTitle>
                <CardDescription>Platform super administrator sign-in only</CardDescription>
              </CardHeader>
              <CardContent className="px-5 sm:px-6 pb-6">
                <form onSubmit={handleLogin} className="space-y-4">
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
