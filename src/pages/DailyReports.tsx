import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { callLogsApi } from '@/services/callLogs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import { Plus, FileText, Phone, Users as UsersIcon, Calendar, Loader2, Eye, TrendingUp, XCircle } from 'lucide-react';
import { useDailyReportsList } from '@/hooks/useDailyReportsList';

const EMPTY_FORM = () => ({
  report_date: new Date().toISOString().split('T')[0],
  total_calls: 0,
  total_followups: 0,
  total_demos: 0,
  total_conversions: 0,
  new_leads_contacted: 0,
  total_lost: 0,
  summary: '',
  challenges: '',
});

export default function DailyReports() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const {
    filteredReports,
    loading,
    selectedRep,
    setSelectedRep,
    teamMembers,
    isManager,
    isSalesRep,
    refetch,
  } = useDailyReportsList();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [prefillLoading, setPrefillLoading] = useState(false);
  const [viewReport, setViewReport] = useState<any>(null);

  const [form, setForm] = useState(EMPTY_FORM);

  const applyMetricsToForm = useCallback((m: Record<string, number>) => {
    setForm((p) => ({
      ...p,
      total_calls: m.total_calls ?? 0,
      total_followups: m.total_followups ?? 0,
      total_demos: m.total_demos ?? 0,
      total_conversions: m.total_conversions ?? 0,
      new_leads_contacted: m.new_leads_contacted ?? 0,
      total_lost: m.total_lost ?? 0,
    }));
  }, []);

  const loadCallLogMetrics = useCallback(
    async (reportDate: string) => {
      if (!isSalesRep || !reportDate) return;
      setPrefillLoading(true);
      try {
        const res = await callLogsApi.getDailyReportMetrics(reportDate);
        if (res.metrics) applyMetricsToForm(res.metrics as Record<string, number>);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Could not load call log counts';
        toast({ variant: 'destructive', title: 'Call log metrics', description: msg });
      } finally {
        setPrefillLoading(false);
      }
    },
    [isSalesRep, applyMetricsToForm, toast],
  );

  useEffect(() => {
    if (submitOpen && isSalesRep && form.report_date) {
      void loadCallLogMetrics(form.report_date);
    }
  }, [submitOpen, isSalesRep, form.report_date, loadCallLogMetrics]);

  const handleSubmit = async () => {
    try {
      await api.dailyReports.submit(form);
      toast({ title: 'Daily report submitted!' });
      setSubmitOpen(false);
      setForm(EMPTY_FORM());
      refetch();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    }
  };

  const totalCalls = filteredReports.reduce((s, r) => s + (r.total_calls || 0), 0);
  const totalFollowups = filteredReports.reduce((s, r) => s + (r.total_followups || 0), 0);
  const totalDemos = filteredReports.reduce((s, r) => s + (r.total_demos || 0), 0);
  const totalConversions = filteredReports.reduce((s, r) => s + (r.total_conversions || 0), 0);
  const totalLost = filteredReports.reduce((s, r) => s + (r.total_lost ?? 0), 0);

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );

  const kpiCards = [
    { label: 'Total Calls', value: totalCalls, icon: Phone, ic: 'text-blue-600', bg: 'bg-blue-500/10' },
    { label: 'Follow-ups', value: totalFollowups, icon: Calendar, ic: 'text-amber-600', bg: 'bg-amber-500/10' },
    { label: 'Demos', value: totalDemos, icon: UsersIcon, ic: 'text-purple-600', bg: 'bg-purple-500/10' },
    { label: 'Enroll', value: totalConversions, icon: TrendingUp, ic: 'text-green-600', bg: 'bg-green-500/10' },
    { label: 'Lost', value: totalLost, icon: XCircle, ic: 'text-red-600', bg: 'bg-red-500/10' },
  ];

  const tableColSpan = isManager ? 10 : 9;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Daily Reports</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {isSalesRep ? 'Submit your daily conversation updates' : 'View team daily activity reports'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isManager && teamMembers.length > 0 && (
            <Select value={selectedRep} onValueChange={setSelectedRep}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="Filter by rep" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Reps</SelectItem>
                {teamMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isSalesRep && (
            <Button size="sm" className="gap-1.5" onClick={() => setSubmitOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Submit Report
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-5">
        {kpiCards.map((c) => (
          <Card key={c.label} className="border-border/50 shadow-none">
            <CardContent className="pt-3 pb-2.5 px-3">
              <div className="flex items-center gap-2.5">
                <div className={`h-8 w-8 rounded-lg ${c.bg} flex items-center justify-center`}>
                  <c.icon className={`h-4 w-4 ${c.ic}`} />
                </div>
                <div>
                  <p className="text-lg font-bold leading-none">{c.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{c.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/50 shadow-none">
        <CardHeader className="px-3 sm:px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Report History ({filteredReports.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-4">
          {isMobile ? (
            <div className="space-y-2 px-3">
              {filteredReports.length === 0 ? (
                <p className="text-center py-8 text-sm text-muted-foreground">No reports found</p>
              ) : (
                filteredReports.map((r) => (
                  <div key={r.id} className="border border-border/50 rounded-lg p-3" onClick={() => setViewReport(r)}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        {isManager && <p className="text-sm font-medium">{r.user_name}</p>}
                        <p className="text-xs text-muted-foreground">
                          {new Date(r.report_date).toLocaleDateString('en-IN', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        📞 {r.total_calls} calls
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        🔄 {r.total_followups} f/u
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        🎯 {r.total_demos} demos
                      </Badge>
                      <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600 border-green-200">
                        ✅ {r.total_conversions} enroll
                      </Badge>
                      <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-600 border-red-200">
                        ✕ {r.total_lost ?? 0} lost
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {isManager && <TableHead>Sales Rep</TableHead>}
                  <TableHead>Date</TableHead>
                  <TableHead className="text-center">Calls</TableHead>
                  <TableHead className="text-center">Follow-ups</TableHead>
                  <TableHead className="text-center">Demos</TableHead>
                  <TableHead className="text-center">New Contacted</TableHead>
                  <TableHead className="text-center">Enroll</TableHead>
                  <TableHead className="text-center">Lost</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReports.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={tableColSpan} className="text-center py-8 text-muted-foreground">
                      No reports found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredReports.map((r) => (
                    <TableRow key={r.id}>
                      {isManager && <TableCell className="font-medium">{r.user_name}</TableCell>}
                      <TableCell className="text-sm">
                        {new Date(r.report_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </TableCell>
                      <TableCell className="text-center font-medium">{r.total_calls}</TableCell>
                      <TableCell className="text-center">{r.total_followups}</TableCell>
                      <TableCell className="text-center">{r.total_demos}</TableCell>
                      <TableCell className="text-center">{r.new_leads_contacted}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-200">
                          {r.total_conversions}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-200">
                          {r.total_lost ?? 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{r.summary || '—'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewReport(r)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submit Daily Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {isSalesRep && (
              <p className="text-[11px] text-muted-foreground">
                Numbers below are prefilled from your <strong>call logs</strong> for the selected date (linked lead status for demos, enroll, lost, new contacted). You can edit before submitting.
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Report Date</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={form.report_date}
                  onChange={(e) => setForm((p) => ({ ...p, report_date: e.target.value }))}
                />
                {isSalesRep && prefillLoading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Total Calls</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.total_calls}
                  onChange={(e) => setForm((p) => ({ ...p, total_calls: +e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Follow-ups</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.total_followups}
                  onChange={(e) => setForm((p) => ({ ...p, total_followups: +e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Demos Done</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.total_demos}
                  onChange={(e) => setForm((p) => ({ ...p, total_demos: +e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Enroll</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.total_conversions}
                  onChange={(e) => setForm((p) => ({ ...p, total_conversions: +e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>New Contacted</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.new_leads_contacted}
                  onChange={(e) => setForm((p) => ({ ...p, new_leads_contacted: +e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Lost</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.total_lost}
                  onChange={(e) => setForm((p) => ({ ...p, total_lost: +e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Summary</Label>
              <Textarea
                placeholder="What did you accomplish today?"
                value={form.summary}
                onChange={(e) => setForm((p) => ({ ...p, summary: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Challenges / Notes</Label>
              <Textarea
                placeholder="Any blockers or challenges?"
                value={form.challenges}
                onChange={(e) => setForm((p) => ({ ...p, challenges: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>Submit Report</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!viewReport}
        onOpenChange={(open) => {
          if (!open) setViewReport(null);
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Daily Report —{' '}
              {viewReport &&
                new Date(viewReport.report_date).toLocaleDateString('en-IN', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
            </DialogTitle>
          </DialogHeader>
          {viewReport && (
            <div className="space-y-4 py-2">
              {isManager && (
                <div>
                  <Label className="text-xs text-muted-foreground">Sales Rep</Label>
                  <p className="text-sm font-medium">{viewReport.user_name}</p>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold">{viewReport.total_calls}</p>
                  <p className="text-[10px] text-muted-foreground">Calls</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold">{viewReport.total_followups}</p>
                  <p className="text-[10px] text-muted-foreground">Follow-ups</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold">{viewReport.total_demos}</p>
                  <p className="text-[10px] text-muted-foreground">Demos</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-green-500/10">
                  <p className="text-lg font-bold text-green-600">{viewReport.total_conversions}</p>
                  <p className="text-[10px] text-muted-foreground">Enroll</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold">{viewReport.new_leads_contacted}</p>
                  <p className="text-[10px] text-muted-foreground">New Contacted</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-red-500/10">
                  <p className="text-lg font-bold text-red-600">{viewReport.total_lost ?? 0}</p>
                  <p className="text-[10px] text-muted-foreground">Lost</p>
                </div>
              </div>
              {viewReport.summary && (
                <div>
                  <Label className="text-xs text-muted-foreground">Summary</Label>
                  <p className="text-sm mt-1">{viewReport.summary}</p>
                </div>
              )}
              {viewReport.challenges && (
                <div>
                  <Label className="text-xs text-muted-foreground">Challenges</Label>
                  <p className="text-sm mt-1">{viewReport.challenges}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
