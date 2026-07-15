import { useState } from "react";
import { ChangePassword } from "@/components/settings/sections/ChangePassword";
import { SaveButton } from "@/components/settings/ui/SaveButton";
import { SettingsInput } from "@/components/settings/ui/SettingsInput";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";
import { SettingsSelect } from "@/components/settings/ui/SettingsSelect";
import { ToggleSwitch } from "@/components/settings/ui/ToggleSwitch";

export function Security() {
  const [minPasswordLength, setMinPasswordLength] = useState("8");
  const [requireUppercase, setRequireUppercase] = useState(true);
  const [requireNumbers, setRequireNumbers] = useState(true);
  const [requireSpecial, setRequireSpecial] = useState(true);
  const [passwordExpiry, setPasswordExpiry] = useState("none");
  const [saving, setSaving] = useState(false);

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

      <ChangePassword />

      <div className="flex justify-end">
        <SaveButton onClick={onSave} loading={saving} label="Save Security Settings" />
      </div>
    </div>
  );
}
