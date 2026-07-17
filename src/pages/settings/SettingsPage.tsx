import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getRoleLevel, isL3AdminRole, normalizeAppRole } from "@/lib/roleUtils";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { AuditLogs } from "@/components/settings/sections/AuditLogs";
import { ChangePassword } from "@/components/settings/sections/ChangePassword";
import { CompanyProfile } from "@/components/settings/sections/CompanyProfile";
import { DataPrivacy } from "@/components/settings/sections/DataPrivacy";
import { GeneralSettings } from "@/components/settings/sections/GeneralSettings";
import { Localization } from "@/components/settings/sections/Localization";
import { Security } from "@/components/settings/sections/Security";
import { EmailSetup } from "@/components/settings/sections/EmailSetup";

function PersonalProfileSettings() {
  return <GeneralSettings personalOnly />;
}

const adminSectionComponents: Record<string, React.FC> = {
  general: GeneralSettings,
  "company-profile": CompanyProfile,
  localization: Localization,
  security: Security,
  "audit-logs": AuditLogs,
  "data-privacy": DataPrivacy,
};

const limitedSectionComponents: Record<string, React.FC> = {
  general: PersonalProfileSettings,
  password: ChangePassword,
};

/** Manager (L2) and L1 roles get General + Password Change only. */
function usesLimitedSettings(role?: string | null): boolean {
  const r = normalizeAppRole(role);
  if (r === "super_admin" || isL3AdminRole(r)) return false;
  return getRoleLevel(r) <= 2;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const limited = usesLimitedSettings(user?.role);
  const normalizedRole = normalizeAppRole(user?.role);
  const canSeeEmailSetup = normalizedRole === "super_admin" || isL3AdminRole(normalizedRole);
  const sectionComponents = useMemo(
    () =>
      limited
        ? limitedSectionComponents
        : {
            ...adminSectionComponents,
            ...(canSeeEmailSetup ? { "email-setup": EmailSetup } : {}),
          },
    [limited, canSeeEmailSetup],
  );
  const [activeSection, setActiveSection] = useState<string>("general");

  useEffect(() => {
    if (!(activeSection in sectionComponents)) {
      setActiveSection("general");
    }
  }, [activeSection, sectionComponents]);

  const ActiveSection = sectionComponents[activeSection] ?? GeneralSettings;

  return (
    <div className="min-w-0">
      <div className="mb-4 md:mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {limited ? "Manage your account preferences" : "Manage your CRM configuration"}
        </p>
      </div>

      <div className="flex flex-col md:flex-row md:min-h-[calc(100dvh-160px)] gap-4 md:gap-6 md:rounded-lg md:border md:border-border md:bg-card md:overflow-hidden">
        <SettingsNav active={activeSection} onChange={setActiveSection} limited={limited} showEmailSetup={canSeeEmailSetup} />
        <div className="min-w-0 flex-1 md:overflow-y-auto md:p-6">
          <ActiveSection />
        </div>
      </div>
    </div>
  );
}
