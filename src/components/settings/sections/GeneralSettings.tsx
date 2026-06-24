import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { SaveButton } from "@/components/settings/ui/SaveButton";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";
import { SettingsSelect } from "@/components/settings/ui/SettingsSelect";
import { ToggleSwitch } from "@/components/settings/ui/ToggleSwitch";
import { Input } from "@/components/ui/input";

export function GeneralSettings() {
  const { profile } = useAuth();
  const [theme, setTheme] = useState("light");
  const [compactMode, setCompactMode] = useState(false);
  const [collapsedSidebar, setCollapsedSidebar] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [inAppNotifications, setInAppNotifications] = useState(true);
  const [smsAlerts, setSmsAlerts] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState(true);
  const [dateFormat, setDateFormat] = useState("ddmmyyyy");
  const [timeFormat, setTimeFormat] = useState("12h");
  const [timezone, setTimezone] = useState("ist");
  const [saving, setSaving] = useState(false);

  const onSave = () => {
    setSaving(true);
    window.setTimeout(() => setSaving(false), 900);
  };

  const themeOptions = [
    { key: "light", icon: "☀", label: "Light" },
    { key: "dark", icon: "🌙", label: "Dark" },
    { key: "system", icon: "💻", label: "System" },
  ];

  return (
    <div className="bg-gray-50">
      <SettingsSection title="Account" description="Profile information and referral code.">
        <SettingsRow label="Referral code" description="Read-only. Contact your administrator if this is blank." border={false}>
          <Input readOnly value={profile?.referral_code || "—"} className="max-w-md rounded-lg border border-gray-200 bg-gray-50 font-mono text-sm" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Appearance" description="Customize how the CRM looks and feels.">
        <SettingsRow label="Theme" description="Choose your interface theme">
          <div className="flex gap-2">
            {themeOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setTheme(option.key)}
                className={`w-24 rounded-xl p-3 text-center text-xs font-medium transition-all duration-150 ease-in-out ${
                  option.key === theme
                    ? "border-2 border-[#2ed573] bg-[#e6faf0] text-[#0f5230]"
                    : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                <div>{option.icon}</div>
                <div className="mt-1">{option.label}</div>
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="Compact Mode" description="Reduce spacing for denser layout">
          <ToggleSwitch enabled={compactMode} onChange={setCompactMode} />
        </SettingsRow>
        <SettingsRow label="Sidebar collapsed by default" description="Start with sidebar minimized" border={false}>
          <ToggleSwitch enabled={collapsedSidebar} onChange={setCollapsedSidebar} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Notifications" description="Control which notifications you receive.">
        <SettingsRow label="Email Notifications">
          <ToggleSwitch enabled={emailNotifications} onChange={setEmailNotifications} />
        </SettingsRow>
        <SettingsRow label="In-app Notifications">
          <ToggleSwitch enabled={inAppNotifications} onChange={setInAppNotifications} />
        </SettingsRow>
        <SettingsRow label="SMS Alerts">
          <ToggleSwitch enabled={smsAlerts} onChange={setSmsAlerts} />
        </SettingsRow>
        <SettingsRow label="Weekly Summary Email" border={false}>
          <ToggleSwitch enabled={weeklySummary} onChange={setWeeklySummary} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Date & Time" description="Choose your preferred date and time formats.">
        <SettingsRow label="Date Format">
          <SettingsSelect
            value={dateFormat}
            onChange={setDateFormat}
            options={[
              { value: "ddmmyyyy", label: "DD/MM/YYYY" },
              { value: "mmddyyyy", label: "MM/DD/YYYY" },
              { value: "yyyymmdd", label: "YYYY-MM-DD" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Time Format">
          <SettingsSelect
            value={timeFormat}
            onChange={setTimeFormat}
            options={[
              { value: "12h", label: "12 Hour" },
              { value: "24h", label: "24 Hour" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Timezone" border={false}>
          <SettingsSelect
            value={timezone}
            onChange={setTimezone}
            options={[
              { value: "ist", label: "IST" },
              { value: "utc", label: "UTC" },
              { value: "est", label: "EST" },
              { value: "pst", label: "PST" },
              { value: "gmt", label: "GMT" },
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <div className="flex justify-end">
        <SaveButton onClick={onSave} loading={saving} label="Save General Settings" />
      </div>
    </div>
  );
}
