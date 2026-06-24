import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Leads from "@/pages/Leads";
import Students from "@/pages/Students";
import Courses from "@/pages/Courses";
import Batches from "@/pages/Batches";
import PaymentLinksPage from "@/pages/payment-links/PaymentLinksPage";
import PaymentLinksRecordsPage from "@/pages/payment-links/PaymentLinksRecordsPage";
import Team from "@/pages/Team";
import SettingsPage from "@/pages/settings/SettingsPage";
import Tasks from "@/pages/Tasks";
import Apply from "@/pages/Apply";
import MyReferrals from "@/pages/MyReferrals";
import ReferralAnalytics from "@/pages/ReferralAnalytics";
import FormLeads from "@/pages/FormLeads";
import ImportedLeads from "@/pages/ImportedLeads";
import LeadHistory from "@/pages/LeadHistory";
import FormLeadHistory from "@/pages/FormLeadHistory";
import AssignedLeads from "@/pages/AssignedLeads";
import DailyReports from "@/pages/DailyReports";
import DailyReportsAnalytics from "@/pages/DailyReportsAnalytics";
import Notifications from "@/pages/Notifications";
import MarketingDashboard from "@/pages/MarketingDashboard";
import MarketingPortal from "@/pages/MarketingPortal";
import MarketingPortalDashboard from "@/pages/MarketingPortalDashboard";
import EmailAnalytics from "@/pages/EmailAnalytics";
import WhatsAppPortal from "@/pages/WhatsAppPortal";
import WhatsAppAnalytics from "@/pages/WhatsAppAnalytics";
import Holidays from "@/pages/Holidays";
import Trash from "@/pages/Trash";
import OfferLetters from "@/pages/OfferLetters";
import CertificatesPage, { CertificateVerifyPage } from "./pages/CertificatesPage";
import PayslipPage from "@/pages/payslip/PayslipPage";
import FormsManagerPage from "@/pages/FormsManagerPage";
import SuperAdminPanel from "@/pages/SuperAdminPanel";
import SuperAdminOrgDashboard from "@/pages/SuperAdminOrgDashboard";
import NotFound from "./pages/NotFound";
import { ReactNode } from "react";
import { getPortalLoginRedirect } from "@/lib/portalAuth";
import HRLayout from "@/layouts/HRLayout";
import HRLogin from "@/pages/HRLogin";
import HRDashboard from "@/pages/hr/HRDashboard";
import HRMyLeads from "@/pages/hr/MyLeads";
import HRAssignedLeads from "@/pages/hr/AssignedLeads";
import HRTasks from "@/pages/hr/Tasks";
import HRReports from "@/pages/hr/Reports";
import HRNotifications from "@/pages/hr/Notifications";
import HRHolidays from "@/pages/hr/Holidays";
import HRCommunicationsPage from "@/pages/hr/HRCommunicationsPage";
import HRLeadsPage from "@/pages/leads/HRLeadsPage";
import CommunicationsHubPage from "@/pages/communications/CommunicationsHubPage";
import CommunicationsAdminPage from "@/pages/communications/CommunicationsAdminPage";
import OrgWhatsAppSetupPage from "@/pages/communications/OrgWhatsAppSetupPage";
import MetaPartnerPage from "@/pages/communications/MetaPartnerPage";
import TemplateLibraryPage from "@/pages/communications/TemplateLibraryPage";
import FresherSalaryTrackerPage from "@/pages/FresherSalaryTrackerPage";
import { canAccessFresherSalary, canAccessOfferLetters } from "@/lib/orgAccess";

const queryClient = new QueryClient();

function normalizePlatformRole(user: { role?: string } | null): string | null {
  if (!user) return null;
  const r = String(user.role || "").toLowerCase();
  if (r === "superadmin") return "super_admin";
  return r;
}

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
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
      <Outlet />
    </AppLayout>
  );
}

