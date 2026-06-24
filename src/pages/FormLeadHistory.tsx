import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Loader2, CalendarDays } from 'lucide-react';

const toDateKey = (value: string | null | undefined) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const toMonthKey = (value: string | null | undefined) => toDateKey(value).slice(0, 7);

export default function FormLeadHistory() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyDate, setHistoryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [historyMonth, setHistoryMonth] = useState(() => new Date().toISOString().slice(0, 7));

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api.leads.list();
        const allLeads = Array.isArray(data) ? data : data.data || data.leads || [];
        setLeads(allLeads.filter((l: any) => l.referred_by));
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    })();
  }, []);

  const collectedOnDate = useMemo(
    () => leads.filter(l => toDateKey(l.created_at) === historyDate).length,
    [leads, historyDate],
  );

  const collectedInMonth = useMemo(
    () => leads.filter(l => toMonthKey(l.created_at) === historyMonth).length,
    [leads, historyMonth],
  );

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div>
      <div className="flex flex-col gap-2 mb-5">
        <Button variant="ghost" size="sm" className="self-start gap-1.5" onClick={() => navigate('/leads/form-leads')}>
          <ArrowLeft className="h-4 w-4" /> Back to Form Leads
        </Button>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Form Leads History</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Track collected leads totals by date and month</p>
        </div>
      </div>

      <Card className="border-border/50 shadow-none max-w-xl">
        <CardContent className="pt-5 pb-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
              <CalendarDays className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Collected Leads History</h3>
              <p className="text-xs text-muted-foreground">Track collection totals by date and month</p>
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
              <p className="text-xs text-muted-foreground">Collected on selected date</p>
              <p className="text-2xl font-bold leading-none mt-1.5">{collectedOnDate}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Collected in selected month</p>
              <p className="text-2xl font-bold leading-none mt-1.5">{collectedInMonth}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
