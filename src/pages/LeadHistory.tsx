import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Trash2, Loader2, CalendarDays, TrendingUp } from 'lucide-react';
import * as perms from '@/lib/permissions';

const IMPORT_SET_PREFIX = 'import_set:';

const toDateKey = (value: string | null | undefined) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const toMonthKey = (value: string | null | undefined) => toDateKey(value).slice(0, 7);

const parseLeadTags = (tags: unknown): string[] => {
  if (Array.isArray(tags)) return tags.filter(Boolean).map(String);
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {}
    return tags.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
};

const getImportSetTag = (tags: unknown): string | null => {
  return parseLeadTags(tags).find(tag => tag.startsWith(IMPORT_SET_PREFIX)) ?? null;
};

export default function LeadHistory() {
  const { role } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyDate, setHistoryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [historyMonth, setHistoryMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedImportSet, setSelectedImportSet] = useState<string>('all');

  const hasDelete = perms.canDelete(role);

  useEffect(() => { fetchLeads(); }, []);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const data = await api.leads.list();
      const allLeads = data.data || [];
      setLeads(allLeads.filter((l: any) => !l.referred_by));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const importedOnDate = useMemo(
    () => leads.filter(l => toDateKey(l.created_at) === historyDate).length,
    [leads, historyDate],
  );

  const importedInMonth = useMemo(
    () => leads.filter(l => toMonthKey(l.created_at) === historyMonth).length,
    [leads, historyMonth],
  );

  const importSets = useMemo(() => {
    const sets: Record<string, { count: number; latest: string }> = {};
    for (const lead of leads) {
      const setTag = getImportSetTag(lead.tags);
      if (!setTag) continue;
      if (!sets[setTag]) sets[setTag] = { count: 0, latest: lead.created_at || '' };
      sets[setTag].count += 1;
      if ((lead.created_at || '') > sets[setTag].latest) sets[setTag].latest = lead.created_at || sets[setTag].latest;
    }
    return Object.entries(sets)
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => new Date(b.latest).getTime() - new Date(a.latest).getTime());
  }, [leads]);

  useEffect(() => {
    if (selectedImportSet !== 'all' && !importSets.some(set => set.id === selectedImportSet)) {
      setSelectedImportSet('all');
    }
  }, [importSets, selectedImportSet]);

  const handleDeleteImportSet = async () => {
    if (selectedImportSet === 'all') return;
    const leadIds = leads
      .filter(lead => parseLeadTags(lead.tags).includes(selectedImportSet))
      .map(lead => lead.id);
    if (leadIds.length === 0) { toast({ title: 'No leads found in selected import set' }); return; }
    if (!confirm(`Delete ${leadIds.length} leads from this imported set? This cannot be undone.`)) return;
    let deletedCount = 0;
    for (const id of leadIds) { try { await api.leads.delete(id); deletedCount++; } catch {} }
    await fetchLeads();
    setSelectedImportSet('all');
    toast({ title: `${deletedCount} imported leads deleted` });
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex flex-col gap-2 mb-5">
        <Button variant="ghost" size="sm" className="self-start gap-1.5" onClick={() => navigate('/leads')}>
          <ArrowLeft className="h-4 w-4" /> Back to Leads
        </Button>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Leads History</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Track imported leads totals and manage import sets</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="border-border/50 shadow-none">
          <CardContent className="pt-5 pb-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                <CalendarDays className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Imported Leads History</h3>
                <p className="text-xs text-muted-foreground">Track totals by date and month</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Date</Label>
                <Input type="date" value={historyDate} onChange={(e) => setHistoryDate(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Month</Label>
                <Input type="month" value={historyMonth} onChange={(e) => setHistoryMonth(e.target.value)} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Imported on selected date</p>
                <p className="text-2xl font-bold leading-none mt-1.5">{importedOnDate}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Imported in selected month</p>
                <p className="text-2xl font-bold leading-none mt-1.5">{importedInMonth}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-none">
          <CardContent className="pt-5 pb-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-md bg-destructive/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Imported Sets</h3>
                <p className="text-xs text-muted-foreground">Delete a full import set if duplicated</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Import Set</Label>
              <Select value={selectedImportSet} onValueChange={setSelectedImportSet}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select imported set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Select imported set</SelectItem>
                  {importSets.map(set => (
                    <SelectItem key={set.id} value={set.id}>
                      {set.id.replace(IMPORT_SET_PREFIX, '')} · {set.count} leads
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedImportSet !== 'all' && (
              <p className="text-xs text-muted-foreground">
                {importSets.find(set => set.id === selectedImportSet)?.count || 0} leads in this set
              </p>
            )}
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              disabled={selectedImportSet === 'all' || !hasDelete}
              onClick={handleDeleteImportSet}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete selected import set
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
