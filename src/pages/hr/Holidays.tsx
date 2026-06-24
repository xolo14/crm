import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function HRHolidays() {
  const year = String(new Date().getFullYear());
  const { data } = useQuery({ queryKey: ["hr", "holidays", year], queryFn: () => api.hr.holidays(year) });
  const holidays = data?.data || data || [];
  const today = new Date();
  const upcoming = useMemo(() => holidays.filter((h: any) => new Date(h.date) >= today), [holidays]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          Holidays
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Company holiday list (read-only)</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Company Holidays</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Holiday Name</TableHead><TableHead>Date</TableHead><TableHead>Day</TableHead><TableHead>Type</TableHead></TableRow></TableHeader>
            <TableBody>
              {holidays.map((holiday: any) => {
                const d = new Date(holiday.date);
                const isUpcoming = d >= today;
                return (
                  <TableRow key={holiday.id} className={isUpcoming ? "bg-primary/5" : ""}>
                    <TableCell>{holiday.name}</TableCell>
                    <TableCell>{d.toLocaleDateString()}</TableCell>
                    <TableCell>{d.toLocaleDateString(undefined, { weekday: "long" })}</TableCell>
                    <TableCell><Badge variant="outline">{holiday.type || "Public"}</Badge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Upcoming holidays: {upcoming.length}</p>
    </div>
  );
}
