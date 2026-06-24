import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

export default function CrmSettings() {
  const { data: stages = [], isLoading: stagesLoading } = useQuery({
    queryKey: ['pipeline-stages'],
    queryFn: async () => { const res = await api.settings.stages(); return res.data || []; },
  });

  const { data: team = [], isLoading: teamLoading } = useQuery({
    queryKey: ['team-members'],
    queryFn: async () => { const res = await api.profiles.list(); return res.data || []; },
  });

  if (stagesLoading || teamLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Manage CRM configuration</p>
      </div>
      <div className="grid gap-4 sm:gap-6">
        <Card className="border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm sm:text-base">Pipeline Stages</CardTitle><CardDescription>Deal pipeline config</CardDescription></CardHeader>
          <CardContent className="px-3 sm:px-4">
            <div className="space-y-2 sm:space-y-3">
              {stages.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 py-1.5 sm:py-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color || '#6366f1' }} />
                  <span className="text-sm font-medium flex-1">{s.name}</span>
                  {s.is_default && <Badge variant="secondary" className="text-xs">Default</Badge>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 shadow-none">
          <CardHeader className="px-3 sm:px-4"><CardTitle className="text-sm sm:text-base">Team Members</CardTitle><CardDescription>Users in your organization</CardDescription></CardHeader>
          <CardContent className="px-3 sm:px-4">
            <div className="space-y-2 sm:space-y-3">
              {team.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between py-1.5 sm:py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{m.full_name || 'Unnamed'}</p>
                    <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                  </div>
                  {m.role && <Badge variant="outline" className="text-[10px] capitalize shrink-0 ml-2">{m.role?.replace(/_/g, ' ')}</Badge>}
                </div>
              ))}
              {team.length === 0 && <p className="text-sm text-muted-foreground">No team members found</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
