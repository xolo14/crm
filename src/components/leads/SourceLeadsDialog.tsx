import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Shuffle, Trash2, UserPlus, Users, Filter } from 'lucide-react';
import { BulkAssignDialog } from '@/components/BulkAssignDialog';
import { SOURCE_BUCKET_LABELS, type LeadSourceBucket } from '@/lib/leadSources';

const LEAD_STATUSES = ['new', 'contacted', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'] as const;

const formatLeadStatus = (s?: string | null) => {
  if (!s) return '';
  if (s === 'enrolled' || s === 'converted') return 'Enroll';
  return s.replace(/_/g, ' ');
};

const statusBadgeKey = (s?: string | null) => (s === 'converted' ? 'enrolled' : s || '');

type TeamMember = { id: string; full_name: string; role?: string };

type SourceLeadsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceKey: LeadSourceBucket | string | null;
  title?: string;
  initialStatus?: string;
  leads: any[];
  teamMembers: TeamMember[];
  isManager: boolean;
  canBulkAssign: boolean;
  canBulkDelete?: boolean;
  statusColors: Record<string, string>;
  getLeadAssignedNames: (lead: any) => string[];
  onOpenDetail: (lead: any) => void;
  onOpenAssign: (leadId: string) => void;
  onBulkAutoAssign: (count: number, repIds: string[], poolLeadIds: string[]) => void | Promise<void>;
  isAutoAssigning?: boolean;
  onBulkDelete?: (leadIds: string[]) => void | Promise<void>;
};

