import { useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { SaveButton } from "@/components/settings/ui/SaveButton";
import { SettingsInput } from "@/components/settings/ui/SettingsInput";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";
import { SettingsSelect } from "@/components/settings/ui/SettingsSelect";
import { ToggleSwitch } from "@/components/settings/ui/ToggleSwitch";

export function Security() {
  const { toast } = useToast();
  const [minPasswordLength, setMinPasswordLength] = useState("8");
  const [requireUppercase, setRequireUppercase] = useState(true);
  const [requireNumbers, setRequireNumbers] = useState(true);
  const [requireSpecial, setRequireSpecial] = useState(true);
  const [passwordExpiry, setPasswordExpiry] = useState("none");
  const [sessionTimeout, setSessionTimeout] = useState("1h");
  const [require2FA, setRequire2FA] = useState(false);
  const [enableSso, setEnableSso] = useState(false);
  const [ipWhitelist, setIpWhitelist] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
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
    if (newPassword.length < Number(minPasswordLength)) {
      setError(`New password must be at least ${minPasswordLength} characters.`);
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

  const onSave = () => {
    setSaving(true);
    window.setTimeout(() => setSaving(false), 900);
  };

  return (
    <div className="bg-gray-50">
      <SettingsSection title="Password Policy" description="Configure default organization password requirements.">
        <SettingsRow label="Minimum Password Length">
          <SettingsInput value={minPasswordLength} onChange={setMinPasswordLength} type="number" />
        </SettingsRow>
        <SettingsRow label="Require Uppercase">
          <ToggleSwitch enabled={requireUppercase} onChange={setRequireUppercase} />
        </SettingsRow>
        <SettingsRow label="Require Numbers">
          <ToggleSwitch enabled={requireNumbers} onChange={setRequireNumbers} />
        </SettingsRow>
        <SettingsRow label="Require Special Characters">
          <ToggleSwitch enabled={requireSpecial} onChange={setRequireSpecial} />
        </SettingsRow>
        <SettingsRow label="Password Expiry" border={false}>
          <SettingsSelect
            value={passwordExpiry}
            onChange={setPasswordExpiry}
            options={[
              { value: "none", label: "None" },
              { value: "30", label: "30 Days" },
              { value: "60", label: "60 Days" },
              { value: "90", label: "90 Days" },
              { value: "180", label: "180 Days" },
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Session & Access" description="Manage sign-in security and network access controls.">
        <SettingsRow label="Session Timeout">
          <SettingsSelect
            value={sessionTimeout}
            onChange={setSessionTimeout}
            options={[
              { value: "15m", label: "15 min" },
              { value: "30m", label: "30 min" },
              { value: "1h", label: "1 hour" },
              { value: "4h", label: "4 hours" },
              { value: "8h", label: "8 hours" },
              { value: "never", label: "Never" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Two-Factor Authentication (2FA)" description="Require 2FA for all team members">
          <ToggleSwitch enabled={require2FA} onChange={setRequire2FA} />
        </SettingsRow>
        <SettingsRow label="Single Sign-On (SSO)">
          <div className="flex items-center justify-between gap-3">
            <ToggleSwitch enabled={enableSso} onChange={setEnableSso} />
            <button type="button" className="text-sm text-blue-600 hover:underline">Configure</button>
          </div>
        </SettingsRow>
        <SettingsRow label="IP Whitelist" border={false}>
          <textarea
            rows={3}
            value={ipWhitelist}
            onChange={(e) => setIpWhitelist(e.target.value)}
            placeholder="Enter allowed IPs, one per line"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2ed573] focus:ring-offset-1"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Change Password" description="Update your account password securely.">
        <div className="space-y-3 p-5">
          <SettingsInput value={currentPassword} onChange={setCurrentPassword} type="password" placeholder="Current Password" />
          <SettingsInput value={newPassword} onChange={setNewPassword} type="password" placeholder="New Password" />
          <SettingsInput value={confirmPassword} onChange={setConfirmPassword} type="password" placeholder="Confirm Password" />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <SaveButton onClick={onUpdatePassword} loading={changingPassword} label="Update Password" />
        </div>
      </SettingsSection>

      <div className="flex justify-end">
        <SaveButton onClick={onSave} loading={saving} label="Save Security Settings" />
      </div>
    </div>
  );
}
