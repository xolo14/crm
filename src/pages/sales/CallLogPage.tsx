import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Ban,
  Clock,
  Hourglass,
  Paperclip,
  Pencil,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Scissors,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCallLogStats, useCallLogs, useDeleteCallLog } from "@/hooks/useCallLogs";
import LogCallDialog, { LEAD_PIPELINE_OPTIONS } from "@/components/sales/LogCallDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCallDuration } from "@/lib/callDuration";
import { ProtectedUploadPreviewDialog } from "@/components/ProtectedUploadPreviewDialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import {
  CALL_LOG_PERIODS,
  type CallLog,
  type CallLogPeriod,
  type CallLogStats,
  type CallLogsQueryParams,
} from "@/types/callLog";

function normalizeRole(role?: string | null) {
  const r = String(role || "").toLowerCase();
  if (r === "superadmin") return "super_admin";
  if (r === "organisation") return "org";
  return r;
}

function StatCard({
  value,
  label,
  icon: Icon,
  labelClass = "text-muted-foreground",
  className,
}: {
  value: string | number;
  label: string;
  icon: LucideIcon;
  labelClass?: string;
  className?: string;
}) {
  return (
    <div className={cn("bg-muted/40 rounded-lg p-4 min-w-[152px] shrink-0 snap-start", className)}>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className={cn("flex items-center gap-1 text-sm mt-1", labelClass)}>
        <Icon className="h-4 w-4 shrink-0" />
        <span className="leading-tight">{label}</span>
      </div>
    </div>
  );
}

function StatsGrid({ stats, periodTitle }: { stats: CallLogStats; periodTitle: string }) {
  return (
    <div className="space-y-3 mb-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-lg font-bold">{periodTitle}</span>
        <span className="text-sm text-muted-foreground">{stats.period_label}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory scrollbar-thin">
        <StatCard value={stats.total_calls} label="Total Calls" icon={Phone} />
        <StatCard value={stats.call_duration} label="Call Duration" icon={Clock} />
        <StatCard value={stats.incoming} label="Incoming" icon={PhoneIncoming} labelClass="text-green-500" />
        <StatCard value={stats.incoming_duration} label="Incoming Duration" icon={PhoneIncoming} labelClass="text-green-500" />
        <StatCard value={stats.outgoing} label="Outgoing" icon={PhoneOutgoing} labelClass="text-orange-400" />
        <StatCard value={stats.outgoing_duration} label="Outgoing Duration" icon={PhoneOutgoing} labelClass="text-orange-400" />
        <StatCard value={stats.missed} label="Missed" icon={PhoneMissed} labelClass="text-red-500" />
        <StatCard value={stats.rejected} label="Rejected" icon={Ban} labelClass="text-red-500" />
        <StatCard value={stats.never_attended} label="Never Attended" icon={Scissors} labelClass="text-red-500" />
        <StatCard value={stats.working_hours} label="Talk Time" icon={Hourglass} />
      </div>
    </div>
  );
}

