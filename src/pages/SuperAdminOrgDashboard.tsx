import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import AdminDashboard from './AdminDashboard';
import AbroadConsultantDashboard from './AbroadConsultantDashboard';
import ITServicesDashboard from './ITServicesDashboard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function SuperAdminOrgDashboard() {
  const { organization, switchOrg } = useAuth();
  const navigate = useNavigate();

  if (!organization) {
    return (
      <Card className="border-border/50 shadow-none">
        <CardContent className="py-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">No organization selected.</p>
          <Button onClick={() => navigate('/organizations')}>Go to Organizations</Button>
        </CardContent>
      </Card>
    );
  }

  const handleExitOrgView = async () => {
    try {
      await switchOrg(null as any);
    } finally {
      navigate('/');
    }
  };

  const industry = organization?.industry;
  const dashboard =
    industry === 'abroad_consultant' ? <AbroadConsultantDashboard /> :
    industry === 'it_services' ? <ITServicesDashboard /> :
    <AdminDashboard />;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExitOrgView}>Exit Organization View</Button>
      </div>
      {dashboard}
    </div>
  );
}
