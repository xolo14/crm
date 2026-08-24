import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getRoleLevel, isL1OperationalRole, isL3AdminRole, normalizeAppRole } from "@/lib/roleUtils";
import { cn } from "@/lib/utils";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { AuditLogs } from "@/components/settings/sections/AuditLogs";
import { ChangePassword } from "@/components/settings/sections/ChangePassword";
import { CompanyProfile } from "@/components/settings/sections/CompanyProfile";
import { DataPrivacy } from "@/components/settings/sections/DataPrivacy";
import { GeneralSettings } from "@/components/settings/sections/GeneralSettings";
import { Security } from "@/components/settings/sections/Security";
import { EmailSetup } from "@/components/settings/sections/EmailSetup";
import { RazorpaySetup } from "@/components/settings/sections/RazorpaySetup";
import { BankPaymentDetails } from "@/components/settings/sections/BankPaymentDetails";
import { MetaAdsSetup } from "@/components/settings/sections/MetaAdsSetup";

function PersonalProfileSettings() {
  return <GeneralSettings personalOnly />;
}

const adminSectionComponents: Record<string, React.FC> = {
  general: GeneralSettings,
  "company-profile": CompanyProfile,
  "bank-payment": BankPaymentDetails,
  security: Security,
  "audit-logs": AuditLogs,
  "data-privacy": DataPrivacy,
};

const limitedSectionComponents: Record<string, React.FC> = {
  general: PersonalProfileSettings,
  password: ChangePassword,
};

/** Manager (L2) and L1 roles get General + Password Change only. HR portal always limited. */
function usesLimitedSettings(role?: string | null, pathname?: string): boolean {
  if (pathname?.startsWith("/hr")) return true;
  const r = normalizeAppRole(role);
  if (r === "hr" || isL1OperationalRole(r)) return true;
  if (r === "super_admin" || isL3AdminRole(r)) return false;
  return getRoleLevel(r) <= 2;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const inHrPortal = location.pathname.startsWith("/hr");
  const limited = usesLimitedSettings(user?.role, location.pathname);
  const normalizedRole = normalizeAppRole(user?.role);
  const canSeeEmailSetup =
    !limited && (normalizedRole === "super_admin" || isL3AdminRole(normalizedRole));
  const canSeeRazorpaySetup = canSeeEmailSetup;
  const canSeeMetaAdsSetup = canSeeEmailSetup;
  const sectionComponents = useMemo(
    () =>
      limited
        ? limitedSectionComponents
        : {
            ...adminSectionComponents,
            ...(canSeeEmailSetup ? { "email-setup": EmailSetup } : {}),
            ...(canSeeRazorpaySetup ? { "razorpay-setup": RazorpaySetup } : {}),
            ...(canSeeMetaAdsSetup ? { "meta-ads": MetaAdsSetup } : {}),
          },
    [limited, canSeeEmailSetup, canSeeRazorpaySetup, canSeeMetaAdsSetup],
  );
  const [activeSection, setActiveSection] = useState<string>("general");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has("meta_ads") && canSeeMetaAdsSetup) {
      setActiveSection("meta-ads");
    }
  }, [location.search, canSeeMetaAdsSetup]);

  useEffect(() => {
    if (!(activeSection in sectionComponents)) {
      setActiveSection("general");
    }
  }, [activeSection, sectionComponents]);

  const ActiveSection =
    sectionComponents[activeSection] ??
    (limited ? PersonalProfileSettings : GeneralSettings);

  return (
    <div
      className={cn(
        "min-w-0",
        !inHrPortal &&
          "md:flex md:h-[calc(100dvh-var(--crm-desktop-topbar-height)-3rem)] md:min-h-0 md:flex-col md:overflow-hidden",
      )}
    >
      <div className={cn("crm-page-header mb-4 md:mb-6", !inHrPortal && "md:shrink-0")}>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {limited ? "Manage your account preferences" : "Manage your CRM configuration"}
        </p>
      </div>

      <div
        className={cn(
          "flex flex-col gap-4 md:gap-0",
          !inHrPortal &&
            "md:flex-1 md:min-h-0 md:flex-row md:rounded-lg md:border md:border-border md:bg-card md:overflow-hidden",
        )}
      >
        <SettingsNav
          active={activeSection}
          onChange={setActiveSection}
          limited={limited}
          showEmailSetup={canSeeEmailSetup}
          showRazorpaySetup={canSeeRazorpaySetup}
          showMetaAdsSetup={canSeeMetaAdsSetup}
          isSuperAdmin={normalizedRole === "super_admin"}
          pillsOnly={inHrPortal}
        />
        <div
          className={cn(
            "min-w-0 flex-1",
            !inHrPortal && "md:min-h-0 md:overflow-y-auto md:p-6",
          )}
        >
          <ActiveSection />
        </div>
      </div>
    </div>
  );
}
