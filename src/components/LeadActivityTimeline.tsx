import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Phone, Mail, Video, StickyNote, History, Plus, Loader2, MessageSquare, CalendarDays, UserPlus, ArrowUpRight, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatServerDateTime, parseServerDateTime } from '@/lib/dateTime';

const ACTIVITY_TYPES = [
  { value: 'call', label: 'Call', icon: Phone, color: 'bg-green-500' },
  { value: 'email', label: 'Email', icon: Mail, color: 'bg-blue-500' },
  { value: 'meeting', label: 'Meeting', icon: Video, color: 'bg-purple-500' },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, color: 'bg-emerald-500' },
  { value: 'note', label: 'Note', icon: StickyNote, color: 'bg-amber-500' },
  { value: 'follow_up', label: 'Follow-up', icon: CalendarDays, color: 'bg-indigo-500' },
  { value: 'status_change', label: 'Status Change', icon: ArrowUpRight, color: 'bg-violet-500' },
  { value: 'assignment', label: 'Assignment', icon: UserPlus, color: 'bg-primary' },
];

const typeMap = Object.fromEntries(ACTIVITY_TYPES.map(t => [t.value, t]));

interface Props {
  leadId: string;
  getProfileName?: (userId: string) => string;
}

export function LeadActivityTimeline({ leadId, getProfileName }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState('call');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    if (leadId) fetchActivities();
  }, [leadId]);

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const data = await api.activities.list();
      const all = Array.isArray(data) ? data : data.data || data.activities || [];
      setActivities(
        all
          .filter((a: any) => (a.lead_id ?? null) === leadId)
          .sort((a: any, b: any) => {
            const tb = parseServerDateTime(b.occurred_at || b.created_at)?.getTime() ?? 0;
            const ta = parseServerDateTime(a.occurred_at || a.created_at)?.getTime() ?? 0;
            return tb - ta;
          })
      );
    } catch (err) {
      console.error('Failed to load activities:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newDesc.trim()) { toast({ variant: 'destructive', title: 'Description is required' }); return; }
    setAdding(true);
    try {
      if (!user?.id) throw new Error('Not authenticated');

      // PHP backend stores these in `activities` table with `lead_id`.
      await api.activities.create({
        type: newType,
        subject: typeMap[newType]?.label || 'Activity',
        description: newDesc.trim(),
        lead_id: leadId,
        duration_minutes: null,
      });

      toast({ title: 'Activity logged' });
      setNewDesc('');
      setShowAdd(false);
      fetchActivities();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" />Activity History
        </h4>
        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="h-3 w-3" />{showAdd ? 'Cancel' : 'Log Activity'}
        </Button>
      </div>

      {/* Add Activity Form */}
      {showAdd && (
        <div className="mb-4 p-3 rounded-lg border border-primary/20 bg-primary/5 space-y-3">
          <Select value={newType} onValueChange={setNewType}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIVITY_TYPES.filter(t => !['status_change', 'assignment'].includes(t.value)).map(t => (
                <SelectItem key={t.value} value={t.value} className="text-xs">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            placeholder="Describe the activity... (e.g., Called and discussed pricing, sent brochure via email)"
            rows={2}
            className="text-sm"
          />
          <Button size="sm" className="w-full h-8 text-xs gap-1" onClick={handleAdd} disabled={adding}>
            {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            {adding ? 'Logging...' : 'Log Activity'}
          </Button>
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : activities.length === 0 ? (
        <div className="text-center py-6">
          <History className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No activities logged yet</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Click "Log Activity" to add the first entry</p>
        </div>
      ) : (
        <div className="space-y-0">
          {activities.map((act, i) => {
            const info = typeMap[act.type] || typeMap['note'];
            const Icon = info?.icon || StickyNote;
            const isLast = i === activities.length - 1;
            return (
              <div key={act.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`h-7 w-7 rounded-full ${info?.color || 'bg-muted'} flex items-center justify-center shrink-0`}>
                    <Icon className="h-3.5 w-3.5 text-white" />
                  </div>
                  {!isLast && <div className="w-px flex-1 bg-border min-h-[16px]" />}
                </div>
                <div className={`pb-4 flex-1 min-w-0 ${isLast ? '' : ''}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-[10px] capitalize">{act.type?.replace(/_/g, ' ')}</Badge>
                    {getProfileName && act.user_id && (
                      <span className="text-[10px] text-primary font-medium">{getProfileName(act.user_id)}</span>
                    )}
                  </div>
                  <p className="text-sm mt-1 leading-relaxed">{act.description}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{formatServerDateTime(act.occurred_at || act.created_at)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
