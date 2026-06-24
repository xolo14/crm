import { useAuth } from '@/hooks/useAuth';
import AdminDashboard from './AdminDashboard';
import AbroadConsultantDashboard from './AbroadConsultantDashboard';
import ITServicesDashboard from './ITServicesDashboard';
import ManagerDashboard from './ManagerDashboard';
import SalesRepDashboard from './SalesRepDashboard';
import SuperAdminDashboard from './SuperAdminDashboard';
import MarketingPortalDashboard from './MarketingPortalDashboard';

export default function Dashboard() {
  const { role, organization } = useAuth();

  // Super admin dashboard is always platform overview
  if (role === 'super_admin') return <SuperAdminDashboard />;

  // Marketing users see their portal; sales_marketing uses the sales rep dashboard (limited nav)
  if (role === 'marketing') return <MarketingPortalDashboard />;
  if (role === 'sales_marketing') return <SalesRepDashboard />;

  // Industry-specific dashboards for admin/super_admin
  if (role === 'admin' || role === 'org') {
    const industry = organization?.industry;
    if (industry === 'abroad_consultant') return <AbroadConsultantDashboard />;
    if (industry === 'it_services') return <ITServicesDashboard />;
    return <AdminDashboard />;
  }

  if (role === 'manager') return <ManagerDashboard />;
  return <SalesRepDashboard />;
}
