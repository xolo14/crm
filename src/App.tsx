import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import RouteSeo from "@/components/seo/RouteSeo";
import { ReactNode, Suspense } from "react";
import { ThemeProvider } from "next-themes";
import LoginPortal from "@/pages/LoginPortal";
import Auth from "@/pages/Auth";
import { getPortalLoginRedirect, AUTH_PORTAL } from "@/lib/portalAuth";
import { normalizeAppRole } from "@/lib/roleUtils";
import HRLayout from "@/layouts/HRLayout";
import { canAccessFresherSalary, canAccessOfferLetters, canAccessCertificates, canAccessPayslip, canAccessPaymentRecords, canAccessPaymentsPage } from "@/lib/orgAccess";
import { isPathAllowedByOrgFeatures, FEATURE_FORM_MANAGEMENT } from "@/lib/orgFeatures";
import { managerFeatureKeyForPath, managerHasPageAccess } from "@/lib/managerPageAccess";
import { firstAllowedHrPath, hrFeatureKeyForPath, hrHasPageAccess } from "@/lib/hrPageAccess";
import { useFresherSalaryAccess } from "@/hooks/useFresherSalaryAccess";
import {
  Apply,
  Batches,
  CallLogPage,
  CertificateVerifyPage,
  CertificatesPage,
  CommunicationsAdminPage,
  CommunicationsHubPage,
  WhatsAppInboxPage,
  Courses,
  DailyReports,
  DailyReportsAnalytics,
  Dashboard,
  EmailAnalytics,
  FormApiIntegrationsPage,
  FormLeadHistory,
  FormLeads,
  FormsManagerPage,
  DocFormsHubPage,
  PublicDocFormPage,
  FresherSalaryTrackerPage,
  Holidays,
  HRAssignedLeads,
  HRCommunicationsPage,
  HRDashboard,
  HRHolidays,
  HRLeadsPage,
  HRMyLeads,
  HRNotifications,
  HRReports,
  HRTasks,
  ImportedLeads,
  LeadHistory,
  Leads,
  MarketingDashboard,
  MarketingPortal,
  MarketingPortalDashboard,
  MarketingMetaAdsPage,
  MetaPartnerPage,
  MyReferrals,
  NotFound,
  Notifications,
  OfferLetters,
  OrgWhatsAppSetupPage,
  PaymentLinksPage,
  PaymentLinksRecordsPage,
  PayslipPage,
  ReferralAnalytics,
  SettingsPage,
  Students,
  SuperAdminOrgDashboard,
  SuperAdminPanel,
  Tasks,
  Team,
  TemplateLibraryPage,
  Trash,
  WhatsAppAnalytics,
  WhatsAppPortal,
  PrivacyPolicyPage,
  TermsOfServicePage,
  AssessmentsAdminPage,
  PeaklyyAssessmentPage,
} from "@/routes/lazyPages";

const queryClient = new QueryClient();

function normalizePlatformRole(user: { role?: string } | null): string | null {
  if (!user) return null;
  const r = String(user.role || "").toLowerCase();
  if (r === "superadmin") return "super_admin";
  return r;
}

function AuthLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

/** One AppLayout for the whole CRM shell so the sidebar does not remount (and jump scroll) on route changes. */
function MainLayoutRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <AuthLoading />;
  if (!user) {
    return <Navigate to={getPortalLoginRedirect(location.pathname, location.search)} replace />;
  }
  // HR must stay in the HR portal shell — never the main CRM sidebar.
  if (normalizeAppRole(user.role) === "hr") {
    return <Navigate to={firstAllowedHrPath(user.page_access)} replace />;
  }
  return (
    <AppLayout>
      <OrgFeatureRoute>
        <Outlet />
      </OrgFeatureRoute>
    </AppLayout>
  );
}

/** Home route: render login immediately for guests (no / → /login redirect round-trip). */
function RootHome() {
  const { user, loading } = useAuth();
  if (loading) return <AuthLoading />;
  if (!user) return <LoginPortal />;
  const role = normalizeAppRole(user.role);
  if (role === "marketing") {
    return <Navigate to="/marketing/dashboard" replace />;
  }
  if (role === "hr") {
    return <Navigate to={firstAllowedHrPath(user.page_access)} replace />;
  }
  return (
    <AppLayout>
      <OrgFeatureRoute>
        <Suspense fallback={<AuthLoading />}>
          <Dashboard />
        </Suspense>
      </OrgFeatureRoute>
    </AppLayout>
  );
}

