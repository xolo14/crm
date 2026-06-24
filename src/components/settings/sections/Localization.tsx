import { useState } from "react";
import { SaveButton } from "@/components/settings/ui/SaveButton";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSection } from "@/components/settings/ui/SettingsSection";
import { SettingsSelect } from "@/components/settings/ui/SettingsSelect";

export function Localization() {
  const [language, setLanguage] = useState("english");
  const [currency, setCurrency] = useState("inr");
  const [currencyPosition, setCurrencyPosition] = useState("before");
  const [numberFormat, setNumberFormat] = useState("indian");
  const [weekStart, setWeekStart] = useState("sunday");
  const [defaultLanguage, setDefaultLanguage] = useState("english");
  const [footerText, setFooterText] = useState("");
  const [saving, setSaving] = useState(false);

  const languageOptions = [
    { value: "english", label: "English" },
    { value: "hindi", label: "Hindi" },
    { value: "telugu", label: "Telugu" },
    { value: "tamil", label: "Tamil" },
  ];

  const onSave = () => {
    setSaving(true);
    window.setTimeout(() => setSaving(false), 900);
  };

  return (
    <div className="bg-gray-50">
      <SettingsSection title="Regional Settings" description="Define language, currency and number formatting preferences.">
        <SettingsRow label="Language">
          <SettingsSelect value={language} onChange={setLanguage} options={languageOptions} />
        </SettingsRow>
        <SettingsRow label="Currency">
          <SettingsSelect
            value={currency}
            onChange={setCurrency}
            options={[
              { value: "inr", label: "INR (₹)" },
              { value: "usd", label: "USD ($)" },
              { value: "eur", label: "EUR (€)" },
              { value: "gbp", label: "GBP (£)" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Currency Position">
          <SettingsSelect
            value={currencyPosition}
            onChange={setCurrencyPosition}
            options={[
              { value: "before", label: "Before amount (₹100)" },
              { value: "after", label: "After amount (100₹)" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Number Format">
          <SettingsSelect
            value={numberFormat}
            onChange={setNumberFormat}
            options={[
              { value: "indian", label: "1,00,000 (Indian)" },
              { value: "international", label: "1,000,000 (International)" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="First Day of Week" border={false}>
          <SettingsSelect
            value={weekStart}
            onChange={setWeekStart}
            options={[
              { value: "sunday", label: "Sunday" },
              { value: "monday", label: "Monday" },
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Communication" description="Set defaults for multilingual communication.">
        <SettingsRow label="Default Communication Language">
          <SettingsSelect value={defaultLanguage} onChange={setDefaultLanguage} options={languageOptions} />
        </SettingsRow>
        <SettingsRow label="Email Footer Text" border={false}>
          <textarea
            rows={2}
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2ed573] focus:ring-offset-1"
          />
        </SettingsRow>
      </SettingsSection>

      <div className="flex justify-end">
        <SaveButton onClick={onSave} loading={saving} label="Save Localization" />
      </div>
    </div>
  );
}
