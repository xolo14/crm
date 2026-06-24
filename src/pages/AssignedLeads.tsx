import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search, Users, Phone, Mail, Building2, GraduationCap, Calendar, RefreshCw } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';

const STATUS_LABELS: Record<string, string> = {
  new: 'New', contacted: 'Contacted', interested: 'Interested',
  demo_scheduled: 'Demo Scheduled', demo_attended: 'Demo Attended',
  considering: 'Considering', enrolled: 'Enroll', lost: 'Lost',
};

const labelForLeadStatus = (s?: string) => {
  if (!s) return '';
  if (s === 'converted') return 'Enroll';
  return STATUS_LABELS[s] || s.replace(/_/g, ' ');
};

const badgeColorKey = (s?: string) => (s === 'converted' ? 'enrolled' : s || '');

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-700 border-blue-200',
  contacted: 'bg-amber-500/10 text-amber-700 border-amber-200',
  interested: 'bg-emerald-500/10 text-emerald-700 border-emerald-200',
  demo_scheduled: 'bg-indigo-500/10 text-indigo-700 border-indigo-200',
  demo_attended: 'bg-purple-500/10 text-purple-700 border-purple-200',
  considering: 'bg-orange-500/10 text-orange-700 border-orange-200',
  enrolled: 'bg-teal-500/10 text-teal-800 border-teal-200',
  converted: 'bg-green-500/10 text-green-700 border-green-200',
  lost: 'bg-red-500/10 text-red-700 border-red-200',
};

export default function AssignedLeads() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchLeads = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter !== 'all' && statusFilter !== 'enrolled') params.status = statusFilter;
      if (search) params.search = search;
      const res = await api.leadAssignments.myLeads(params);
      let rows = res.data || [];
      if (statusFilter === 'enrolled') {
        rows = rows.filter((l: any) => l.status === 'enrolled' || l.status === 'converted');
      }
      setLeads(rows);
    } catch (err) {
      console.error(err);
      toast({ title: 'Error loading leads', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLeads(); }, [user, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => { if (user) fetchLeads(); }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const total = leads.length;
  const newCount = leads.filter(l => l.status === 'new').length;
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">My Assigned Leads</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">All leads assigned to you by admin/manager</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchLeads} disabled={loading} className="gap-1.5 self-start">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-4">
        {[
          { label: 'Total Leads', value: total, color: 'text-primary' },
          { label: 'New', value: newCount, color: 'text-blue-600' },
        ].map(c => (
          <Card key={c.label} className="border-border/50 shadow-none">
            <CardContent className="p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs font-medium text-muted-foreground">{c.label}</p>
              <p className={`text-xl sm:text-2xl font-bold ${c.color}`}>{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44 h-9 text-sm">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : leads.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No leads found</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Leads assigned to you will appear here</p>
          </CardContent>
        </Card>
      ) : isMobile ? (
        /* Mobile Card View */
        <div className="space-y-2">
          {leads.map(lead => (
            <Card key={lead.id} className="border-border/50 shadow-none">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{lead.name}</p>
                    {lead.college && <p className="text-xs text-muted-foreground truncate flex items-center gap-1"><GraduationCap className="h-3 w-3 shrink-0" />{lead.college}</p>}
                  </div>
                  <Badge variant="outline" className={`text-[10px] shrink-0 capitalize ${statusColors[badgeColorKey(lead.status)] || ''}`}>
                    {labelForLeadStatus(lead.status)}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {lead.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{lead.phone}</span>}
                  {lead.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{lead.email}</span>}
                  {lead.company && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{lead.company}</span>}
                </div>
                {lead.next_follow_up && (
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-amber-600">
                    <Calendar className="h-3 w-3" />
                    Follow-up: {new Date(lead.next_follow_up).toLocaleDateString()}
                  </div>
                )}
                {lead.source && (
                  <Badge variant="secondary" className="mt-2 text-[10px]">{lead.source.replace(/_/g, ' ')}</Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        /* Desktop Table View */
        <Card className="border-border/50 shadow-none">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>College</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Follow-up</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map(lead => (
                  <TableRow key={lead.id}>
                    <TableCell className="font-medium">{lead.name}</TableCell>
                    <TableCell className="text-sm">{lead.phone || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{lead.email || '—'}</TableCell>
                    <TableCell className="text-sm">{lead.college || '—'}</TableCell>
                    <TableCell>
                      {lead.source && <Badge variant="secondary" className="text-xs capitalize">{lead.source.replace(/_/g, ' ')}</Badge>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs capitalize ${statusColors[badgeColorKey(lead.status)] || ''}`}>
                        {labelForLeadStatus(lead.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {lead.next_follow_up ? new Date(lead.next_follow_up).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <p className="text-xs text-muted-foreground text-center mt-4">
        Showing {leads.length} lead{leads.length !== 1 ? 's' : ''}
      </p>
    </div>
  );
}
