import { useState } from "react";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { AuditLogs } from "@/components/settings/sections/AuditLogs";
import { CompanyProfile } from "@/components/settings/sections/CompanyProfile";
import { DataPrivacy } from "@/components/settings/sections/DataPrivacy";
import { GeneralSettings } from "@/components/settings/sections/GeneralSettings";
import { Localization } from "@/components/settings/sections/Localization";
import { PipelineStages } from "@/components/settings/sections/PipelineStages";
import { Security } from "@/components/settings/sections/Security";
import { TagsAndLabels } from "@/components/settings/sections/TagsAndLabels";

const sectionComponents: Record<string, React.FC> = {
  general: GeneralSettings,
  "company-profile": CompanyProfile,
  localization: Localization,
  "pipeline-stages": PipelineStages,
  "tags-labels": TagsAndLabels,
  security: Security,
  "audit-logs": AuditLogs,
  "data-privacy": DataPrivacy,
};

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<string>("general");
  const ActiveSection = sectionComponents[activeSection] ?? GeneralSettings;

  return (
    <div className="bg-gray-50">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your CRM configuration</p>
      </div>

      <div className="flex min-h-[calc(100vh-160px)] gap-6">
        <SettingsNav active={activeSection} onChange={setActiveSection} />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <ActiveSection />
        </div>
      </div>
    </div>
  );
}
