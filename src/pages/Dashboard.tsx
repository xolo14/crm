import { useAuth } from '@/hooks/useAuth';
import { normalizeAppRole } from '@/lib/roleUtils';
import AdminDashboard from './AdminDashboard';
import AbroadConsultantDashboard from './AbroadConsultantDashboard';
import ITServicesDashboard from './ITServicesDashboard';
import ManagerDashboard from './ManagerDashboard';
import OperationalManagerDashboard from './OperationalManagerDashboard';
import SalesRepDashboard from './SalesRepDashboard';
import SuperAdminDashboard from './SuperAdminDashboard';
import MarketingPortalDashboard from './MarketingPortalDashboard';

export default function Dashboard() {
  const { role: rawRole, organization } = useAuth();
  const role = normalizeAppRole(rawRole);

  // Super admin dashboard is always platform overview
  if (role === 'super_admin') return <SuperAdminDashboard />;

  // Marketing users see their portal (includes former sales_marketing capabilities).
  if (role === 'marketing') return <MarketingPortalDashboard />;

  // Industry-specific dashboards for Org Admin
  if (role === 'org') {
    const industry = organization?.industry;
    if (industry === 'abroad_consultant') return <AbroadConsultantDashboard />;
    if (industry === 'it_services') return <ITServicesDashboard />;
    return <AdminDashboard />;
  }

  // Payments / students ops overview (not the sales-rep or manager lead dashboards)
  if (role === 'operational_manager') return <OperationalManagerDashboard />;
  if (role === 'manager') return <ManagerDashboard />;
  return <SalesRepDashboard />;
}