export function SourceLeadsDialog({
  open,
  onOpenChange,
  sourceKey,
  title,
  initialStatus = 'all',
  leads,
  teamMembers,
  isManager,
  canBulkAssign,
  canBulkDelete = false,
  statusColors,
  getLeadAssignedNames,
  onOpenDetail,
  onOpenAssign,
  onBulkAutoAssign,
  isAutoAssigning = false,
  onBulkDelete,
}: SourceLeadsDialogProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus || 'all');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoAssignOpen, setAutoAssignOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setStatusFilter(initialStatus || 'all');
      setSearch('');
      setUnassignedOnly(false);
      setSelectedIds(new Set());
      setAutoAssignOpen(false);
    }
  }, [open, initialStatus, sourceKey]);

  const label =
    (title && title.trim()) ||
    (sourceKey && SOURCE_BUCKET_LABELS[sourceKey as LeadSourceBucket]) ||
    String(sourceKey || '').replace(/_/g, ' ') ||
    'Source';

  const filtered = useMemo(() => {
    return leads.filter((lead) => {
      const matchSearch =
        !search ||
        lead.name?.toLowerCase().includes(search.toLowerCase()) ||
        lead.email?.toLowerCase().includes(search.toLowerCase()) ||
        lead.phone?.includes(search);
      const matchStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'enrolled' || statusFilter === 'converted'
            ? lead.status === 'enrolled' || lead.status === 'converted'
            : lead.status === statusFilter;
      const matchUnassigned = !unassignedOnly || !lead.assigned_to;
      return matchSearch && matchStatus && matchUnassigned;
    });
  }, [leads, search, statusFilter, unassignedOnly]);

  const allSelected = filtered.length > 0 && filtered.every((l) => selectedIds.has(l.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((l) => l.id)));
  };

  const canSelect = canBulkAssign || canBulkDelete;

  // Pool for auto-assign: selected leads if any, otherwise every unassigned lead in the current view.
  const autoAssignPool = useMemo(() => {
    const base = selectedIds.size > 0 ? filtered.filter((l) => selectedIds.has(l.id)) : filtered;
    return base.filter((l) => !l.assigned_to);
  }, [filtered, selectedIds]);

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || !onBulkDelete) return;
    if (!confirm(`Delete ${ids.length} lead${ids.length === 1 ? '' : 's'} permanently?`)) return;
    await onBulkDelete(ids);
    setSelectedIds(new Set());
  };

  const handleAutoAssign = async (count: number, repIds: string[]) => {
    await onBulkAutoAssign(count, repIds, autoAssignPool.map((l) => l.id));
    setAutoAssignOpen(false);
    setSelectedIds(new Set());
  };

  const bulkAssignButton = canBulkAssign && teamMembers.length > 0 && (
    <Button
      size="sm"
      variant="default"
      className="gap-1.5 h-10 min-h-10 touch-target"
      disabled={autoAssignPool.length === 0}
      onClick={() => setAutoAssignOpen(true)}
    >
      <Shuffle className="h-3.5 w-3.5" />
      Bulk Assign
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[100vw] sm:max-w-4xl lg:max-w-5xl max-h-[min(92dvh,100%)] sm:max-h-[min(90dvh,calc(100dvh-2rem))] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="shrink-0 px-4 pt-5 pb-3 sm:px-6 sm:pt-6 border-b border-border/60">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span className="truncate">{label}</span>
            <Badge variant="secondary" className="font-normal shrink-0">
              {leads.length} lead{leads.length === 1 ? '' : 's'}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="shrink-0 px-4 sm:px-6 py-3 space-y-2 border-b border-border/40">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, email, phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-11"
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-11 flex-1 sm:w-[150px] sm:flex-none">
                  <Filter className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {formatLeadStatus(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant={unassignedOnly ? 'default' : 'outline'}
                className="h-11 shrink-0"
                onClick={() => setUnassignedOnly((v) => !v)}
              >
                Unassigned
              </Button>
              {selectedIds.size === 0 && bulkAssignButton}
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
              {bulkAssignButton}
              {canBulkDelete && onBulkDelete ? (
                <Button
                  size="sm"
                  variant="destructive"
                  className="gap-1.5 h-10 min-h-10 touch-target"
                  onClick={() => void handleBulkDelete()}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              ) : null}
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground ml-auto min-h-11 px-2"
              >
                Clear
              </button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {filtered.length} of {leads.length} in this source
            </p>
            {canSelect && filtered.length > 0 && (
              <button
                type="button"
                className="text-xs text-primary hover:underline min-h-10 px-1"
                onClick={toggleSelectAll}
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-3">
          {/* Mobile cards */}
          <div className="md:hidden space-y-2.5 pb-2">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14">
                <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No leads in this view</p>
              </div>
            ) : (
              filtered.map((lead) => {
                const names = getLeadAssignedNames(lead);
                return (
                  <div
                    key={lead.id}
                    className={`mobile-card p-3.5 ${selectedIds.has(lead.id) ? 'ring-1 ring-primary/40 bg-primary/5' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      {canSelect && (
                        <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(lead.id)}
                            onCheckedChange={() => toggleSelect(lead.id)}
                            className="h-5 w-5"
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => onOpenDetail(lead)}
                      >
                        <p className="font-semibold text-[15px] truncate leading-tight">{lead.name}</p>
                        {lead.phone && (
                          <p className="text-[13px] text-muted-foreground mt-1 truncate">{lead.phone}</p>
                        )}
                        {lead.email && (
                          <p className="text-[12px] text-muted-foreground truncate">{lead.email}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <Badge
                            variant="outline"
                            className={`${statusColors[statusBadgeKey(lead.status)] || ''} capitalize text-[11px]`}
                          >
                            {formatLeadStatus(lead.status)}
                          </Badge>
                          {isManager && (
                            <span className={`text-[11px] font-medium ${names.length ? 'text-primary' : 'text-amber-600'}`}>
                              {names.length ? names.join(', ') : 'Unassigned'}
                            </span>
                          )}
                        </div>
                      </button>
                      {isManager && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-10 shrink-0 gap-1 text-xs touch-target"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenAssign(lead.id);
                          }}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          Assign
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block rounded-md border border-border/50 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {canSelect && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                  )}
                  <TableHead>Lead</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  {isManager && <TableHead>Assigned</TableHead>}
                  <TableHead>Created</TableHead>
                  {isManager && <TableHead className="w-24">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isManager ? 7 : 5} className="text-center py-12">
                      <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No leads in this view</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((lead) => (
                    <TableRow
                      key={lead.id}
                      className={`cursor-pointer ${selectedIds.has(lead.id) ? 'bg-primary/5' : 'hover:bg-muted/50'}`}
                      onClick={() => onOpenDetail(lead)}
                    >
                      {canSelect && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(lead.id)}
                            onCheckedChange={() => toggleSelect(lead.id)}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <p className="font-medium text-sm truncate max-w-[220px]">{lead.name}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[220px]">
                          {lead.college || lead.company || ''}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm truncate max-w-[200px]">{lead.email || '—'}</div>
                        {lead.phone && (
                          <div className="text-xs text-muted-foreground truncate">{lead.phone}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`${statusColors[statusBadgeKey(lead.status)] || ''} capitalize text-xs`}
                        >
                          {formatLeadStatus(lead.status)}
                        </Badge>
                      </TableCell>
                      {isManager && (
                        <TableCell>
                          {(() => {
                            const names = getLeadAssignedNames(lead);
                            return names.length > 0 ? (
                              <span className="text-sm font-medium line-clamp-2">{names.join(', ')}</span>
                            ) : (
                              <span className="text-xs text-amber-600 font-medium">Unassigned</span>
                            );
                          })()}
                        </TableCell>
                      )}
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '—'}
                      </TableCell>
                      {isManager && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 h-9 text-xs"
                            onClick={() => onOpenAssign(lead.id)}
                          >
                            <UserPlus className="h-3 w-3" />
                            {getLeadAssignedNames(lead).length > 0 ? 'Reassign' : 'Assign'}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <BulkAssignDialog
          open={autoAssignOpen}
          onOpenChange={setAutoAssignOpen}
          teamMembers={teamMembers}
          unassignedCount={autoAssignPool.length}
          onAssign={(count, repIds) => void handleAutoAssign(count, repIds)}
          isAssigning={isAutoAssigning}
        />
      </DialogContent>
    </Dialog>
  );
}
