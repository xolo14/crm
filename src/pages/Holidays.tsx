import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, CalendarDays, CheckCircle2, XCircle, PartyPopper, Flag, Plus, Calendar, TreePalm, Star } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, isSameMonth, isSameDay, isToday } from 'date-fns';
import { cn } from '@/lib/utils';
import { phpList } from '@/lib/phpList';

interface Holiday {
  id: string;
  name: string;
  date: string;
  type: string;
  is_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const HOLIDAY_REASONS: Record<string, string> = {
  "New Year's Day": "Celebration of the start of the new year",
  "Republic Day": "India's Constitution came into effect on 26 Jan 1950",
  "Maha Shivaratri": "Hindu festival dedicated to Lord Shiva",
  "Holi": "Festival of colours celebrating the arrival of spring",
  "Good Friday": "Commemoration of the crucifixion of Jesus Christ",
  "Eid ul-Fitr": "Islamic festival marking the end of Ramadan",
  "Dr. Ambedkar Jayanti": "Birth anniversary of Dr. B.R. Ambedkar",
  "Ram Navami": "Celebration of the birth of Lord Rama",
  "Mahavir Jayanti": "Birth anniversary of Lord Mahavira, founder of Jainism",
  "Labour Day": "International Workers' Day honouring labourers",
  "Buddha Purnima": "Commemoration of the birth of Gautama Buddha",
  "Eid ul-Adha (Bakrid)": "Islamic festival of sacrifice",
  "Muharram": "Islamic New Year observance",
  "Independence Day": "India's independence from British rule on 15 Aug 1947",
  "Janmashtami": "Celebration of the birth of Lord Krishna",
  "Milad-un-Nabi": "Birth anniversary of Prophet Muhammad",
  "Mahatma Gandhi Jayanti": "Birth anniversary of Mahatma Gandhi, Father of the Nation",
  "Dussehra (Vijayadashami)": "Victory of good over evil — Lord Rama's triumph over Ravana",
  "Diwali": "Festival of lights symbolising the victory of light over darkness",
  "Diwali (Next Day)": "Govardhan Puja celebrations after Diwali",
  "Guru Nanak Jayanti": "Birth anniversary of Guru Nanak Dev, founder of Sikhism",
  "Christmas": "Celebration of the birth of Jesus Christ",
  "Bhogi": "First day of Sankranti — bonfire festival to discard old belongings",
  "Sankranti": "Harvest festival celebrating the sun's transition into Makara",
  "Kanuma": "Third day of Sankranti — honouring cattle and livestock",
  "Ugadi": "Telugu & Kannada New Year",
  "Ganesh Chaturthi": "Birthday celebration of Lord Ganesha",
  "Onam": "Kerala harvest festival honouring King Mahabali",
  "Navratri Starts": "Nine nights of worship dedicated to Goddess Durga",
  "Karva Chauth": "Hindu festival where married women fast for their husbands",
  "Bhai Dooj": "Festival celebrating the bond between brothers and sisters",
  "Chhath Puja": "Ancient Hindu festival dedicated to the Sun God",
  "Ramzan (Optional)": "Holy month of fasting and prayer in Islam",
};

const HOLIDAY_EMOJIS: Record<string, string> = {
  "public": "🏛️",
  "festival": "🎉",
  "custom": "📌",
  "regional": "🌍",
};

const getHolidayReason = (name: string, type: string): string => {
  return HOLIDAY_REASONS[name] || (type === 'festival' ? 'Religious / Cultural festival' : type === 'custom' ? 'Company holiday' : 'National public holiday');
};

export default function Holidays() {
  const { role, user } = useAuth();
  const canManageHolidays = role === 'super_admin' || role === 'admin';
  const isManager = role === 'manager';
  const canAddHoliday = canManageHolidays || isManager;
  const canViewAllHolidays = canManageHolidays || isManager;
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedHoliday, setSelectedHoliday] = useState<Holiday | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDate, setAddDate] = useState('');
  const [addName, setAddName] = useState('');
  const [addType, setAddType] = useState('custom');
  const [addNotes, setAddNotes] = useState('');

  const fetchHolidays = async () => {
    setLoading(true);
    try {
      const res = await api.holidays.list(String(currentMonth.getFullYear()));
      setHolidays(phpList(res));
    } catch {
      toast.error('Failed to load holidays');
    }
    setLoading(false);
  };

  useEffect(() => { fetchHolidays(); }, []);

  const days = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const startPadding = getDay(days[0]);

  const getHolidaysForDay = (day: Date) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    return holidays.filter(h => h.date === dateStr);
  };

  const handleDayClick = (day: Date) => {
    const dayHolidays = getHolidaysForDay(day);
    if (dayHolidays.length > 0) {
      setSelectedHoliday(dayHolidays[0]);
      setNotes(dayHolidays[0].notes || '');
      setDialogOpen(true);
    } else if (canAddHoliday) {
      setAddDate(format(day, 'yyyy-MM-dd'));
      setAddName('');
      setAddType('custom');
      setAddNotes('');
      setAddDialogOpen(true);
    }
  };

  const handleAddHoliday = async () => {
    if (!addName.trim()) {
      toast.error('Please enter a holiday name');
      return;
    }
    setSaving(true);
    try {
      await api.holidays.create({
        name: addName.trim(),
        date: addDate,
        type: addType,
        is_approved: canManageHolidays,
        approved_at: canManageHolidays ? new Date().toISOString() : null,
        notes: addNotes || null,
      });
      toast.success(
        canManageHolidays
          ? 'Holiday added successfully!'
          : 'Holiday submitted for admin approval.',
      );
      setAddDialogOpen(false);
      fetchHolidays();
    } catch {
      toast.error('Failed to add holiday');
    }
    setSaving(false);
  };

  const handleApprove = async (approve: boolean) => {
    if (!selectedHoliday || !user) return;
    setSaving(true);
    try {
      await api.holidays.update(selectedHoliday.id, {
        is_approved: approve,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        notes,
      });
      toast.success(approve ? 'Holiday approved!' : 'Holiday marked as working day');
      setDialogOpen(false);
      fetchHolidays();
    } catch {
      toast.error('Failed to update holiday');
    }
    setSaving(false);
  };

  const yearHolidays = holidays.filter(h => {
    const d = new Date(h.date);
    return d.getFullYear() === currentMonth.getFullYear();
  });
  const approvedCount = yearHolidays.filter(h => h.is_approved).length;
  const totalCount = yearHolidays.length;
  const monthHolidays = holidays.filter(h => {
    const d = new Date(h.date);
    return isSameMonth(d, currentMonth);
  });

  const goToToday = () => setCurrentMonth(new Date());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" />
            {canManageHolidays ? 'Manage Holidays' : isManager ? 'Holidays' : 'Company Holidays'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {canManageHolidays
              ? 'Approve, reject or add holidays for your organization'
              : isManager
                ? 'View the holiday calendar and submit requests for admin approval'
                : 'View approved company holidays and plan ahead'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="gap-1.5 py-1.5 px-3">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            {approvedCount} Approved
          </Badge>
          <Badge variant="outline" className="gap-1.5 py-1.5 px-3">
            <CalendarDays className="h-3.5 w-3.5" />
            {totalCount} Total ({currentMonth.getFullYear()})
          </Badge>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-green-50 to-green-100/50 dark:from-green-950/30 dark:to-green-900/10 border-green-200/50 dark:border-green-800/30">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">{monthHolidays.filter(h => h.is_approved).length}</p>
            <p className="text-xs text-green-600/80 dark:text-green-500/80 font-medium mt-1">This Month</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/10 border-blue-200/50 dark:border-blue-800/30">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{approvedCount}</p>
            <p className="text-xs text-blue-600/80 dark:text-blue-500/80 font-medium mt-1">This Year</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/10 border-purple-200/50 dark:border-purple-800/30">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-purple-700 dark:text-purple-400">{yearHolidays.filter(h => h.type === 'festival').length}</p>
            <p className="text-xs text-purple-600/80 dark:text-purple-500/80 font-medium mt-1">Festivals</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/30 dark:to-orange-900/10 border-orange-200/50 dark:border-orange-800/30">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">{yearHolidays.filter(h => h.type === 'public').length}</p>
            <p className="text-xs text-orange-600/80 dark:text-orange-500/80 font-medium mt-1">National</p>
          </CardContent>
        </Card>
      </div>

      {/* Calendar */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3 bg-gradient-to-r from-primary/5 to-primary/10 border-b">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="h-9 w-9">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg font-semibold">{format(currentMonth, 'MMMM yyyy')}</CardTitle>
              <Button variant="outline" size="sm" onClick={goToToday} className="text-xs h-7 px-2">
                Today
              </Button>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="h-9 w-9">
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:p-4">
          {/* Weekday headers */}
          <div className="grid grid-cols-7">
            {WEEKDAYS.map((d, i) => (
              <div key={d} className={cn(
                "text-center text-xs font-semibold py-3 border-b",
                i === 0 ? "text-red-500" : "text-muted-foreground"
              )}>
                {d}
              </div>
            ))}
          </div>
          {/* Days grid */}
          <div className="grid grid-cols-7">
            {Array.from({ length: startPadding }).map((_, i) => (
              <div key={`pad-${i}`} className="min-h-[72px] sm:min-h-[90px] border-b border-r last:border-r-0 bg-muted/20" />
            ))}
            {days.map((day, idx) => {
              const dayHolidays = getHolidaysForDay(day);
              const hasHoliday = dayHolidays.length > 0;
              const hasApproved = dayHolidays.some(h => h.is_approved);
              const hasPending = dayHolidays.some(h => !h.is_approved);
              const today = isToday(day);
              const isSunday = getDay(day) === 0;
              const isSaturday = getDay(day) === 6;

              return (
                <div
                  key={day.toISOString()}
                  onClick={() => handleDayClick(day)}
                  className={cn(
                    "min-h-[72px] sm:min-h-[90px] p-1 sm:p-1.5 transition-all relative border-b border-r group",
                    (hasHoliday || canAddHoliday) && "cursor-pointer",
                    !hasHoliday && !today && "hover:bg-accent/30",
                    hasApproved && "bg-green-50/80 dark:bg-green-950/20 hover:bg-green-100/80 dark:hover:bg-green-950/30",
                    hasPending && !hasApproved && "bg-amber-50/60 dark:bg-amber-950/15 hover:bg-amber-100/60",
                    today && !hasHoliday && "bg-primary/5",
                  )}
                >
                  <div className={cn(
                    "text-xs sm:text-sm font-medium mb-0.5 w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full",
                    today && "bg-primary text-primary-foreground font-bold",
                    isSunday && !today && "text-red-500",
                    isSaturday && !today && "text-red-400",
                  )}>
                    {format(day, 'd')}
                  </div>
                  {dayHolidays.map(h => (
                    <div
                      key={h.id}
                      className={cn(
                        "text-[9px] sm:text-[11px] rounded-md px-1 py-0.5 mb-0.5 truncate font-medium leading-tight",
                        h.is_approved
                          ? "bg-green-200/80 text-green-900 dark:bg-green-800/50 dark:text-green-200"
                          : "bg-amber-200/80 text-amber-900 dark:bg-amber-800/50 dark:text-amber-200"
                      )}
                      title={h.name}
                    >
                      {HOLIDAY_EMOJIS[h.type] || '📌'} {h.name}
                    </div>
                  ))}
                  {canAddHoliday && !hasHoliday && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-40 transition-opacity">
                      <Plus className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-3 border-t bg-muted/30 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-green-200 dark:bg-green-800/50" />
              <span>Holiday</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-amber-200 dark:bg-amber-800/50" />
              <span>Pending</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-primary" />
              <span>Today</span>
            </div>
            <div className="flex items-center gap-1.5 text-red-500">
              <span>Sun</span>
              <span className="text-muted-foreground">= Weekend</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Month holidays list */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="h-4 w-4 text-primary" />
              {format(currentMonth, 'MMMM yyyy')} Holidays
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {monthHolidays.filter(h => canViewAllHolidays || h.is_approved).length} holiday{monthHolidays.filter(h => canViewAllHolidays || h.is_approved).length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {monthHolidays.filter(h => canViewAllHolidays || h.is_approved).length === 0 ? (
            <div className="text-center py-8">
              <TreePalm className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No holidays this month</p>
              {canAddHoliday && (
                <p className="text-xs text-muted-foreground/60 mt-1">Click on any date in the calendar to add one</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {monthHolidays
                .filter(h => canViewAllHolidays || h.is_approved)
                .sort((a, b) => a.date.localeCompare(b.date))
                .map(h => {
                  const holidayDate = new Date(h.date + 'T00:00:00');
                  const isPast = holidayDate < new Date(new Date().toDateString());
                  return (
                    <div
                      key={h.id}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-xl border transition-all hover:shadow-sm",
                        isPast && "opacity-60",
                        canViewAllHolidays && "cursor-pointer hover:border-primary/30",
                      )}
                      onClick={() => {
                        if (canViewAllHolidays) {
                          setSelectedHoliday(h);
                          setNotes(h.notes || '');
                          setDialogOpen(true);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-11 w-11 rounded-xl flex flex-col items-center justify-center text-xs font-bold shrink-0",
                          h.type === 'festival' ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                            : h.type === 'custom' ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                        )}>
                          <span className="text-[10px] leading-none uppercase">{format(holidayDate, 'MMM')}</span>
                          <span className="text-base leading-none">{format(holidayDate, 'd')}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{h.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{getHolidayReason(h.name, h.type)}</p>
                          <p className="text-[11px] text-muted-foreground/60 mt-0.5">{format(holidayDate, 'EEEE')}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={cn(
                          "text-[10px] capitalize",
                          h.type === 'festival' && "border-purple-200 text-purple-700",
                          h.type === 'public' && "border-blue-200 text-blue-700",
                          h.type === 'custom' && "border-indigo-200 text-indigo-700",
                        )}>
                          {h.type}
                        </Badge>
                        {h.is_approved ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-amber-500 shrink-0" />
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approve/Reject Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedHoliday?.type === 'festival' ? <PartyPopper className="h-5 w-5 text-purple-600" /> : <Flag className="h-5 w-5 text-blue-600" />}
              {selectedHoliday?.name}
            </DialogTitle>
            <DialogDescription>
              {selectedHoliday && format(new Date(selectedHoliday.date + 'T00:00:00'), 'EEEE, dd MMMM yyyy')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">About this holiday</p>
              <p className="text-sm">{selectedHoliday ? getHolidayReason(selectedHoliday.name, selectedHoliday.type) : ''}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Type:</span>
                <Badge variant="outline" className="capitalize">{selectedHoliday?.type}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Status:</span>
                <Badge className={cn(
                  selectedHoliday?.is_approved
                    ? "bg-green-100 text-green-800 hover:bg-green-100"
                    : "bg-amber-100 text-amber-800 hover:bg-amber-100"
                )}>
                  {selectedHoliday?.is_approved ? '✅ Holiday' : '⏳ Pending'}
                </Badge>
              </div>
            </div>

            {canManageHolidays && (
              <>
                <div>
                  <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
                  <Textarea
                    placeholder="Add notes about this holiday..."
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
                <DialogFooter className="flex gap-2 sm:gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 border-red-200 text-red-700 hover:bg-red-50"
                    disabled={saving}
                    onClick={() => handleApprove(false)}
                  >
                    <XCircle className="h-4 w-4 mr-1.5" />
                    Working Day
                  </Button>
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    disabled={saving}
                    onClick={() => handleApprove(true)}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1.5" />
                    Approve Holiday
                  </Button>
                </DialogFooter>
              </>
            )}

            {!canManageHolidays && selectedHoliday?.notes && (
              <div className="bg-muted rounded-lg p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{selectedHoliday.notes}</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Custom Holiday Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Add Custom Holiday
            </DialogTitle>
            <DialogDescription>
              {addDate && format(new Date(addDate + 'T00:00:00'), 'EEEE, dd MMMM yyyy')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Holiday Name *</label>
              <Input
                placeholder="e.g. Company Foundation Day"
                value={addName}
                onChange={e => setAddName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Type</label>
              <Select value={addType} onValueChange={setAddType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom / Company</SelectItem>
                  <SelectItem value="public">Public Holiday</SelectItem>
                  <SelectItem value="festival">Festival</SelectItem>
                  <SelectItem value="regional">Regional</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Notes (optional)</label>
              <Textarea
                placeholder="Reason or description..."
                value={addNotes}
                onChange={e => setAddNotes(e.target.value)}
                rows={2}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleAddHoliday} disabled={saving || !addName.trim()}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add Holiday
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
