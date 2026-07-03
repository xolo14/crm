import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type Step = "email" | "otp" | "password" | "success";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loginPath: string;
};

function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          required
          minLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pr-10 h-11 rounded-lg"
        />
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export function ForgotPasswordFlow({ open, onOpenChange, loginPath }: Props) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const resetState = () => {
    setStep("email");
    setEmail("");
    setOtp("");
    setResetToken("");
    setNewPassword("");
    setConfirmPassword("");
    setBusy(false);
  };

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open]);

  useEffect(() => {
    if (step !== "success") return;
    const timer = window.setTimeout(() => {
      onOpenChange(false);
      navigate(loginPath, { replace: true });
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [step, loginPath, navigate, onOpenChange]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast({ variant: "destructive", title: "Enter your email" });
      return;
    }
    setBusy(true);
    try {
      const data: any = await api.auth.forgotPassword(trimmed);
      setEmail(trimmed);
      setStep("otp");
      toast({
        title: "Check your email",
        description: data.message || "A 6-digit code was sent from support@syncpedia.in.",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not send code", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      toast({ variant: "destructive", title: "Enter the 6-digit code" });
      return;
    }
    setBusy(true);
    try {
      const data: any = await api.auth.verifyResetOtp(email, code);
      setResetToken(String(data.reset_token || ""));
      setStep("password");
      toast({ title: "Code verified", description: "Choose a new password below." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Invalid code", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast({ variant: "destructive", title: "Password too short", description: "Use at least 6 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ variant: "destructive", title: "Passwords do not match" });
      return;
    }
    setBusy(true);
    try {
      const data: any = await api.auth.resetPassword(resetToken, newPassword);
      setStep("success");
      toast({
        title: "Password changed",
        description: data.message || "Redirecting you to the login page…",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not change password", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<Step, string> = {
    email: "Forgot password",
    otp: "Enter verification code",
    password: "Set new password",
    success: "Password changed",
  };

  const descriptions: Record<Step, string> = {
    email: "Enter your account email. We will send a 6-digit code from support@syncpedia.in.",
    otp: `Enter the code sent to ${email || "your email"}. It expires in 10 minutes.`,
    password: "Choose a new password for your account.",
    success: "Your password was updated successfully. Redirecting to login…",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titles[step]}</DialogTitle>
          <DialogDescription>{descriptions[step]}</DialogDescription>
        </DialogHeader>

        {step === "email" && (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div className="space-y-2">
              <Label>Account email</Label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send OTP"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="space-y-2">
              <Label>6-digit code</Label>
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="text-center text-lg tracking-[0.35em] font-mono h-12"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
              <Button type="button" variant="ghost" className="sm:mr-auto" onClick={() => setStep("email")}>
                Change email
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || otp.length !== 6}>
                {busy ? "Verifying…" : "Verify code"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <PasswordField
              id="new-password"
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              placeholder="At least 6 characters"
            />
            <PasswordField
              id="confirm-password"
              label="Confirm password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Re-enter password"
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Change password"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            <p className="text-sm text-muted-foreground">
              Your password has been changed. You will be redirected to the login page shortly.
            </p>
            <Button type="button" onClick={() => { onOpenChange(false); navigate(loginPath, { replace: true }); }}>
              Go to login
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
