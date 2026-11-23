import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateIN, isoDay, weekdayName } from "@/lib/hrFormat";

type HolidayRow = { id: string; name: string; date: string; type?: string | null; is_approved?: number | string | boolean | null };

/** Declared by the admin as a day off (is_approved = 1). Everything else is a calendar "special day". */
function isDayOff(h: HolidayRow): boolean {
  const v = h.is_approved;
  return v === true || v === 1 || v === "1";
}

function HolidayTable({ rows, muted }: { rows: HolidayRow[]; muted?: boolean }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nothing here.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Holiday</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="hidden sm:table-cell">Day</TableHead>
            <TableHead>Type</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((h) => (
            <TableRow key={h.id} className={muted ? "text-muted-foreground" : ""}>
              <TableCell className={muted ? "" : "font-medium"}>{h.name}</TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDateIN(h.date)}
                <span className="block text-xs text-muted-foreground sm:hidden">{weekdayName(h.date)}</span>
              </TableCell>
              <TableCell className="hidden sm:table-cell">{weekdayName(h.date)}</TableCell>
              <TableCell>
                {isDayOff(h) ? (
                  <Badge className="bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600/10">Day off</Badge>
                ) : (
                  <Badge variant="outline">Special day (working)</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function HRHolidays() {
  const year = String(new Date().getFullYear());
  const { data } = useQuery({ queryKey: ["hr", "holidays", year], queryFn: () => api.hr.holidays(year) });
  const holidays: HolidayRow[] = useMemo(() => (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []), [data]);
  // Server sends today in IST; fall back to the browser's local day.
  const today: string = (data && typeof data.today === "string" && data.today) || isoDay();
  const upcoming = useMemo(() => holidays.filter((h) => String(h.date).slice(0, 10) >= today), [holidays, today]);
  const past = useMemo(() => holidays.filter((h) => String(h.date).slice(0, 10) < today).reverse(), [holidays, today]);
  const daysOff: number =
    data && typeof data.upcoming_days_off === "number" ? data.upcoming_days_off : upcoming.filter(isDayOff).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          Holidays
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Day off</span> = declared office holiday.{" "}
          <span className="font-medium text-foreground">Special day</span> = festival or regional day on the calendar; a working day unless the admin declares it off.
        </p>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm">Upcoming</CardTitle>
          <span className="text-xs text-muted-foreground">
            {daysOff} upcoming day{daysOff === 1 ? "" : "s"} off
          </span>
        </CardHeader>
        <CardContent>
          <HolidayTable rows={upcoming} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Earlier this year</CardTitle>
        </CardHeader>
        <CardContent>
          <HolidayTable rows={past} muted />
        </CardContent>
      </Card>
    </div>
  );
}
