import { useId, useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";

/** Matches syncpediaMinPasswordLength() on the server (auth.php change_password). */
const MIN_PASSWORD_LENGTH = 8;

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  describedBy?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative w-full">
        <input
          id={id}
          name={id}
          type={show ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-10 text-sm transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1"
        />
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

export function ChangePassword() {
  const { toast } = useToast();
  const { user } = useAuth();
  const uid = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const ruleId = `${uid}-rule`;
  const errorId = `${uid}-error`;

  const onUpdatePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("All password fields are required.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirm password must match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Choose a new password that is different from the current one.");
      return;
    }
    setError("");
    setChangingPassword(true);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated successfully" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not update password";
      setError(msg);
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="bg-gray-50">
      <SettingsSection title="Change Password" description="Update your account password securely.">
        <form className="space-y-4 p-5" onSubmit={onUpdatePassword} noValidate aria-describedby={error ? errorId : undefined}>
          {/* Lets password managers attach the new password to the right account. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={String(user?.email ?? "")}
            readOnly
            hidden
            aria-hidden="true"
            tabIndex={-1}
          />
          <PasswordField
            id={`${uid}-current`}
            label="Current password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
          />
          <PasswordField
            id={`${uid}-new`}
            label="New password"
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            describedBy={ruleId}
          />
          <p id={ruleId} className={`-mt-2 text-xs ${newPassword && newPassword.length < MIN_PASSWORD_LENGTH ? "text-red-600" : "text-muted-foreground"}`}>
            At least {MIN_PASSWORD_LENGTH} characters. A longer phrase with words and numbers is stronger.
          </p>
          <PasswordField
            id={`${uid}-confirm`}
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />
          {error && (
            <p id={errorId} role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={changingPassword}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-all duration-150 ease-in-out hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {changingPassword && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Update Password
          </button>
        </form>
      </SettingsSection>
    </div>
  );
}