function OfferLettersGate({ children }: { children: ReactNode }) {
  const { user, organization } = useAuth();
  const role = normalizePlatformRole(user);
  if (!canAccessOfferLetters(role, organization, user?.page_access)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PaymentsPageGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const role = normalizePlatformRole(user);
  if (!canAccessPaymentsPage(role, user?.page_access)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function FresherSalaryGate({ children }: { children: ReactNode }) {
  const { user, organization } = useAuth();
  const role = normalizePlatformRole(user);
  const access = useFresherSalaryAccess();

  // Role / feature hard block
  if (!canAccessFresherSalary(role, organization, user?.page_access)) return <Navigate to="/" replace />;
  // Admins pass; trainees must be enrolled (added on tracker)
  if (access.loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }
  if (!access.allowed) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function CertificatesGate({ children }: { children: ReactNode }) {
  const { user, organization } = useAuth();
  const role = normalizePlatformRole(user);
  if (!canAccessCertificates(role, organization, user?.page_access)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PayslipGate({ children }: { children: ReactNode }) {
  const { user, organization } = useAuth();
  const role = normalizePlatformRole(user);
  if (!canAccessPayslip(role, organization)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PaymentRecordsGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const role = normalizePlatformRole(user);
  if (!canAccessPaymentRecords(role, user?.page_access)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Blocks routes when the org feature toggle is off; managers also need admin page grants. */
function OrgFeatureRoute({ children }: { children: ReactNode }) {
  const { user, organization } = useAuth();
  const location = useLocation();
  const role = normalizePlatformRole(user);
  if (!isPathAllowedByOrgFeatures(role, organization, location.pathname)) {
    return <Navigate to="/" replace />;
  }
  if (role === "manager") {
    const key = managerFeatureKeyForPath(location.pathname);
    if (key && !managerHasPageAccess(user?.page_access, key)) {
      // Avoid redirect loop on home when dashboard itself is denied.
      if (location.pathname === "/" || location.pathname === "") {
        return (
          <div className="flex min-h-[40vh] items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Dashboard access is not enabled for your account. Ask an admin to grant it under Team → Edit → Configure pages.
          </div>
        );
      }
      return <Navigate to="/" replace />;
    }
  }
  return <>{children}</>;
}

function CallLogAllowedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <AuthLoading />;
  const r = String(user?.role || "").toLowerCase();
  const n = r === "superadmin" ? "super_admin" : r === "organisation" ? "org" : r;
  const ok = ["sales_representative", "admin", "super_admin", "manager", "org"].includes(n);
  if (!ok) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SuperAdminGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "super_admin") return <Navigate to="/super_admin" replace />;
  return <>{children}</>;
}

function FormManagementGate({ children }: { children: ReactNode }) {
  const { user, hasFeature } = useAuth();
  const role = normalizePlatformRole(user);
  if (!role || !["super_admin", "admin", "org", "marketing", "manager"].includes(role)) {
    return <Navigate to="/" replace />;
  }
  if (!hasFeature(FEATURE_FORM_MANAGEMENT)) {
    return <Navigate to="/" replace />;
  }
  if (role === "manager" && !managerHasPageAccess(user?.page_access, FEATURE_FORM_MANAGEMENT)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function TeamPageGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const normalized = role === "superadmin" ? "super_admin" : role === "organisation" ? "org" : role;
  if (!["super_admin", "admin", "org", "manager"].includes(normalized)) return <Navigate to="/" replace />;
  if (normalized === "manager" && !managerHasPageAccess(user?.page_access, "team")) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function AdminSuperOrOrgGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const normalized = role === "superadmin" ? "super_admin" : role === "organisation" ? "org" : role;
  if (normalized === "hr") return <Navigate to={firstAllowedHrPath(user?.page_access)} replace />;
  if (!["super_admin", "admin", "org"].includes(normalized)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RoleGate({ allow, children }: { allow: string[]; children: ReactNode }) {
  const { user } = useAuth();
  const role = normalizePlatformRole(user);
  if (!role || !allow.includes(role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SettingsGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const role = normalizePlatformRole(user);
  // Keep HR inside the HR portal shell
  if (role === "hr") return <Navigate to={firstAllowedHrPath(user?.page_access)} replace />;
  return (
    <RoleGate
      allow={[
        "super_admin",
        "admin",
        "org",
        "manager",
        "sales_representative",
        "marketing",
        "trainer",
        "finance",
      ]}
    >
      {children}
    </RoleGate>
  );
}

function TrashGate({ children }: { children: ReactNode }) {
  return <RoleGate allow={["super_admin", "admin", "manager", "org"]}>{children}</RoleGate>;
}

function MarketingGate({ children }: { children: ReactNode }) {
  return <RoleGate allow={["super_admin", "admin", "manager", "marketing", "org"]}>{children}</RoleGate>;
}

function HRProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) return <AuthLoading />;
  const role = String(user?.role || "").toLowerCase();
  if (!user || role !== "hr") {
    return <Navigate to={AUTH_PORTAL.login} replace />;
  }
  return (
    <HRLayout>
      <Outlet />
    </HRLayout>
  );
}

/** Blocks HR portal child routes when admin did not grant that page. */
function HRPageGate({ children }: { children: ReactNode }) {
  const { user, organization } = useAuth();
  const location = useLocation();
  const key = hrFeatureKeyForPath(location.pathname);
  if (key && !hrHasPageAccess(user?.page_access, key)) {
    return <Navigate to={firstAllowedHrPath(user?.page_access)} replace />;
  }
  if (key === "offer_letters") {
    const role = normalizeAppRole(user?.role);
    if (!canAccessOfferLetters(role, organization, user?.page_access)) {
      return <Navigate to={firstAllowedHrPath(user?.page_access)} replace />;
    }
  }
  return <>{children}</>;
}

function HRIndexRedirect() {
  const { user } = useAuth();
  return <Navigate to={firstAllowedHrPath(user?.page_access)} replace />;
}

const App = () => (
  <ThemeProvider
    attribute="class"
    defaultTheme="system"
    enableSystem
    storageKey="crm-ui-theme"
    disableTransitionOnChange
  >
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <RouteSeo />
          <Suspense fallback={<AuthLoading />}>
          <Routes>
            <Route path="/apply" element={<Apply />} />
            <Route path="/doc-form/:slug" element={<PublicDocFormPage />} />
            <Route path="/assessment/:slug" element={<PeaklyyAssessmentPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsOfServicePage />} />
            <Route path="/login" element={<LoginPortal />} />
            <Route path="/super_admin" element={<Auth />} />
            <Route path="/admin" element={<Navigate to="/login" replace />} />
            <Route path="/organisation" element={<Navigate to="/login" replace />} />
            <Route path="/sales_rep_portal" element={<Navigate to="/login" replace />} />
            <Route path="/manager" element={<Navigate to="/login" replace />} />
            <Route path="/marketing" element={<Navigate to="/login" replace />} />
            <Route path="/auth" element={<Navigate to="/login" replace />} />
            <Route path="/hr-login" element={<Navigate to="/login" replace />} />
            <Route path="/sales-rep" element={<Navigate to="/login" replace />} />
            <Route path="/verify/:certId" element={<CertificateVerifyPage />} />
            <Route path="/" element={<RootHome />} />

            <Route element={<MainLayoutRoute />}>
              <Route path="/superadmin" element={<SuperAdminGate><SuperAdminPanel /></SuperAdminGate>} />
              <Route path="/super-admin" element={<Navigate to="/superadmin" replace />} />
              <Route path="/marketing-admin" element={<MarketingGate><MarketingDashboard /></MarketingGate>} />
              <Route path="/marketing-user" element={<Navigate to="/marketing/dashboard" replace />} />
              <Route path="/marketing-email" element={<MarketingGate><MarketingPortal /></MarketingGate>} />
              <Route path="/marketing-whatsapp" element={<MarketingGate><WhatsAppPortal /></MarketingGate>} />
              <Route path="/organizations" element={<SuperAdminGate><SuperAdminPanel /></SuperAdminGate>} />
              <Route path="/org-crm" element={<SuperAdminGate><SuperAdminOrgDashboard /></SuperAdminGate>} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/leads/history" element={<LeadHistory />} />
              <Route path="/leads/form-leads" element={<Leads />} />
              <Route path="/leads/hr-leads" element={<AdminSuperOrOrgGate><HRLeadsPage /></AdminSuperOrOrgGate>} />
              <Route path="/marketing/form-leads" element={<FormLeads />} />
              <Route path="/marketing/imported-leads" element={<ImportedLeads />} />
              <Route path="/leads/form-leads/history" element={<FormLeadHistory />} />
              {/* Legacy: assigned leads live inside source cards on Leads Management / My Leads */}
              <Route path="/assigned-leads" element={<Navigate to="/my-leads" replace />} />
              <Route path="/leads-management" element={<Leads />} />
              <Route path="/my-leads" element={<Leads />} />
              <Route path="/my-referrals" element={<MyReferrals />} />
              <Route path="/referral-analytics" element={<ReferralAnalytics />} />
              <Route path="/daily-reports" element={<DailyReports />} />
              <Route path="/daily-reports/analytics" element={<DailyReportsAnalytics />} />
              <Route path="/communications" element={<CommunicationsHubPage />} />
              <Route path="/communications/whatsapp-inbox" element={<WhatsAppInboxPage />} />
              <Route path="/communications/whatsapp-setup" element={<RoleGate allow={["super_admin", "admin", "org", "manager", "marketing"]}><OrgWhatsAppSetupPage /></RoleGate>} />
              <Route path="/communications/template-library" element={<AdminSuperOrOrgGate><TemplateLibraryPage /></AdminSuperOrOrgGate>} />
              <Route path="/communications/meta-partner" element={<SuperAdminGate><MetaPartnerPage /></SuperAdminGate>} />
              <Route path="/communications/admin" element={<SuperAdminGate><CommunicationsAdminPage /></SuperAdminGate>} />
              <Route
                path="/sales/call-log"
                element={
                  <CallLogAllowedRoute>
                    <CallLogPage />
                  </CallLogAllowedRoute>
                }
              />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/students" element={<Students />} />
              <Route path="/courses" element={<Courses />} />
              <Route path="/batches" element={<Batches />} />
              <Route path="/payments" element={<PaymentsPageGate><PaymentLinksPage /></PaymentsPageGate>} />
              <Route path="/payments/records" element={<PaymentRecordsGate><PaymentLinksRecordsPage /></PaymentRecordsGate>} />
              <Route path="/payment-links" element={<Navigate to="/payments" replace />} />
              <Route path="/payment-links/records" element={<Navigate to="/payments/records" replace />} />
              <Route path="/payments/students" element={<Navigate to="/payments" replace />} />
              <Route path="/payments/members" element={<Navigate to="/payments" replace />} />
              <Route path="/team" element={<TeamPageGate><Team /></TeamPageGate>} />
              <Route path="/fresher-salary-tracker" element={<FresherSalaryGate><FresherSalaryTrackerPage /></FresherSalaryGate>} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/reports" element={<Navigate to="/daily-reports" replace />} />
              <Route path="/settings" element={<SettingsGate><SettingsPage /></SettingsGate>} />
              <Route path="/marketing/dashboard" element={<MarketingGate><MarketingPortalDashboard /></MarketingGate>} />
              <Route path="/marketing/portal" element={<MarketingGate><MarketingPortal /></MarketingGate>} />
              <Route path="/marketing/analytics" element={<MarketingGate><EmailAnalytics /></MarketingGate>} />
              <Route path="/marketing/whatsapp" element={<MarketingGate><WhatsAppPortal /></MarketingGate>} />
              <Route path="/marketing/whatsapp-analytics" element={<MarketingGate><WhatsAppAnalytics /></MarketingGate>} />
              <Route path="/marketing/meta-ads" element={<MarketingGate><MarketingMetaAdsPage /></MarketingGate>} />
              <Route path="/holidays" element={<Holidays />} />
              <Route path="/assessments" element={<SuperAdminGate><AssessmentsAdminPage /></SuperAdminGate>} />
              <Route path="/trash" element={<TrashGate><Trash /></TrashGate>} />
              <Route path="/offer-letters" element={<OfferLettersGate><OfferLetters /></OfferLettersGate>} />
              <Route path="/certificates" element={<CertificatesGate><CertificatesPage /></CertificatesGate>} />
              <Route path="/payslip" element={<PayslipGate><PayslipPage /></PayslipGate>} />
              <Route path="/form-management" element={<FormManagementGate><FormsManagerPage /></FormManagementGate>} />
              <Route path="/form-management/doc-forms" element={<FormManagementGate><DocFormsHubPage /></FormManagementGate>} />
              <Route path="/my-doc-forms" element={<Navigate to="/" replace />} />
              <Route path="/form-api-integrations" element={<FormManagementGate><FormApiIntegrationsPage /></FormManagementGate>} />
              <Route path="*" element={<NotFound />} />
            </Route>

            <Route path="/hr" element={<HRProtectedRoute />}>
              <Route index element={<HRIndexRedirect />} />
              <Route path="dashboard" element={<HRPageGate><HRDashboard /></HRPageGate>} />
              <Route path="my-leads" element={<HRPageGate><HRMyLeads /></HRPageGate>} />
              <Route path="assigned-leads" element={<HRPageGate><HRAssignedLeads /></HRPageGate>} />
              <Route path="tasks" element={<HRPageGate><HRTasks /></HRPageGate>} />
              <Route path="reports" element={<HRPageGate><HRReports /></HRPageGate>} />
              <Route path="notifications" element={<HRPageGate><HRNotifications /></HRPageGate>} />
              <Route path="communications" element={<HRPageGate><HRCommunicationsPage /></HRPageGate>} />
              <Route path="holidays" element={<HRPageGate><HRHolidays /></HRPageGate>} />
              <Route path="offer-letters" element={<HRPageGate><OfferLetters /></HRPageGate>} />
              <Route path="settings" element={<HRPageGate><SettingsPage /></HRPageGate>} />
            </Route>
          </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ThemeProvider>
);

export default App;
