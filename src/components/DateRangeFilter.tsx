import { useState } from 'react';
import { format, subDays, startOfMonth, endOfMonth, startOfDay, endOfDay, subMonths } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type DateRange = { from?: Date; to?: Date };
export type DatePreset = 'all' | 'today' | 'last7' | 'last30' | 'this_month' | 'last_month' | 'custom';

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

const presets: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 Days' },
  { value: 'last30', label: 'Last 30 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'custom', label: 'Custom Range' },
];

function getPresetRange(preset: DatePreset): DateRange {
  const now = new Date();
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case 'last7':
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case 'last30':
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    case 'this_month':
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case 'last_month':
      const lastMonth = subMonths(now, 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    case 'all':
    default:
      return {};
  }
}

export function DateRangeFilter({ value, onChange, className }: DateRangeFilterProps) {
  const [preset, setPreset] = useState<DatePreset>('all');
  const [customOpen, setCustomOpen] = useState(false);

  const handlePresetChange = (newPreset: DatePreset) => {
    setPreset(newPreset);
    if (newPreset === 'custom') {
      setCustomOpen(true);
    } else {
      onChange(getPresetRange(newPreset));
    }
  };

  const handleCustomSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (range) {
      onChange({ from: range.from, to: range.to });
    }
  };

  const displayLabel = () => {
    if (preset === 'custom' && value.from) {
      return value.to
        ? `${format(value.from, 'MMM d')} - ${format(value.to, 'MMM d')}`
        : format(value.from, 'MMM d, yyyy');
    }
    return presets.find(p => p.value === preset)?.label || 'All Time';
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Select value={preset} onValueChange={(v: DatePreset) => handlePresetChange(v)}>
        <SelectTrigger className="w-[160px]">
          <CalendarIcon className="h-4 w-4 mr-2 text-muted-foreground" />
          <SelectValue>{displayLabel()}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {presets.map(p => (
            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {preset === 'custom' && (
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <CalendarIcon className="h-4 w-4" />
              {value.from ? (
                value.to ? (
                  `${format(value.from, 'MMM d')} - ${format(value.to, 'MMM d')}`
                ) : (
                  format(value.from, 'MMM d, yyyy')
                )
              ) : (
                'Pick dates'
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={{ from: value.from, to: value.to }}
              onSelect={handleCustomSelect}
              numberOfMonths={2}
              initialFocus
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function filterByDateRange<T extends { created_at: string }>(items: T[], range: DateRange): T[] {
  return items.filter(item => {
    const itemDate = new Date(item.created_at);
    if (range.from && itemDate < range.from) return false;
    if (range.to && itemDate > range.to) return false;
    return true;
  });
}
