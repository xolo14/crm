import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { LogIn } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AUTH_PORTAL } from "@/lib/portalAuth";
import { HostingerSetupBanner } from "@/components/HostingerSetupBanner";
import { ForgotPasswordFlow } from "@/components/auth/ForgotPasswordFlow";
import {
  getPostLoginPath,
  isLoginPortalRole,
  isSuperAdminPortalRole,
  resolveMarketingLoginUser,
  syncHrLocalSession,
} from "@/lib/postLoginRoute";
import loginHero from "@/assets/login-hero.webp";
import syncpediaLogo from "@/assets/syncpedia-logo.webp";

export default function LoginPortal() {
  const { user, loading, signIn, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem("auth_login_portal", "login");
    } catch {
      /* ignore */
    }
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (user && isLoginPortalRole(user.role)) {
    return <Navigate to={getPostLoginPath(user.role)} replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      let storedUser = JSON.parse(localStorage.getItem("auth_user") || "null") as Record<string, unknown> | null;
      const role = String(storedUser?.role ?? "");

      if (isSuperAdminPortalRole(role)) {
        await signOut();
        throw new Error("Super Admin accounts must sign in at /super_admin.");
      }
      if (!isLoginPortalRole(role)) {
        await signOut();
        throw new Error("This account cannot use the Login Portal.");
      }

      storedUser = await resolveMarketingLoginUser(storedUser);
      syncHrLocalSession(storedUser);
      navigate(getPostLoginPath(String(storedUser?.role ?? role)), { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast({ variant: "destructive", title: "Login failed", description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex min-h-screen min-h-[100dvh]">
        <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden items-center justify-center">
          <img src={loginHero} alt="Syncpedia CRM" className="absolute inset-0 w-full h-full object-cover" decoding="async" fetchPriority="high" />
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative z-10 px-12 max-w-lg text-center">
            <div className="h-20 w-20 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center mx-auto mb-6">
              <LogIn className="h-10 w-10 text-emerald-100" />
            </div>
            <h1 className="text-4xl font-extrabold text-white mb-3 tracking-tight">Login Portal</h1>
            <p className="text-lg text-white/80 font-medium">Syncpedia CRM</p>
            <p className="text-sm text-white/60 mt-3 leading-relaxed">
              One sign-in for admins, sales, managers, marketing, and HR teams.
            </p>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-5 py-8 sm:p-6 bg-background">
          <div className="w-full max-w-md">
            <HostingerSetupBanner />
            <div className="flex flex-col items-center gap-4 mb-8 lg:hidden">
              <img
                src={syncpediaLogo}
                alt="Syncpedia Technologies"
                className="h-10 object-contain"
                width={160}
                height={40}
                decoding="async"
                fetchPriority="high"
              />
              <p className="text-lg font-bold text-foreground">Login Portal</p>
            </div>

            <Card className="border-border/50 shadow-xl shadow-primary/5 rounded-2xl">
              <CardHeader className="text-center pb-2 px-5 sm:px-6 pt-6">
                <CardTitle className="text-xl font-bold">Login Portal</CardTitle>
                <CardDescription>Sign in with your work email and password</CardDescription>
              </CardHeader>
              <CardContent className="px-5 sm:px-6 pb-6">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Email</Label>
                    <Input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      maxLength={255}
                      className="h-12 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Password</Label>
                    <PasswordInput
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
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
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <ForgotPasswordFlow open={forgotOpen} onOpenChange={setForgotOpen} loginPath={AUTH_PORTAL.login} />

      <p className="fixed bottom-0 left-0 right-0 py-3 text-center text-xs text-muted-foreground bg-background/80 backdrop-blur border-t">
        <Link to="/privacy" className="hover:underline">
          Privacy Policy
        </Link>
        {" · "}
        <Link to="/terms" className="hover:underline">
          Terms
        </Link>
      </p>
    </>
  );
}
