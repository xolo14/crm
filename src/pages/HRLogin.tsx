import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Mail, Lock, UserCog } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AUTH_PORTAL } from "@/lib/portalAuth";
import loginHero from "@/assets/login-hero.jpg";

const HR_CONFIG = {
  label: "HR Portal",
  desc: "Manage HR leads, tasks, holidays and reports",
  gradient: "from-sky-600 to-cyan-700",
  iconColor: "text-sky-100",
};

const portalFooterLinkClass = "text-[11px] text-primary hover:underline font-medium";

function PortalLoginFooter() {
  return (
    <div className="mt-4 space-y-2 text-center">
      <a href={AUTH_PORTAL.salesRep} className={`${portalFooterLinkClass} block text-xs`}>
        ← Sales rep login
      </a>
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
      </div>
    </div>
  );
}

export default function HRLogin() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const hrUser = api.hr.getStoredUser();
  if (hrUser) return <Navigate to="/hr/dashboard" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.hr.login(email.trim(), password);
      navigate("/hr/dashboard", { replace: true });
    } catch (err: any) {
      toast({ variant: "destructive", title: "HR login failed", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen min-h-[100dvh]">
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden items-center justify-center">
        <img src={loginHero} alt="Syncpedia CRM Dashboard" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative z-10 px-12 max-w-lg text-center">
          <div className="h-20 w-20 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center mx-auto mb-6">
            <UserCog className={`h-10 w-10 ${HR_CONFIG.iconColor}`} />
          </div>
          <h1 className="text-4xl font-extrabold text-white mb-3 tracking-tight">{HR_CONFIG.label}</h1>
          <p className="text-lg text-white/80 font-medium">Syncpedia CRM</p>
          <p className="text-sm text-white/60 mt-3 leading-relaxed">{HR_CONFIG.desc}</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-5 py-8 sm:p-6 bg-background">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center gap-3 mb-8 lg:hidden">
            <div className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${HR_CONFIG.gradient} flex items-center justify-center shadow-lg`}>
              <UserCog className="h-7 w-7 text-white" />
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-foreground">{HR_CONFIG.label}</p>
              <p className="text-xs text-muted-foreground">Syncpedia CRM</p>
            </div>
          </div>

          <Card className="border-border/50 shadow-xl shadow-primary/5 rounded-2xl">
            <CardHeader className="text-center pb-2 px-5 sm:px-6 pt-6">
              <CardTitle className="text-xl font-bold">{HR_CONFIG.label}</CardTitle>
              <CardDescription>Sign in to access the HR dashboard</CardDescription>
            </CardHeader>
            <CardContent className="px-5 sm:px-6 pb-6">
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-9 h-12 rounded-xl"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@institute.com"
                      maxLength={255}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-9 h-12 rounded-xl"
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full h-12 rounded-xl text-sm font-semibold" disabled={busy}>
                  {busy ? "Signing in…" : "Sign In"}
                </Button>
              </form>

              <PortalLoginFooter />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
