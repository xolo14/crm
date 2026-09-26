import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Shuffle, Trash2, UserPlus, Users, Filter, Undo2, ArrowLeft, X, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { BulkAssignDialog } from '@/components/BulkAssignDialog';
import { SOURCE_BUCKET_LABELS, getPeaklyyAttemptCount, isAddedSourceBucket, isPeaklyySourceBucket, type LeadSourceBucket } from '@/lib/leadSources';
import { cn } from '@/lib/utils';
import { leadFormPaymentBadge } from '@/lib/leadFormPayment';

const LEAD_STATUSES = ['new', 'contacted', 'not_answered', 'messaged', 'interested', 'demo_scheduled', 'demo_attended', 'enrolled', 'lost'] as const;
const SOURCE_CARD_PAGE_SIZES = [50, 100, 200] as const;

const formatLeadStatus = (s?: string | null) => {
  if (!s) return 'New';
  if (s === 'enrolled' || s === 'converted') return 'Enroll';
  if (s === 'not_answered') return 'Not answered';
  if (s === 'messaged') return 'Messaged';
  return s.replace(/_/g, ' ');
};

const statusBadgeKey = (s?: string | null) => {
  if (!s) return 'new';
  if (s === 'converted') return 'enrolled';
  return s;
};

const leadStatusSelectValue = (s?: string | null) => {
  const raw = String(s || '').trim();
  if (!raw) return 'new';
  if (raw === 'converted') return 'enrolled';
  return raw;
};

type TeamMember = { id: string; full_name: string; role?: string };

