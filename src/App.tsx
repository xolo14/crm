import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import RouteSeo from "@/components/seo/RouteSeo";
import { ReactNode, Suspense } from "react";
import LoginPortal from "@/pages/LoginPortal";
import Auth from "@/pages/Auth";
import { getPortalLoginRedirect, AUTH_PORTAL } from "@/lib/portalAuth";
import HRLayout from "@/layouts/HRLayout";
import { canAccessFresherSalary, canAccessOfferLetters, canAccessCertificates, canAccessPayslip, canAccessPaymentRecords, canAccessPaymentsPage } from "@/lib/orgAccess";
import { isPathAllowedByOrgFeatures, FEATURE_FORM_MANAGEMENT } from "@/lib/orgFeatures";
import {
  Apply,
  AssignedLeads,
  Batches,
  CallLogPage,
  CertificateVerifyPage,
  CertificatesPage,
  CommunicationsAdminPage,
  CommunicationsHubPage,
  Courses,
  DailyReports,
  DailyReportsAnalytics,
  Dashboard,
  EmailAnalytics,
  FormApiIntegrationsPage,
  FormLeadHistory,
  FormLeads,
  FormsManagerPage,
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
  if (!canAccessFresherSalary(role, organization)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function CertificatesGate({ children }: { children: ReactNode }) {
  const { user, organization } = useAuth();
  const role = normalizePlatformRole(user);
  if (!canAccessCertificates(role, organization)) return <Navigate to="/" replace />;
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
  if (!canAccessPaymentRecords(role)) return <Navigate to="/payments" replace />;
  return <>{children}</>;
}

/** Blocks routes when the org feature toggle is off. */
function OrgFeatureRoute({ children }: { children: ReactNode }) {
  const { user, organization } = useAuth();
  const location = useLocation();
  const role = normalizePlatformRole(user);
  if (!isPathAllowedByOrgFeatures(role, organization, location.pathname)) {
    return <Navigate to="/" replace />;
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
  const { user, organization, hasFeature } = useAuth();
  const role = normalizePlatformRole(user);
  if (!role || !["super_admin", "admin", "org", "marketing", "manager"].includes(role)) {
    return <Navigate to="/" replace />;
  }
  if (!hasFeature(FEATURE_FORM_MANAGEMENT)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function TeamPageGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const normalized = role === "superadmin" ? "super_admin" : role;
  if (!["super_admin", "admin", "manager"].includes(normalized)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AdminSuperOrOrgGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const role = String(user?.role || "").toLowerCase();
  const normalized = role === "superadmin" ? "super_admin" : role === "organisation" ? "org" : role;
  if (normalized === "hr") return <Navigate to="/hr/dashboard" replace />;
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
  return (
    <RoleGate
      allow={[
        "super_admin",
        "admin",
        "org",
        "manager",
        "sales_representative",
        "hr",
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

function HRProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <AuthLoading />;
  const role = String(user?.role || "").toLowerCase();
  if (!user || role !== "hr") {
    return <Navigate to={AUTH_PORTAL.login} replace />;
  }
  return <HRLayout>{children}</HRLayout>;
}

const App = () => (
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
              <Route path="/assigned-leads" element={<AssignedLeads />} />
              <Route path="/leads-management" element={<Leads />} />
              <Route path="/my-leads" element={<Leads />} />
              <Route path="/my-referrals" element={<MyReferrals />} />
              <Route path="/referral-analytics" element={<ReferralAnalytics />} />
              <Route path="/daily-reports" element={<DailyReports />} />
              <Route path="/daily-reports/analytics" element={<DailyReportsAnalytics />} />
              <Route path="/communications" element={<CommunicationsHubPage />} />
              <Route path="/communications/whatsapp-setup" element={<AdminSuperOrOrgGate><OrgWhatsAppSetupPage /></AdminSuperOrOrgGate>} />
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
              <Route path="/holidays" element={<Holidays />} />
              <Route path="/trash" element={<TrashGate><Trash /></TrashGate>} />
              <Route path="/offer-letters" element={<OfferLettersGate><OfferLetters /></OfferLettersGate>} />
              <Route path="/certificates" element={<CertificatesGate><CertificatesPage /></CertificatesGate>} />
              <Route path="/payslip" element={<PayslipGate><PayslipPage /></PayslipGate>} />
              <Route path="/form-management" element={<FormManagementGate><FormsManagerPage /></FormManagementGate>} />
              <Route path="/form-api-integrations" element={<FormManagementGate><FormApiIntegrationsPage /></FormManagementGate>} />
              <Route path="*" element={<NotFound />} />
            </Route>

            <Route path="/hr/dashboard" element={<HRProtectedRoute><HRDashboard /></HRProtectedRoute>} />
            <Route path="/hr/my-leads" element={<HRProtectedRoute><HRMyLeads /></HRProtectedRoute>} />
            <Route path="/hr/assigned-leads" element={<HRProtectedRoute><HRAssignedLeads /></HRProtectedRoute>} />
            <Route path="/hr/tasks" element={<HRProtectedRoute><HRTasks /></HRProtectedRoute>} />
            <Route path="/hr/reports" element={<HRProtectedRoute><HRReports /></HRProtectedRoute>} />
            <Route path="/hr/notifications" element={<HRProtectedRoute><HRNotifications /></HRProtectedRoute>} />
            <Route path="/hr/communications" element={<HRProtectedRoute><HRCommunicationsPage /></HRProtectedRoute>} />
            <Route path="/hr/holidays" element={<HRProtectedRoute><HRHolidays /></HRProtectedRoute>} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