function typeBadgeClass(t: string) {
  switch (t) {
    case "incoming":
      return "bg-green-500/15 text-green-700 border-green-200";
    case "outgoing":
      return "bg-blue-500/15 text-blue-700 border-blue-200";
    case "missed":
      return "bg-red-500/15 text-red-700 border-red-200";
    case "rejected":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function statusBadgeClass(s: string) {
  switch (s) {
    case "connected":
      return "bg-teal-500/10 text-teal-700 border-teal-200";
    case "never_attended":
      return "bg-red-500/10 text-red-700 border-red-200";
    default:
      return "bg-orange-500/10 text-orange-700 border-orange-200";
  }
}

const emptyStats: CallLogStats = {
  total_calls: 0,
  call_duration: "-",
  incoming: 0,
  incoming_duration: "-",
  outgoing: 0,
  outgoing_duration: "-",
  missed: 0,
  rejected: 0,
  never_attended: 0,
  not_pickup_by_client: 0,
  unique_clients: 0,
  working_hours: "-",
  connected_calls: 0,
  period_label: "—",
};

function formatCallDateDisplay(dateStr: string) {
  const parts = dateStr.split("-").map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return dateStr;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function attachmentBasename(path: string) {
  const n = path.replace(/\\/g, "/").split("/").pop();
  return n || path;
}

/** Linked lead’s CRM pipeline status (`leads.status`); em dash when no lead. */
function callLogLeadStatusCell(log: { lead_id?: string | null; lead_status?: string | null }): string {
  const lid = (log.lead_id || "").trim();
  if (!lid) return "—";
  const raw = (log.lead_status || "").trim();
  if (!raw) return "—";
  const opt = LEAD_PIPELINE_OPTIONS.find((o) => o.value === raw);
  return opt?.label ?? raw.replace(/_/g, " ");
}

function DailyLogsStrip({
  query,
  showRepColumn,
  canMutate,
  onCreate,
  onEdit,
}: {
  query: CallLogsQueryParams;
  showRepColumn: boolean;
  canMutate: (log: CallLog) => boolean;
  onCreate: () => void;
  onEdit: (log: CallLog) => void;
}) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const { toast } = useToast();
  const delMut = useDeleteCallLog();

  useEffect(() => {
    setPage(1);
  }, [query.period, query.date_from, query.date_to, query.sales_rep_id]);

  const { data, isLoading } = useCallLogs({ ...query, page, limit });
  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / limit));

  const onDelete = async (log: CallLog) => {
    if (!confirm("Delete this call log?")) return;
    try {
      await delMut.mutateAsync(log.id);
      toast({ title: "Deleted" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e?.message });
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{total} calls</span>
          <Select
            value={String(limit)}
            onValueChange={(v) => {
              setLimit(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger className="h-10 w-full max-w-[160px] text-xs md:h-8 md:w-[130px]">
              <SelectValue placeholder="Per page" />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center border rounded-lg border-dashed">
          <PhoneOff className="h-10 w-10 text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">No calls logged for this period</p>
          <Button size="sm" className="mt-4 bg-teal-500 hover:bg-teal-600 text-white" onClick={onCreate}>
            + Log Your First Call
          </Button>
        </div>
      ) : (
        <Card className="border-border/50 shadow-none">
          <div className="crm-table-scroll overflow-x-auto max-h-[65dvh]">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky top-0 z-10 bg-card w-[56px]">#</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-card min-w-[128px]">Date</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-card w-[92px]">Time</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-card w-[96px]">Type</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-card w-[136px]">Status</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-card min-w-[140px]">Client</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-card min-w-[120px]">Phone</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-card w-[92px]">Duration</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-card min-w-[160px]">Lead Status</TableHead>
                  {showRepColumn ? <TableHead className="sticky top-0 z-10 bg-card min-w-[130px]">Rep</TableHead> : null}
                  <TableHead className="sticky top-0 z-10 bg-card min-w-[140px]">Recording</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-card min-w-[200px]">Notes</TableHead>
                  <TableHead className="sticky top-0 z-10 bg-card min-w-[150px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log, i) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs">#{((page - 1) * limit + i + 1).toString()}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatCallDateDisplay(log.call_date)}</TableCell>
                    <TableCell className="font-mono text-xs">{log.call_time?.slice(0, 8) || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("capitalize text-[10px] px-1.5 py-0", typeBadgeClass(log.call_type))}>
                        {log.call_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px] capitalize px-1.5 py-0", statusBadgeClass(log.call_status))}>
                        {log.call_status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium max-w-[160px] truncate">{log.client_name || "—"}</TableCell>
                    <TableCell className="max-w-[140px] truncate">{log.client_phone || "—"}</TableCell>
                    <TableCell className="font-mono">{formatCallDuration(log.duration_seconds)}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-muted-foreground">{callLogLeadStatusCell(log)}</TableCell>
                    {showRepColumn ? <TableCell>{log.sales_rep_name || "—"}</TableCell> : null}
                    <TableCell>
                      {log.attachment_path ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-teal-600 hover:underline text-xs bg-transparent border-0 p-0 cursor-pointer"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setPreviewPath(String(log.attachment_path));
                          }}
                        >
                          <Paperclip className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[140px]">{attachmentBasename(log.attachment_path)}</span>
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <p className="text-muted-foreground whitespace-pre-wrap break-words line-clamp-2">{log.notes || "—"}</p>
                    </TableCell>
                    <TableCell>
                      {canMutate(log) ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          <Button variant="outline" size="sm" className="h-9 gap-1 max-md:min-h-11" onClick={() => onEdit(log)}>
                            <Pencil className="h-3 w-3" /> Edit
                          </Button>
                          <Button variant="outline" size="sm" className="h-9 gap-1 text-destructive max-md:min-h-11" onClick={() => onDelete(log)}>
                            <Trash2 className="h-3 w-3" /> Delete
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">View only</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {total > limit && (
        <div className="flex items-center justify-end gap-2 mt-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} / {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}

      <ProtectedUploadPreviewDialog
        path={previewPath}
        open={Boolean(previewPath)}
        onOpenChange={(open) => {
          if (!open) setPreviewPath(null);
        }}
        title="Call recording"
      />
    </div>
  );
}

export default function CallLogPage() {
  const { user } = useAuth();
  const role = normalizeRole(user?.role);
  const canFilterUsers = ["admin", "super_admin", "org", "manager"].includes(role);
  const showRepColumn = canFilterUsers;

  const canMutate = useMemo(() => {
    return (log: CallLog) => {
      if (canFilterUsers) return true;
      return log.sales_rep_id === user?.id;
    };
  }, [canFilterUsers, user?.id]);

  const [period, setPeriod] = useState<CallLogPeriod>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [accessibleUsers, setAccessibleUsers] = useState<{ id: string; full_name: string }[]>([]);

  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [editLog, setEditLog] = useState<CallLog | null>(null);

  useEffect(() => {
    if (!canFilterUsers) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.team.list();
        const members = (data.data || []) as {
          id: string;
          full_name: string;
          role?: string;
          is_active?: boolean | number;
        }[];
        const list = members
          .filter((m) => m.is_active === undefined || m.is_active === true || m.is_active === 1)
          .map((m) => ({ id: m.id, full_name: m.full_name || m.id }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name));
        if (!cancelled) setAccessibleUsers(list);
      } catch {
        if (!cancelled) setAccessibleUsers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canFilterUsers]);

  const query: CallLogsQueryParams = useMemo(() => {
    const q: CallLogsQueryParams = { period };
    if (period === "custom") {
      if (customFrom) q.date_from = customFrom;
      if (customTo) q.date_to = customTo;
    }
    if (canFilterUsers && selectedUser !== "all") {
      q.sales_rep_id = selectedUser;
    }
    return q;
  }, [period, customFrom, customTo, canFilterUsers, selectedUser]);

  const { data: stats, isLoading: statsLoading } = useCallLogStats(query);

  const periodTitle =
    period === "custom" && (customFrom || customTo)
      ? `Custom ${customFrom || "…"} → ${customTo || "…"}`
      : CALL_LOG_PERIODS.find((p) => p.value === period)?.label ?? "Today";

  const openCreate = () => {
    setEditLog(null);
    setLogDialogOpen(true);
  };
  const openEdit = (log: CallLog) => {
    setEditLog(log);
    setLogDialogOpen(true);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Call Log</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Track your daily call activity</p>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <Select value={period} onValueChange={(v) => setPeriod(v as CallLogPeriod)}>
              <SelectTrigger className="w-[140px] sm:w-[160px] h-9 text-xs">
                <SelectValue placeholder="Timeline" />
              </SelectTrigger>
              <SelectContent align="end">
                {CALL_LOG_PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canFilterUsers && (
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger className="w-[160px] sm:w-[200px] h-9 text-xs">
                  <SelectValue placeholder="All users" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="all">All users</SelectItem>
                  {accessibleUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" className="bg-teal-500 hover:bg-teal-600 text-white gap-1.5 h-9" onClick={openCreate}>
              <PhoneCall className="h-4 w-4" /> + Log Call
            </Button>
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-1.5 justify-end">
              <Input
                type="date"
                className="h-8 w-[130px] text-xs"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="From date"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="date"
                className="h-8 w-[130px] text-xs"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="To date"
              />
            </div>
          )}
        </div>
      </div>

      {statsLoading ? (
        <p className="text-sm text-muted-foreground py-4 mb-4">Loading stats…</p>
      ) : (
        <StatsGrid stats={stats ?? emptyStats} periodTitle={periodTitle} />
      )}

      <DailyLogsStrip
        query={query}
        showRepColumn={showRepColumn}
        canMutate={canMutate}
        onCreate={openCreate}
        onEdit={openEdit}
      />

      <LogCallDialog
        open={logDialogOpen}
        onOpenChange={(o) => {
          setLogDialogOpen(o);
          if (!o) setEditLog(null);
        }}
        editLog={editLog}
      />
    </div>
  );
}
