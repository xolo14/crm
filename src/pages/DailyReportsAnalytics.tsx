import { Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AnalyticsTabContent } from '@/components/analytics/AnalyticsTabContent';
import { useDailyReportsList } from '@/hooks/useDailyReportsList';

export default function DailyReportsAnalytics() {
  const { loading, salesReports, byRep, selectedRep, setSelectedRep, teamMembers, isManager } =
    useDailyReportsList();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Sales performance insights from daily reports
          </p>
        </div>
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
      </div>

      <AnalyticsTabContent data={salesReports} byRep={byRep} />
    </div>
  );
}
