import { ChangePassword } from "@/components/settings/sections/ChangePassword";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";

export function Security() {
  return (
    <div className="bg-gray-50">
      <SettingsSection
        title="Password Policy"
        description="Organization password rules are enforced by the server (api/config.php MIN_PASSWORD_LENGTH). Per-org UI policy is not available yet."
      >
        <SettingsRow label="Server enforcement" border={false}>
          <p className="text-sm text-muted-foreground max-w-md">
            Minimum length and strength checks run on signup, password change, and reset.
            There is no fake Save control — changing policy requires a config deploy.
          </p>
        </SettingsRow>
      </SettingsSection>

      <ChangePassword />
    </div>
  );
}