export type BulkAssignUndoSnapshot = { leadId: string; userIds: string[] };

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
  getLeadAssignedIds?: (lead: any) => string[];
  onOpenDetail: (lead: any) => void;
  onOpenAssign: (leadId: string) => void;
  onBulkAutoAssign: (count: number, repIds: string[], poolLeadIds: string[]) => void | Promise<void>;
  isAutoAssigning?: boolean;
  onBulkUndoAssign?: (snapshots: BulkAssignUndoSnapshot[]) => void | Promise<void>;
  onBulkDelete?: (leadIds: string[]) => void | Promise<void>;
  canEditLead?: (lead: any) => boolean;
  onStatusChange?: (lead: any, status: string) => void;
  currentUserId?: string;
  selectedLeadId?: string | null;
  detailPanel?: ReactNode;
  onCloseDetail?: () => void;
  backLabel?: string;
  /** Resolve display name for lead.created_by (Added leads card). */
  getCreatedByName?: (lead: any) => string;
  /** Export for super_admin / admin only. */
  canExport?: boolean;
  /** Export selected rows if any, otherwise the current filtered list. */
  onExport?: (leadsToExport: any[]) => void;
  showPaymentColumn?: boolean;
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
  getLeadAssignedIds,
  onOpenDetail,
  onOpenAssign,
  onBulkAutoAssign,
  isAutoAssigning = false,
  onBulkUndoAssign,
  onBulkDelete,
  canEditLead,
  onStatusChange,
  currentUserId,
  selectedLeadId = null,
  detailPanel,
  onCloseDetail,
  backLabel = 'Back to Leads Management',
  getCreatedByName,
  canExport = false,
  onExport,
  showPaymentColumn = false,
}: SourceLeadsDialogProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus || 'all');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  /** `all` | `self` | assigned member user id */
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoAssignOpen, setAutoAssignOpen] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<BulkAssignUndoSnapshot[] | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof SOURCE_CARD_PAGE_SIZES)[number]>(50);
  const wasOpenRef = useRef(false);
  const lastSourceKeyRef = useRef(sourceKey);
  const listScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      setAutoAssignOpen(false);
      setUndoSnapshot(null);
      return;
    }
    const justOpened = !wasOpenRef.current;
    const sourceChanged = lastSourceKeyRef.current !== sourceKey;
    wasOpenRef.current = true;
    lastSourceKeyRef.current = sourceKey;

    if (justOpened || sourceChanged) {
      setStatusFilter(initialStatus || 'all');
      setSearch('');
      setUnassignedOnly(false);
      setAssigneeFilter('all');
      setSelectedIds(new Set());
      setAutoAssignOpen(false);
      setCurrentPage(1);
      setPageSize(50);
    } else {
      setStatusFilter(initialStatus || 'all');
    }
    if (sourceChanged) {
      setUndoSnapshot(null);
    }
  }, [open, initialStatus, sourceKey]);

  const label =
    (title && title.trim()) ||
    (sourceKey && SOURCE_BUCKET_LABELS[sourceKey as LeadSourceBucket]) ||
    String(sourceKey || '').replace(/_/g, ' ') ||
    'Source';

  const showAttempts = isPeaklyySourceBucket(sourceKey);
  const showCreatedBy = isManager && isAddedSourceBucket(sourceKey);

  const leadAssigneeIds = (lead: any): string[] => {
    if (getLeadAssignedIds) return (getLeadAssignedIds(lead) || []).map(String).filter(Boolean);
    return lead.assigned_to ? [String(lead.assigned_to)] : [];
  };

  const assigneeOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const lead of leads) {
      const ids = leadAssigneeIds(lead);
      const names = getLeadAssignedNames(lead) || [];
      ids.forEach((id, i) => {
        if (!id) return;
        if (currentUserId && id === String(currentUserId)) return;
        const fromTeam = teamMembers.find((m) => String(m.id) === id)?.full_name;
        const raw = String(fromTeam || names[i] || '').trim();
        const name = !raw || /^assigned to self$/i.test(raw) ? 'Assigned' : raw;
        if (!byId.has(id)) byId.set(id, name);
      });
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [leads, teamMembers, currentUserId, getLeadAssignedIds, getLeadAssignedNames]);

  const resolveCreatedBy = (lead: any) => {
    if (getCreatedByName) {
      const n = String(getCreatedByName(lead) || '').trim();
      if (n) return n;
    }
    const fromApi = String(lead?.created_by_name || '').trim();
    if (fromApi) return fromApi;
    return lead?.created_by ? 'Unknown' : '—';
  };

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
      const assigneeIds = leadAssigneeIds(lead);
      const matchAssignee =
        assigneeFilter === 'all'
          ? true
          : assigneeFilter === 'self'
            ? !!currentUserId && assigneeIds.includes(String(currentUserId))
            : assigneeIds.includes(String(assigneeFilter));
      return matchSearch && matchStatus && matchUnassigned && matchAssignee;
    });
  }, [leads, search, statusFilter, unassignedOnly, assigneeFilter, currentUserId, getLeadAssignedIds]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, unassignedOnly, assigneeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const paginatedLeads = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  const setPageSizeFromSelect = (value: string) => {
    const next = Number(value);
    if (next === 50 || next === 100 || next === 200) {
      setPageSize(next);
      setCurrentPage(1);
      listScrollRef.current?.scrollTo({ top: 0 });
    }
  };

  const goToPage = (page: number) => {
    const next = Math.min(Math.max(1, page), totalPages);
    setCurrentPage(next);
    listScrollRef.current?.scrollTo({ top: 0 });
  };

  const pageButtons = (() => {
    const maxButtons = 5;
    const pages: number[] = [];
    if (totalPages <= maxButtons) {
      for (let i = 1; i <= totalPages; i += 1) pages.push(i);
    } else if (safePage <= 3) {
      for (let i = 1; i <= maxButtons; i += 1) pages.push(i);
    } else if (safePage >= totalPages - 2) {
      for (let i = totalPages - maxButtons + 1; i <= totalPages; i += 1) pages.push(i);
    } else {
      for (let i = safePage - 2; i <= safePage + 2; i += 1) pages.push(i);
    }
    return pages;
  })();

  const canSelect = canBulkAssign || canBulkDelete;
  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < filtered.length;

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

  const autoAssignPool = useMemo(() => {
    if (selectedIds.size > 0) return filtered.filter((l) => selectedIds.has(l.id));
    return filtered;
  }, [filtered, selectedIds]);

  const handleExportClick = () => {
    if (!onExport) return;
    const rows =
      selectedIds.size > 0 ? filtered.filter((l) => selectedIds.has(l.id)) : filtered;
    onExport(rows);
  };

  const handleAutoAssign = async (count: number, repIds: string[]) => {
    await onBulkAutoAssign(count, repIds, autoAssignPool.map((l) => l.id));
    if (onBulkUndoAssign) {
      const snaps: BulkAssignUndoSnapshot[] = autoAssignPool.slice(0, count).map((lead) => ({
        leadId: lead.id,
        userIds: getLeadAssignedIds
          ? getLeadAssignedIds(lead)
          : lead.assigned_to
            ? [String(lead.assigned_to)]
            : [],
      }));
      setUndoSnapshot(snaps);
    }
    setSelectedIds(new Set());
  };

  const handleUndoBulkAssign = async () => {
    if (!undoSnapshot?.length || !onBulkUndoAssign) return;
    setUndoing(true);
    try {
      await onBulkUndoAssign(undoSnapshot);
      setUndoSnapshot(null);
    } finally {
      setUndoing(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!onBulkDelete || selectedIds.size === 0) return;
    await onBulkDelete(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const canUndo = !!undoSnapshot?.length;
  const showDetail = !!detailPanel;
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const undoButton = canBulkAssign && onBulkUndoAssign ? (
    <Button
      size="sm"
      variant="outline"
      className="gap-1.5 h-10 min-h-10 touch-target"
      disabled={!canUndo || undoing || isAutoAssigning}
      title={canUndo ? 'Undo last bulk assign in this card' : 'Undo appears after you bulk assign'}
      onClick={() => void handleUndoBulkAssign()}
    >
      {undoing ? <span className="text-xs">Undoing…</span> : (<><Undo2 className="h-3.5 w-3.5" />Undo</>)}
    </Button>
  ) : null;

  const bulkAssignButton = canBulkAssign && teamMembers.length > 0 && (
    <Button
      size="sm"
      variant="default"
      className="gap-1.5 h-10 min-h-10 touch-target"
      disabled={autoAssignPool.length === 0 || isAutoAssigning || undoing}
      onClick={() => setAutoAssignOpen(true)}
    >
      <Shuffle className="h-3.5 w-3.5" />
      Bulk Assign
    </Button>
  );

  if (!open) return null;

  const shell = (
    <>
      <div
        ref={setPortalEl}
        className="fixed inset-0 z-[100] flex flex-col bg-background"
        role="dialog"
        aria-modal="false"
        aria-label={label}
      >
        {/* Top bar — full viewport, covers app sidebar */}
        <header className="shrink-0 flex flex-wrap items-center gap-2 px-3 sm:px-5 py-3 border-b border-border bg-card">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 h-9 shrink-0"
            onClick={() => {
              onCloseDetail?.();
              onOpenChange(false);
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{backLabel}</span>
            <span className="sm:hidden">Back</span>
          </Button>
          <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2">
            <h2 className="text-base sm:text-lg font-semibold truncate">{label}</h2>
            <Badge variant="secondary" className="font-normal shrink-0">
              {leads.length} lead{leads.length === 1 ? '' : 's'}
            </Badge>
          </div>
          {canExport && onExport ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 h-9 shrink-0"
              disabled={filtered.length === 0 && selectedIds.size === 0}
              onClick={handleExportClick}
              title={selectedIds.size > 0 ? `Export ${selectedIds.size} selected` : 'Export leads in this view'}
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">
                {selectedIds.size > 0 ? `Export (${selectedIds.size})` : 'Export'}
              </span>
            </Button>
          ) : null}
        </header>

        {/* Split panes: each column scrolls on its own */}
        <div className={cn('flex min-h-0 flex-1 flex-col', showDetail && 'lg:flex-row')}>
          <section
            className={cn(
              'flex min-h-0 min-w-0 flex-col bg-background',
              showDetail
                ? 'max-lg:min-h-0 max-lg:flex-[0_0_42%] lg:w-[58%] lg:max-w-[58%] lg:border-r border-border'
                : 'w-full flex-1',
            )}
          >
            <div className="shrink-0 px-4 sm:px-5 py-3 space-y-2 border-b border-border/50 bg-muted/10">
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
                <div className="flex gap-2 w-full sm:w-auto flex-wrap">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-11 flex-1 sm:w-[150px] sm:flex-none">
                      <Filter className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent container={portalEl} className="z-[110]">
                      <SelectItem value="all">All Statuses</SelectItem>
                      {LEAD_STATUSES.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">{formatLeadStatus(s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant={unassignedOnly ? 'default' : 'outline'}
                    className="h-11 shrink-0"
                    onClick={() => {
                      setUnassignedOnly((v) => !v);
                      setAssigneeFilter('all');
                    }}
                  >
                    Unassigned
                  </Button>
                  {isManager && currentUserId ? (
                    <Select
                      value={assigneeFilter}
                      onValueChange={(v) => {
                        setAssigneeFilter(v);
                        if (v !== 'all') setUnassignedOnly(false);
                      }}
                    >
                      <SelectTrigger className="h-11 flex-1 sm:w-[180px] sm:flex-none">
                        <SelectValue placeholder="Assigned to" />
                      </SelectTrigger>
                      <SelectContent container={portalEl} className="z-[110]">
                        <SelectItem value="all">All assignees</SelectItem>
                        <SelectItem value="self">Self</SelectItem>
                        {assigneeOptions.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  {selectedIds.size === 0 && (
                    <>
                      {bulkAssignButton}
                      {undoButton}
                    </>
                  )}
                </div>
              </div>

              {selectedIds.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
                  <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
                  {bulkAssignButton}
                  {undoButton}
                  {canExport && onExport ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 h-10 min-h-10 touch-target"
                      onClick={handleExportClick}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Export
                    </Button>
                  ) : null}
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
                  {filtered.length > pageSize ? ` · page ${safePage} of ${totalPages}` : ''}
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

            <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 py-3">
              <div className="md:hidden space-y-2.5 pb-2">
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14">
                    <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">No leads in this view</p>
                  </div>
                ) : (
                  paginatedLeads.map((lead) => {
                    const names = getLeadAssignedNames(lead);
                    const assignedLabel =
                      names.length > 0 ? names.join(', ') : lead.assigned_to ? 'Assigned' : 'Unassigned';
                    const isAssigned = names.length > 0 || !!lead.assigned_to;
                    const isActive = selectedLeadId && String(selectedLeadId) === String(lead.id);
                    return (
                      <div
                        key={lead.id}
                        className={cn(
                          'mobile-card p-3.5',
                          selectedIds.has(lead.id) && 'ring-1 ring-primary/40 bg-primary/5',
                          isActive && 'ring-2 ring-primary/50 bg-primary/5',
                        )}
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
                              {canEditLead?.(lead) && onStatusChange ? (
                                <div onClick={(e) => e.stopPropagation()}>
                                  <Select
                                    value={leadStatusSelectValue(lead.status)}
                                    onValueChange={(v: string) => {
                                      if (v) onStatusChange(lead, v);
                                    }}
                                  >
                                    <SelectTrigger className="h-7 w-auto border-0 p-0">
                                      <Badge
                                        variant="outline"
                                        className={`${statusColors[statusBadgeKey(lead.status)] || ''} capitalize text-[11px]`}
                                      >
                                        {formatLeadStatus(lead.status)}
                                      </Badge>
                                    </SelectTrigger>
                                    <SelectContent container={portalEl} className="z-[110]">
                                      {LEAD_STATUSES.map((s) => (
                                        <SelectItem key={s} value={s} className="capitalize">
                                          {formatLeadStatus(s)}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className={`${statusColors[statusBadgeKey(lead.status)] || ''} capitalize text-[11px]`}
                                >
                                  {formatLeadStatus(lead.status)}
                                </Badge>
                              )}
                              {showPaymentColumn && (() => {
                                const pay = leadFormPaymentBadge(lead);
                                if (!pay) return null;
                                return (
                                  <Badge
                                    variant="outline"
                                    className={`text-[11px] ${pay.paid ? 'border-emerald-500/40 text-emerald-700 bg-emerald-500/10' : 'border-amber-500/40 text-amber-700 bg-amber-500/10'}`}
                                  >
                                    {pay.label}
                                  </Badge>
                                );
                              })()}
                              {isManager && (
                                <span className={`text-[11px] font-medium ${isAssigned ? 'text-primary' : 'text-amber-600'}`}>
                                  {assignedLabel}
                                </span>
                              )}
                              {showCreatedBy && (
                                <span className="text-[11px] text-muted-foreground">
                                  Added by {resolveCreatedBy(lead)}
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
                              {isAssigned ? 'Reassign' : 'Assign'}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

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
                      {showAttempts && <TableHead>Attempts</TableHead>}
                      {showPaymentColumn && <TableHead>Payment</TableHead>}
                      {isManager && <TableHead>Assigned</TableHead>}
                      {showCreatedBy && <TableHead>Created by</TableHead>}
                      <TableHead>Created</TableHead>
                      {isManager && <TableHead className="w-24">Action</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={
                            (canSelect ? 1 : 0) +
                            (isManager ? 7 : 5) +
                            (showAttempts ? 1 : 0) +
                            (showCreatedBy ? 1 : 0) +
                            (showPaymentColumn ? 1 : 0)
                          }
                          className="text-center py-12"
                        >
                          <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                          <p className="text-sm text-muted-foreground">No leads in this view</p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedLeads.map((lead) => {
                        const isActive = selectedLeadId && String(selectedLeadId) === String(lead.id);
                        return (
                          <TableRow
                            key={lead.id}
                            className={cn(
                              'cursor-pointer',
                              selectedIds.has(lead.id) ? 'bg-primary/5' : 'hover:bg-muted/50',
                              isActive && 'bg-primary/10 ring-1 ring-inset ring-primary/30',
                            )}
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
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {canEditLead?.(lead) && onStatusChange ? (
                                <Select
                                  value={leadStatusSelectValue(lead.status)}
                                  onValueChange={(v: string) => {
                                    if (v) onStatusChange(lead, v);
                                  }}
                                >
                                  <SelectTrigger className="h-7 w-auto border-0 p-0">
                                    <Badge
                                      variant="outline"
                                      className={`${statusColors[statusBadgeKey(lead.status)] || ''} capitalize text-xs`}
                                    >
                                      {formatLeadStatus(lead.status)}
                                    </Badge>
                                  </SelectTrigger>
                                  <SelectContent container={portalEl} className="z-[110]">
                                    {LEAD_STATUSES.map((s) => (
                                      <SelectItem key={s} value={s} className="capitalize">
                                        {formatLeadStatus(s)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className={`${statusColors[statusBadgeKey(lead.status)] || ''} capitalize text-xs`}
                                >
                                  {formatLeadStatus(lead.status)}
                                </Badge>
                              )}
                            </TableCell>
                            {showAttempts && (
                              <TableCell className="text-sm tabular-nums">{getPeaklyyAttemptCount(lead)}</TableCell>
                            )}
                            {showPaymentColumn && (
                              <TableCell>
                                {(() => {
                                  const pay = leadFormPaymentBadge(lead);
                                  if (!pay) return <span className="text-sm text-muted-foreground">—</span>;
                                  return (
                                    <Badge
                                      variant="outline"
                                      className={pay.paid ? 'border-emerald-500/40 text-emerald-700 bg-emerald-500/10' : 'border-amber-500/40 text-amber-700 bg-amber-500/10'}
                                    >
                                      {pay.label}
                                    </Badge>
                                  );
                                })()}
                              </TableCell>
                            )}
                            {isManager && (
                              <TableCell>
                                {(() => {
                                  const names = getLeadAssignedNames(lead);
                                  const assignedLabel =
                                    names.length > 0 ? names.join(', ') : lead.assigned_to ? 'Assigned' : 'Unassigned';
                                  const assigned = names.length > 0 || !!lead.assigned_to;
                                  return (
                                    <span className={`text-sm font-medium line-clamp-2 ${assigned ? '' : 'text-xs text-amber-600'}`}>
                                      {assignedLabel}
                                    </span>
                                  );
                                })()}
                              </TableCell>
                            )}
                            {showCreatedBy && (
                              <TableCell className="text-sm whitespace-nowrap max-w-[160px] truncate" title={resolveCreatedBy(lead)}>
                                {resolveCreatedBy(lead)}
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
                                  {getLeadAssignedNames(lead).length > 0 || lead.assigned_to ? 'Reassign' : 'Assign'}
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
            {(filtered.length > 50 || pageSize !== 50) && (
              <div className="shrink-0 flex flex-col sm:flex-row items-center justify-between gap-2 px-4 sm:px-5 py-2.5 border-t border-border bg-card">
                <p className="text-xs text-muted-foreground">
                  Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length}
                </p>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground mr-1 tabular-nums whitespace-nowrap">
                    Page {safePage} of {totalPages}
                  </span>
                  <Select value={String(pageSize)} onValueChange={setPageSizeFromSelect}>
                    <SelectTrigger
                      className="h-8 w-9 shrink-0 p-0 justify-center gap-0 text-xs font-medium [&>svg]:hidden"
                      aria-label="Leads per page"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent container={portalEl} className="z-[110] min-w-[4.5rem]">
                      {SOURCE_CARD_PAGE_SIZES.map((n) => (
                        <SelectItem key={n} value={String(n)} className="text-xs justify-center">
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 max-md:h-11 max-md:w-11"
                    disabled={safePage === 1}
                    onClick={() => goToPage(safePage - 1)}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  {pageButtons.map((page) => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => goToPage(page)}
                      className={`h-8 w-8 rounded-md text-xs font-medium transition-colors ${
                        safePage === page ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 max-md:h-11 max-md:w-11"
                    disabled={safePage === totalPages}
                    onClick={() => goToPage(safePage + 1)}
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </section>

          {showDetail ? (
            <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/15 max-lg:min-h-0 max-lg:flex-1 lg:w-[42%] lg:max-w-[42%]">
              <div className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-border bg-card/80">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Lead details</p>
                {onCloseDetail ? (
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onCloseDetail}>
                    <X className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4">
                <div className="mx-auto w-full max-w-xl">{detailPanel}</div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      <BulkAssignDialog
        open={autoAssignOpen}
        onOpenChange={setAutoAssignOpen}
        teamMembers={teamMembers}
        unassignedCount={autoAssignPool.length}
        onAssign={(count, repIds) => void handleAutoAssign(count, repIds)}
        isAssigning={isAutoAssigning || undoing}
      />
    </>
  );

  return createPortal(shell, document.body);
}
