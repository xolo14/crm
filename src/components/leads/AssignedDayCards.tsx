import { useMemo } from 'react';
import { CalendarDays, Clock, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { APP_TIMEZONE, parseServerDateTime } from '@/lib/dateTime';

export interface AssignedLead {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  /** When this lead was assigned to the signed-in user (lead_assignments.created_at). */
  assigned_at?: string | null;
  [key: string]: unknown;
}

interface AssignedDayCardsProps {
  leads: AssignedLead[];
  loading?: boolean;
  statusColors: Record<string, string>;
  onOpenLead: (lead: AssignedLead) => void;
}

interface DayGroup {
  key: string;
  title: string;
  subtitle: string;
  sortMs: number;
  rows: Array<{ lead: AssignedLead; at: Date | null }>;
}

const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: APP_TIMEZONE });
const fullDay = (d: Date) =>
  d.toLocaleDateString('en-IN', { timeZone: APP_TIMEZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeOf = (d: Date) =>
  d.toLocaleTimeString('en-IN', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: true });

/**
 * Sales rep: leads assigned to them, one card per day they were assigned, each lead with the
 * time it was assigned. Leads are listed in the card itself (no source-card dialog).
 */
export function AssignedDayCards({ leads, loading = false, statusColors, onOpenLead }: AssignedDayCardsProps) {
  const days = useMemo(() => {
    const today = dayKey(new Date());
    const yesterday = dayKey(new Date(Date.now() - 86_400_000));
    const groups = new Map<string, DayGroup>();
    for (const lead of leads) {
      if (!lead?.id) continue;
      const at = parseServerDateTime(lead.assigned_at ?? null);
      const key = at ? dayKey(at) : 'unknown';
      let g = groups.get(key);
      if (!g) {
        const title = !at ? 'Earlier' : key === today ? 'Today' : key === yesterday ? 'Yesterday' : fullDay(at);
        g = {
          key,
          title,
          subtitle: !at ? 'Assigned date not recorded' : title === fullDay(at) ? '' : fullDay(at),
          sortMs: at ? at.getTime() : 0,
          rows: [],
        };
        groups.set(key, g);
      }
      g.rows.push({ lead, at });
      if (at && at.getTime() > g.sortMs) g.sortMs = at.getTime();
    }
    for (const g of groups.values()) {
      g.rows.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    }
    return Array.from(groups.values()).sort((a, b) => b.sortMs - a.sortMs);
  }, [leads]);

  return (
    <section className="mb-6" aria-label="Leads assigned to you">
      <div className="mb-2">
        <h2 className="text-sm font-semibold tracking-tight">Assigned to you</h2>
        <p className="text-xs text-muted-foreground">
          One card for each day leads were assigned to you, with the time of each. Tap a lead to open it.
        </p>
      </div>
      {days.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 py-8 text-sm text-muted-foreground">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Loading assigned leads…
            </>
          ) : (
            'No leads assigned to you yet'
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {days.map((g) => (
            <Card key={g.key} className="border-border/50 shadow-none">
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <CalendarDays className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">Assigned · {g.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {g.subtitle ? `${g.subtitle} · ` : ''}
                        {g.rows.length.toLocaleString('en-IN')} lead{g.rows.length === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>
                </div>
                <ul className="max-h-72 overflow-y-auto divide-y divide-border/50">
                  {g.rows.map(({ lead, at }) => {
                    const status = String(lead.status || '');
                    return (
                      <li key={lead.id}>
                        <button
                          type="button"
                          onClick={() => onOpenLead(lead)}
                          className="w-full min-h-11 flex items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-muted/50 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{lead.name || 'Unnamed lead'}</p>
                            <p className="text-xs text-muted-foreground truncate">{lead.phone || lead.email || ''}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="flex items-center justify-end gap-1 text-xs tabular-nums text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {at ? timeOf(at) : '—'}
                            </p>
                            {status ? (
                              <Badge variant="outline" className={`mt-1 text-[10px] capitalize ${statusColors[status] || ''}`}>
                                {status.replace(/_/g, ' ')}
                              </Badge>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
