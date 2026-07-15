import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { phpList } from '@/lib/phpList';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import * as perms from '@/lib/permissions';
import { Search, Loader2, Phone, Mail, Users, Target, CheckCircle2, Clock, Eye, Building2, GraduationCap, StickyNote, ArrowUpRight, XCircle, ChevronLeft, ChevronRight, Download, Upload, FileDown } from 'lucide-react';
import { format } from 'date-fns';

const LEAD_STATUSES = ['new', 'contacted', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'] as const;

const formatLeadStatus = (s?: string | null) => {
  if (!s) return '';
  if (s === 'enrolled' || s === 'converted') return 'Enroll';
  return s.replace(/_/g, ' ');
};

const statusBadgeKey = (s?: string | null) => (s === 'converted' ? 'enrolled' : s || '');
const formatLeadStatusTitle = (s?: string | null) => formatLeadStatus(s).replace(/\b\w/g, (c) => c.toUpperCase());

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-700 border-blue-200',
  contacted: 'bg-amber-500/10 text-amber-700 border-amber-200',
  interested: 'bg-emerald-500/10 text-emerald-700 border-emerald-200',
  demo_scheduled: 'bg-indigo-500/10 text-indigo-700 border-indigo-200',
  demo_attended: 'bg-violet-500/10 text-violet-700 border-violet-200',
  considering: 'bg-orange-500/10 text-orange-700 border-orange-200',
  enrolled: 'bg-teal-500/10 text-teal-800 border-teal-200',
  converted: 'bg-green-500/10 text-green-700 border-green-200',
  lost: 'bg-red-500/10 text-red-700 border-red-200',
};

const SOURCE_LABELS: Record<string, string> = {
  google_ads: 'Google Ads', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube',
  website: 'Website', google_forms: 'Google Forms', whatsapp: 'WhatsApp', referral: 'Referral',
  walkin: 'Walk-in', college_seminar: 'College Seminar', other: 'Other',
};

const PAGE_SIZE = 25;

