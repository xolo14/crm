import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Users, Shuffle, AlertCircle, Loader2 } from 'lucide-react';

interface BulkAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamMembers: { id: string; full_name: string; role?: string }[];
  unassignedCount: number;
  onAssign: (count: number, repIds: string[]) => void;
  isAssigning?: boolean;
}

const PRESET_COUNTS = [10, 20, 30, 50, 100];

const getRoleCategoryLabel = (role?: string) => {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized.startsWith('marketing')) return 'Marketing';
  if (normalized === 'sales_representative') return 'Sales Representative';
  if (normalized === 'manager') return 'Manager';
  return normalized ? normalized.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Other';
};

export function BulkAssignDialog({ open, onOpenChange, teamMembers, unassignedCount, onAssign, isAssigning = false }: BulkAssignDialogProps) {
  const [selectedCount, setSelectedCount] = useState<number>(Math.min(10, unassignedCount));
  const [customCount, setCustomCount] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [selectedReps, setSelectedReps] = useState<Set<string>>(new Set());

  const effectiveCount = useCustom ? (parseInt(customCount) || 0) : selectedCount;
  const validCount = Math.min(effectiveCount, unassignedCount);
  const perRep = selectedReps.size > 0 ? Math.floor(validCount / selectedReps.size) : 0;
  const remainder = selectedReps.size > 0 ? validCount % selectedReps.size : 0;
  const groupedMembers = teamMembers.reduce<Record<string, { id: string; full_name: string; role?: string }[]>>((acc, member) => {
    const label = getRoleCategoryLabel(member.role);
    if (!acc[label]) acc[label] = [];
    acc[label].push(member);
    return acc;
  }, {});

  const toggleRep = (id: string) => {
    setSelectedReps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllReps = () => {
    if (selectedReps.size === teamMembers.length) setSelectedReps(new Set());
    else setSelectedReps(new Set(teamMembers.map(m => m.id)));
  };

  const handleAssign = () => {
    if (validCount <= 0 || selectedReps.size === 0 || isAssigning) return;
    onAssign(validCount, Array.from(selectedReps));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isAssigning) onOpenChange(v); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shuffle className="h-5 w-5 text-primary" />
            Bulk Auto-Assign Leads
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Step 1: Select Count */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
              Step 1: How many leads to assign?
            </Label>
            <p className="text-xs text-muted-foreground mb-3">{unassignedCount} leads available</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {PRESET_COUNTS.filter(n => n <= unassignedCount || n === PRESET_COUNTS[0]).map(n => (
                <button
                  key={n}
                  onClick={() => { setSelectedCount(Math.min(n, unassignedCount)); setUseCustom(false); }}
                  disabled={n > unassignedCount || isAssigning}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                    !useCustom && selectedCount === Math.min(n, unassignedCount)
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : n > unassignedCount
                        ? 'bg-muted/30 text-muted-foreground/50 border-border cursor-not-allowed'
                        : 'bg-muted/50 text-foreground border-border hover:bg-muted hover:border-primary/30'
                  }`}
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => setUseCustom(true)}
                disabled={isAssigning}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                  useCustom
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-muted/50 text-foreground border-border hover:bg-muted hover:border-primary/30'
                }`}
              >
                Custom
              </button>
            </div>
            {useCustom && (
              <Input
                type="number"
                min={1}
                max={unassignedCount}
                value={customCount}
                onChange={e => setCustomCount(e.target.value)}
                placeholder={`Enter number (max ${unassignedCount})`}
                className="h-9"
                disabled={isAssigning}
                autoFocus
              />
            )}
          </div>

          {/* Step 2: Select Team Members */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Step 2: Select Team Members
              </Label>
              <button onClick={selectAllReps} disabled={isAssigning} className="text-xs text-primary hover:underline">
                {selectedReps.size === teamMembers.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            {teamMembers.length === 0 ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-200/50">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <p className="text-xs text-amber-700">No active team members available</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {Object.entries(groupedMembers).map(([group, members]) => (
                  <div key={group} className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1">{group}</p>
                    {members.map(m => (
                      <label
                        key={m.id}
                        className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${
                          selectedReps.has(m.id)
                            ? 'bg-primary/5 border-primary/30'
                            : 'bg-muted/30 border-border hover:bg-muted/50'
                        } ${isAssigning ? 'opacity-60 pointer-events-none' : ''}`}
                      >
                        <Checkbox
                          checked={selectedReps.has(m.id)}
                          onCheckedChange={() => toggleRep(m.id)}
                          disabled={isAssigning}
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{m.full_name}</p>
                        </div>
                        {selectedReps.has(m.id) && validCount > 0 && (
                          <Badge variant="secondary" className="text-[10px]">
                            {perRep + (Array.from(selectedReps).indexOf(m.id) < remainder ? 1 : 0)} leads
                          </Badge>
                        )}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Preview */}
          {selectedReps.size > 0 && validCount > 0 && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-primary">Assignment Preview</p>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{validCount}</span> leads will be distributed across{' '}
                <span className="font-medium text-foreground">{selectedReps.size}</span> team member{selectedReps.size > 1 ? 's' : ''}{' '}
                (~{perRep}{remainder > 0 ? `-${perRep + 1}` : ''} each, round-robin)
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isAssigning}>Cancel</Button>
          <Button
            onClick={handleAssign}
            disabled={validCount <= 0 || selectedReps.size === 0 || isAssigning}
            className="gap-1.5"
          >
            {isAssigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
            {isAssigning ? 'Assigning...' : `Assign ${validCount > 0 ? validCount : ''} Leads`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
