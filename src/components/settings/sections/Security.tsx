import { ChangePassword } from "@/components/settings/sections/ChangePassword";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";

export function Security() {
  return (
    <div className="bg-gray-50">
      <SettingsSection
        title="Password Policy"
        description="Every account in your organization follows the same password rules."
      >
        <SettingsRow label="Password rules" border={false}>
          <p className="text-sm text-muted-foreground max-w-md">
            Passwords must be at least 8 characters. The rules are checked whenever someone
            signs up, changes or resets a password.
          </p>
        </SettingsRow>
      </SettingsSection>

      <ChangePassword />
    </div>
  );
}