function OfferLettersGate({ children }: { children: ReactNode }) {
  const { user, organization } = useAuth();
  const role = normalizePlatformRole(user);
  if (!canAccessOfferLetters(role, organization)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function FresherSalaryGate({ children }: { children: ReactNode }) {
  const { user, organization } = useAuth();
  const role = normalizePlatformRole(user);
  if (!canAccessFresherSalary(role, organization)) return <Navigate to="/" replace />;
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

function AdminOrSuperAdminGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "super_admin" && user?.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function FormManagementGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const role = normalizePlatformRole(user);
  if (!role || !["super_admin", "admin", "sales_marketing"].includes(role)) return <Navigate to="/" replace />;
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

function HRProtectedRoute({ children }: { children: ReactNode }) {
  const token = localStorage.getItem("hr_token");
  const userRaw = localStorage.getItem("hr_user");
  const user = userRaw ? JSON.parse(userRaw) : null;
  if (!token || !user || String(user.role || "").toLowerCase() !== "hr") {
    return <Navigate to="/hr-login" replace />;
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
          <Routes>
            <Route path="/apply" element={<Apply />} />
            <Route path="/sales_rep_portal" element={<Auth />} />
            <Route path="/super_admin" element={<Auth />} />
            <Route path="/admin" element={<Auth />} />
            <Route path="/organisation" element={<Navigate to="/admin" replace />} />
            <Route path="/marketing" element={<Auth />} />
            <Route path="/manager" element={<Auth />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/hr-login" element={<HRLogin />} />
            <Route path="/sales-rep" element={<Navigate to="/sales_rep_portal" replace />} />
            <Route path="/verify/:certId" element={<CertificateVerifyPage />} />

            <Route element={<MainLayoutRoute />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/superadmin" element={<SuperAdminGate><SuperAdminPanel /></SuperAdminGate>} />
              <Route path="/super-admin" element={<Navigate to="/superadmin" replace />} />
              <Route path="/marketing-admin" element={<MarketingDashboard />} />
              <Route path="/marketing-user" element={<MarketingPortalDashboard />} />
              <Route path="/marketing-email" element={<MarketingPortal />} />
              <Route path="/marketing-whatsapp" element={<WhatsAppPortal />} />
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
              <Route path="/payments" element={<PaymentLinksPage />} />
              <Route path="/payments/records" element={<PaymentLinksRecordsPage />} />
              <Route path="/payment-links" element={<Navigate to="/payments" replace />} />
              <Route path="/payment-links/records" element={<Navigate to="/payments/records" replace />} />
              <Route path="/payments/students" element={<Navigate to="/payments" replace />} />
              <Route path="/payments/members" element={<Navigate to="/payments" replace />} />
              <Route path="/team" element={<TeamPageGate><Team /></TeamPageGate>} />
              <Route path="/fresher-salary-tracker" element={<FresherSalaryGate><FresherSalaryTrackerPage /></FresherSalaryGate>} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/reports" element={<Navigate to="/daily-reports" replace />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/marketing/dashboard" element={<MarketingPortalDashboard />} />
              <Route path="/marketing/portal" element={<MarketingPortal />} />
              <Route path="/marketing/analytics" element={<EmailAnalytics />} />
              <Route path="/marketing/whatsapp" element={<WhatsAppPortal />} />
              <Route path="/marketing/whatsapp-analytics" element={<WhatsAppAnalytics />} />
              <Route path="/holidays" element={<Holidays />} />
              <Route path="/trash" element={<Trash />} />
              <Route path="/offer-letters" element={<OfferLettersGate><OfferLetters /></OfferLettersGate>} />
              <Route path="/certificates" element={<SuperAdminGate><CertificatesPage /></SuperAdminGate>} />
              <Route path="/payslip" element={<PayslipPage />} />
              <Route path="/form-management" element={<FormManagementGate><FormsManagerPage /></FormManagementGate>} />
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
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