export default function ImportedLeads() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const hasExport = perms.canExport(role);
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [referralCode, setReferralCode] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedLead, setSelectedLead] = useState<any | null>(null);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const code = user?.referral_code || '';
      setReferralCode(code);
      if (code) {
        const leadsRes = await api.leads.list({ referred_by: code });
        setLeads(phpList(leadsRes));
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    return leads.filter(l => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'enrolled') {
          if (l.status !== 'enrolled' && l.status !== 'converted') return false;
        } else if (l.status !== statusFilter) return false;
      }
      if (sourceFilter !== 'all' && l.source !== sourceFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return [l.name, l.email, l.phone, l.college].some(v => v?.toLowerCase().includes(s));
      }
      return true;
    });
  }, [leads, search, statusFilter, sourceFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = useMemo(() => {
    const total = leads.length;
    const converted = leads.filter(l => l.status === 'converted' || l.status === 'enrolled').length;
    const active = leads.filter(l => !['converted', 'enrolled', 'lost'].includes(l.status || '')).length;
    const lost = leads.filter(l => l.status === 'lost').length;
    return { total, converted, active, lost };
  }, [leads]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    if (filtered.length === 0) return;
    const headers = ['S.No', 'Name', 'Email', 'Phone', 'College', 'Source', 'Status', 'Created At'];
    const rows = filtered.map((l, i) => [
      i + 1, l.name, l.email || '', l.phone || '', l.college || '',
      SOURCE_LABELS[l.source] || l.source || '', l.status || '', format(new Date(l.created_at), 'dd/MM/yyyy'),
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `imported_leads_${format(new Date(), 'yyyyMMdd')}.csv`; a.click();
  };

  const handleDownloadTemplate = () => {
    const headers = ['Name', 'Email', 'Phone', 'College', 'Year of Study', 'Source', 'Notes'];
    const sampleRow = ['John Doe', 'john@example.com', '9876543210', 'ABC University', '3rd Year', 'google_ads', 'Interested in Python course'];
    const csv = [headers, sampleRow].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lead_import_template.csv'; a.click();
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !referralCode) return;
    e.target.value = '';

    try {
      const text = await file.text();
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) { toast({ variant: 'destructive', title: 'Empty file', description: 'CSV must have a header row and at least one data row.' }); return; }

      const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());
      const nameIdx = headers.findIndex(h => h === 'name');
      const emailIdx = headers.findIndex(h => h === 'email');
      const phoneIdx = headers.findIndex(h => h === 'phone');
      const collegeIdx = headers.findIndex(h => h === 'college');
      const yearIdx = headers.findIndex(h => ['year of study', 'year_of_study', 'year'].includes(h));
      const sourceIdx = headers.findIndex(h => h === 'source');
      const notesIdx = headers.findIndex(h => h === 'notes');

      if (nameIdx === -1) { toast({ variant: 'destructive', title: 'Invalid CSV', description: 'CSV must have a "Name" column.' }); return; }

      const validSources = Object.keys(SOURCE_LABELS);
      const newLeads = lines.slice(1).map(line => {
        const cols = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(c => c.replace(/^"|"$/g, '').trim()) || line.split(',').map(c => c.replace(/^"|"$/g, '').trim());
        const rawSource = sourceIdx >= 0 ? (cols[sourceIdx] || '').toLowerCase().replace(/\s+/g, '_') : '';
        return {
          name: cols[nameIdx] || 'Unknown',
          email: emailIdx >= 0 ? cols[emailIdx] || null : null,
          phone: phoneIdx >= 0 ? cols[phoneIdx] || null : null,
          college: collegeIdx >= 0 ? cols[collegeIdx] || null : null,
          year_of_study: yearIdx >= 0 ? cols[yearIdx] || null : null,
          source: (validSources.includes(rawSource) ? rawSource : 'other') as string,
          notes: notesIdx >= 0 ? cols[notesIdx] || null : null,
          referred_by: referralCode,
          status: 'new' as const,
        };
      }).filter(l => l.name && l.name !== 'Unknown');

      if (newLeads.length === 0) { toast({ variant: 'destructive', title: 'No valid rows', description: 'Could not parse any leads from the CSV.' }); return; }

      await api.leads.bulkCreate(newLeads);

      toast({ title: 'Import successful', description: `${newLeads.length} lead(s) imported.` });
      fetchData();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Import failed', description: err.message });
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-5 w-5 md:h-6 md:w-6 text-primary" />
            Imported Leads
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">Leads imported via CSV from your dashboard</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleDownloadTemplate}>
            <FileDown className="h-3.5 w-3.5" />Template
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />Import CSV
          </Button>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImportCSV} />
          {hasExport && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleExport} disabled={filtered.length === 0}>
              <Download className="h-3.5 w-3.5" />Export
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Leads', value: stats.total, icon: Users, color: 'text-primary' },
          { label: 'Active', value: stats.active, icon: Clock, color: 'text-amber-600' },
          { label: 'Enroll', value: stats.converted, icon: CheckCircle2, color: 'text-green-600' },
          { label: 'Lost', value: stats.lost, icon: XCircle, color: 'text-red-600' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`h-5 w-5 ${s.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search leads..." className="pl-9 h-9" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-[150px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {LEAD_STATUSES.map(s => <SelectItem key={s} value={s}>{formatLeadStatusTitle(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={v => { setSourceFilter(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-[150px] h-9"><SelectValue placeholder="Source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Users className="h-10 w-10 mb-2" />
              <p className="font-medium">No imported leads found</p>
              <p className="text-xs mt-1">Import leads from your Marketing Dashboard</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Name</TableHead>
                  {!isMobile && <TableHead>Email</TableHead>}
                  {!isMobile && <TableHead>Phone</TableHead>}
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((lead, i) => (
                  <TableRow key={lead.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedLead(lead)}>
                    <TableCell className="text-muted-foreground text-xs">{(page - 1) * PAGE_SIZE + i + 1}</TableCell>
                    <TableCell className="font-medium">{lead.name}</TableCell>
                    {!isMobile && <TableCell className="text-muted-foreground text-sm">{lead.email || '-'}</TableCell>}
                    {!isMobile && <TableCell className="text-muted-foreground text-sm">{lead.phone || '-'}</TableCell>}
                    <TableCell><Badge variant="outline" className="text-xs">{SOURCE_LABELS[lead.source] || lead.source}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className={`text-xs ${statusColors[statusBadgeKey(lead.status)] || ''}`}>{formatLeadStatusTitle(lead.status || 'new')}</Badge></TableCell>
                    <TableCell><Eye className="h-4 w-4 text-muted-foreground" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{filtered.length} leads</p>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="text-xs px-2">{page} / {totalPages}</span>
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* Lead Detail Sheet */}
      <Sheet open={!!selectedLead} onOpenChange={open => !open && setSelectedLead(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selectedLead?.name}</SheetTitle>
          </SheetHeader>
          {selectedLead && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: Mail, label: 'Email', value: selectedLead.email },
                  { icon: Phone, label: 'Phone', value: selectedLead.phone },
                  { icon: Building2, label: 'College', value: selectedLead.college },
                  { icon: GraduationCap, label: 'Year', value: selectedLead.year_of_study },
                  { icon: Target, label: 'Source', value: SOURCE_LABELS[selectedLead.source] || selectedLead.source },
                  { icon: ArrowUpRight, label: 'Status', value: formatLeadStatusTitle(selectedLead.status || 'new') },
                ].map(item => (
                  <div key={item.label} className="space-y-1">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><item.icon className="h-3 w-3" />{item.label}</p>
                    <p className="text-sm font-medium">{item.value || '-'}</p>
                  </div>
                ))}
              </div>
              {selectedLead.notes && (
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><StickyNote className="h-3 w-3" />Notes</p>
                  <p className="text-sm">{selectedLead.notes}</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Created: {format(new Date(selectedLead.created_at), 'dd MMM yyyy, hh:mm a')}</p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
