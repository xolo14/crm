import { lazy, Suspense } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { normalizeAppRole } from '@/lib/roleUtils';

const AdminDashboard = lazy(() => import('./AdminDashboard'));
const AbroadConsultantDashboard = lazy(() => import('./AbroadConsultantDashboard'));
const ITServicesDashboard = lazy(() => import('./ITServicesDashboard'));
const ManagerDashboard = lazy(() => import('./ManagerDashboard'));
const OperationalManagerDashboard = lazy(() => import('./OperationalManagerDashboard'));
const SalesRepDashboard = lazy(() => import('./SalesRepDashboard'));
const SuperAdminDashboard = lazy(() => import('./SuperAdminDashboard'));
const MarketingPortalDashboard = lazy(() => import('./MarketingPortalDashboard'));

function DashboardFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Loading dashboard…
    </div>
  );
}

export default function Dashboard() {
  const { role: rawRole, organization } = useAuth();
  const role = normalizeAppRole(rawRole);

  let Page = SalesRepDashboard;
  if (role === 'super_admin') Page = SuperAdminDashboard;
  else if (role === 'marketing') Page = MarketingPortalDashboard;
  else if (role === 'org') {
    const industry = organization?.industry;
    if (industry === 'abroad_consultant') Page = AbroadConsultantDashboard;
    else if (industry === 'it_services') Page = ITServicesDashboard;
    else Page = AdminDashboard;
  } else if (role === 'operational_manager') Page = OperationalManagerDashboard;
  else if (role === 'manager') Page = ManagerDashboard;

  return (
    <Suspense fallback={<DashboardFallback />}>
      <Page />
    </Suspense>
  );
}
