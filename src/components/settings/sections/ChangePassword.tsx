import { useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { SaveButton } from "@/components/settings/ui/SaveButton";
import { SettingsInput } from "@/components/settings/ui/SettingsInput";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";

const MIN_PASSWORD_LENGTH = 8;

export function ChangePassword() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const onUpdatePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("All password fields are required.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirm password must match.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
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
        <div className="space-y-3 p-5">
          <SettingsInput value={currentPassword} onChange={setCurrentPassword} type="password" placeholder="Current Password" />
          <SettingsInput value={newPassword} onChange={setNewPassword} type="password" placeholder="New Password" />
          <SettingsInput value={confirmPassword} onChange={setConfirmPassword} type="password" placeholder="Confirm Password" />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <SaveButton onClick={onUpdatePassword} loading={changingPassword} label="Update Password" />
        </div>
      </SettingsSection>
    </div>
  );
}
