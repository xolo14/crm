import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Clock, Download, Eye, FileText, MoreHorizontal, PhoneCall, Plus, Search, Shuffle, TrendingUp, UserCheck, Users, XCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAllHRLeads, useHRLeadStats, useAssignLead, useBulkAssignLeads, useDeleteLead, useUpdateLead } from "@/hooks/useHRLeads";
import AddLeadDialog from "@/components/hr/AddLeadDialog";
import AssignHRLeadDialog from "@/components/leads/AssignHRLeadDialog";
import BulkAssignHRLeadsDialog from "@/components/leads/BulkAssignHRLeadsDialog";
import { FormSubmissionDetails } from "@/components/leads/FormSubmissionDetails";
import { LeadContactBlock } from "@/components/leads/LeadContactBlock";
import type { HRLead, HRLeadStats } from "@/types/hrLeads";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import * as perms from "@/lib/permissions";
import { getISTLastWeekRangeYYYYMMDD, getISTMonthRangeYYYYMMDD, getISTWeekRangeYYYYMMDD } from "@/lib/hrLeadsWeek";
import { openProtectedUpload } from "@/lib/resumeHref";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const STATUSES = ["new", "contacted", "interested", "not_interested", "converted", "lost"];

/** API may return `id` as string; selection Set uses strict equality — normalize to number. */
function leadNumericId(lead: HRLead): number {
  const v = lead.id as unknown;
  const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? n : 0;
}
type DatePreset = "all" | "this_week" | "last_week" | "this_month";
const SOURCES = ["Walk-in", "Referral", "Online", "Cold Call", "Social Media", "Other"];
const statusColors: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-700 border-blue-200",
  contacted: "bg-amber-500/10 text-amber-700 border-amber-200",
  interested: "bg-green-500/10 text-green-700 border-green-200",
  not_interested: "bg-red-500/10 text-red-700 border-red-200",
  converted: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  lost: "bg-gray-500/10 text-gray-700 border-gray-200",
};

export default function HRLeadsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = String(user?.role || "").toLowerCase();
  const normalizedRole = role === "superadmin" ? "super_admin" : role === "organisation" ? "org" : role;
  const isSuperAdmin = normalizedRole === "super_admin";
  const isAdmin = normalizedRole === "admin";
  const isOrg = normalizedRole === "org";
  const hasExport = perms.canExport(normalizedRole);
  const canAssign = isSuperAdmin || isAdmin;
  const canDelete = isSuperAdmin || isAdmin;
  const canAddLead = isSuperAdmin || isAdmin;
  const showHrFilter = isSuperAdmin || isAdmin;
  const showOrgFilter = isSuperAdmin;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [hrId, setHrId] = useState("all");
  const [orgId, setOrgId] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [dateFromManual, setDateFromManual] = useState("");
  const [dateToManual, setDateToManual] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [openAdd, setOpenAdd] = useState(false);
  const [assigningLead, setAssigningLead] = useState<number | null>(null);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [detailLead, setDetailLead] = useState<HRLead | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const hrListOrgFilter = isSuperAdmin && orgId !== "all" ? orgId : undefined;
  const { data: hrListData } = useQuery({
    queryKey: ["hr", "list", hrListOrgFilter || "all"],
    queryFn: () => api.hr.list(hrListOrgFilter),
  });
  const { data: orgsData } = useQuery({
    queryKey: ["organizations", "list"],
    queryFn: () => api.organizations.list(),
    enabled: isSuperAdmin,
  });
  const hrUsers = hrListData?.data || [];
  const organizations = orgsData?.data || orgsData || [];
  const { data: statsRes } = useHRLeadStats(showOrgFilter && orgId !== "all" ? orgId : undefined);
  const stats = (statsRes?.stats ?? {}) as HRLeadStats & { unassigned?: number };

  const dateFilter = useMemo((): { from?: string; to?: string } => {
    if (datePreset === "this_week") return getISTWeekRangeYYYYMMDD();
    if (datePreset === "last_week") return getISTLastWeekRangeYYYYMMDD();
    if (datePreset === "this_month") return getISTMonthRangeYYYYMMDD();
    const from = dateFromManual.trim();
    const to = dateToManual.trim();
    if (!from && !to) return {};
    return { from: from || undefined, to: to || undefined };
  }, [datePreset, dateFromManual, dateToManual]);

  const { data, isLoading } = useAllHRLeads({
    search,
    status: status as any,
    source,
    hr_id: showHrFilter && hrId !== "all" ? hrId : undefined,
    org_id: showOrgFilter && orgId !== "all" ? orgId : undefined,
    date_from: dateFilter.from,
    date_to: dateFilter.to,
    page,
    limit,
  });
  const rows: HRLead[] = data?.leads || data?.data || [];
  const total = Number(data?.total || 0);
  const unassigned = Number(data?.unassigned || stats?.unassigned || 0);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const assignMutation = useAssignLead();
  const bulkAssignMutation = useBulkAssignLeads();
  const updateMutation = useUpdateLead();
  const deleteMutation = useDeleteLead();

  const selectedRows = useMemo(() => rows.filter((r) => selectedIds.has(leadNumericId(r))), [rows, selectedIds]);
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(leadNumericId(r)));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const onExport = (rowsToExport: HRLead[]) => {
    const headers = ["Name", "Phone", "Email", "Source", "Status", "Priority", "HR Name", "Assigned", "Notes", "Follow-up Date", "Created"];
    const csvRows = rowsToExport.map((l) => [
      l.full_name, l.phone, l.email || "", l.source || "", l.status, l.priority, l.hr_name || "", l.assigned_by_name || "", l.notes || "", l.follow_up_date || "", l.created_at,
    ]);
    const csv = [headers.join(","), ...csvRows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hr-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openBulkAssign = () => {
    if (selectedIds.size === 0) {
      toast({
        title: "No leads selected",
        description: "Tick the checkboxes in the table (left column), then click Bulk Assign.",
      });
      return;
    }
    setBulkAssignOpen(true);
  };

  return (
    <TooltipProvider delayDuration={200}>
    <div>
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">HR Leads</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            {total} leads · {unassigned > 0 && <span className="font-medium text-teal-600">{unassigned} unassigned</span>}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {isSuperAdmin ? "Scope: all leads" : isAdmin ? "Scope: organization leads" : "Scope: your organization's HR leads"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasExport && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => onExport(rows)}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          )}
          {canAssign && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={openBulkAssign}>
                  <Shuffle className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Bulk Assign</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                {selectedIds.size === 0
                  ? "Select one or more leads using the checkboxes in the table, then bulk-assign to HR."
                  : `${selectedIds.size} lead(s) selected — click to choose HR recipients.`}
              </TooltipContent>
            </Tooltip>
          )}
          {canAddLead && (
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setOpenAdd(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Lead
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2 sm:gap-3 mb-5">
        {[
          { label: "TOTAL LEADS", value: stats.total || 0, icon: Users, sub: "All HR Added" },
          { label: "NEW", value: stats.by_status?.new || 0, icon: Clock, sub: "Untouched" },
          { label: "CONTACTED", value: stats.by_status?.contacted || 0, icon: PhoneCall, sub: "Reached" },
          { label: "INTERESTED", value: stats.by_status?.interested || 0, icon: TrendingUp, sub: "Warm" },
          { label: "ENROLL", value: stats.by_status?.converted || 0, icon: CheckCircle, sub: `${stats.total ? Math.round(((stats.by_status?.converted || 0) / stats.total) * 100) : 0}% won` },
          { label: "LOST", value: stats.by_status?.lost || 0, icon: XCircle, sub: "Dropped" },
          { label: "UNASSIGNED", value: stats.unassigned || unassigned, icon: AlertCircle, sub: "Need action" },
        ].map((c) => (
          <Card key={c.label} className="border-border/50 shadow-none">
            <CardContent className="pt-3 pb-2.5 px-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{c.label}</span>
                <c.icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="text-lg font-bold">{c.value}</div>
              <p className="text-[10px] text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-4 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-xs sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-9" placeholder="Search by name, email, phone..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
          <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="All Sources" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {showHrFilter && (
          <Select value={hrId} onValueChange={(v) => { setHrId(v); setPage(1); }}>
            <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="All HRs" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All HRs</SelectItem>
              {hrUsers.map((hr: any) => <SelectItem key={hr.id} value={hr.id}>{hr.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {showOrgFilter && (
          <Select value={orgId} onValueChange={(v) => { setOrgId(v); setPage(1); }}>
            <SelectTrigger className="w-[190px] h-9"><SelectValue placeholder="All Organizations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Organizations</SelectItem>
              {organizations.map((org: any) => <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <span className="text-xs font-medium text-muted-foreground sm:mr-1 sm:self-center">Date range</span>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant={datePreset === "all" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setDatePreset("all");
              setPage(1);
            }}
          >
            All Time
          </Button>
          <Button
            type="button"
            variant={datePreset === "this_week" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setDatePreset("this_week");
              setDateFromManual("");
              setDateToManual("");
              setPage(1);
            }}
          >
            This Week
          </Button>
          <Button
            type="button"
            variant={datePreset === "last_week" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setDatePreset("last_week");
              setDateFromManual("");
              setDateToManual("");
              setPage(1);
            }}
          >
            Last Week
          </Button>
          <Button
            type="button"
            variant={datePreset === "this_month" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setDatePreset("this_month");
              setDateFromManual("");
              setDateToManual("");
              setPage(1);
            }}
          >
            This Month
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            className="h-9 w-[150px]"
            value={dateFromManual}
            onChange={(e) => {
              setDatePreset("all");
              setDateFromManual(e.target.value);
              setPage(1);
            }}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            className="h-9 w-[150px]"
            value={dateToManual}
            onChange={(e) => {
              setDatePreset("all");
              setDateToManual(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {canAssign && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
          <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
          <Button size="sm" className="h-7 gap-1" onClick={openBulkAssign}>
            <Shuffle className="h-3 w-3" /> Bulk Assign to HR
          </Button>
          {hasExport && (
            <Button size="sm" variant="outline" className="h-7" onClick={() => onExport(selectedRows)}>
              Export Selected
            </Button>
          )}
        </div>
      )}

      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{rows.length} of {total} leads</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Per page:</span>
          <Select value={String(limit)} onValueChange={(v) => { setLimit(Number(v)); setPage(1); }}>
            <SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{[10, 25, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-border/50 shadow-none">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10"><Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={() => {
                if (allSelected) setSelectedIds(new Set());
                else setSelectedIds(new Set(rows.map((r) => leadNumericId(r))));
              }} /></TableHead>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>HR (Added By)</TableHead>
              {isSuperAdmin && <TableHead>Organization</TableHead>}
              <TableHead>Assigned</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Resume</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={isSuperAdmin ? 13 : 12} className="py-8 text-center text-muted-foreground">Loading...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={isSuperAdmin ? 13 : 12} className="py-8 text-center text-muted-foreground">No leads found</TableCell></TableRow>
            ) : rows.map((lead, idx) => (
              <TableRow key={lead.id} className={cn(selectedIds.has(leadNumericId(lead)) && "bg-primary/5")}>
                <TableCell><Checkbox checked={selectedIds.has(leadNumericId(lead))} onCheckedChange={() => {
                  const lid = leadNumericId(lead);
                  setSelectedIds((prev) => {
                    const n = new Set(prev);
                    if (n.has(lid)) n.delete(lid); else n.add(lid);
                    return n;
                  });
                }} /></TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">{(page - 1) * limit + idx + 1}</TableCell>
                <TableCell>
                  <p className="text-sm font-medium">{lead.full_name}</p>
                </TableCell>
                <TableCell>
                  <LeadContactBlock email={lead.email} phone={lead.phone} notes={lead.notes} variant="table" />
                </TableCell>
                <TableCell><Badge variant="secondary" className="text-xs">{lead.source || "Other"}</Badge></TableCell>
                <TableCell>
                  <Select value={lead.status} onValueChange={(v) => updateMutation.mutate({ id: leadNumericId(lead), status: v as any })}>
                    <SelectTrigger className="h-7 w-auto border-0 p-0">
                      <Badge variant="outline" className={`${statusColors[lead.status]} capitalize`}>{lead.status.replace(/_/g, " ")}</Badge>
                    </SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
                <TableCell>{lead.hr_name || "—"}</TableCell>
                {isSuperAdmin && <TableCell>{lead.org_name || "—"}</TableCell>}
                <TableCell className={cn(!Number(lead.is_assigned) && "text-muted-foreground")}>{Number(lead.is_assigned) ? (lead.assigned_by_name || "Assigned") : "Unassigned"}</TableCell>
                <TableCell>{new Date(lead.created_at).toLocaleDateString()}</TableCell>
                <TableCell>
                  {lead.resume_path ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-teal-600 px-2"
                      type="button"
                      onClick={() => {
                        void openProtectedUpload(lead.resume_path).catch(() => {});
                      }}
                    >
                        <FileText className="h-3.5 w-3.5" />
                        View
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {canAssign ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1"
                        onClick={() => {
                          setDetailLead(lead);
                          setDetailOpen(true);
                        }}
                      >
                        <Eye className="h-3 w-3" /> View
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setAssigningLead(leadNumericId(lead))}>
                        <UserCheck className="h-3 w-3" /> {Number(lead.is_assigned) ? "Reassign" : "Assign"}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1"
                      onClick={() => {
                        setDetailLead(lead);
                        setDetailOpen(true);
                      }}
                    >
                      <Eye className="h-3 w-3" /> View
                    </Button>
                  )}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setDetailLead(lead);
                          setDetailOpen(true);
                        }}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        View
                      </DropdownMenuItem>
                      {canAssign && <DropdownMenuItem onClick={() => setAssigningLead(leadNumericId(lead))}>Edit</DropdownMenuItem>}
                      {canDelete && (
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={async () => {
                            if (!confirm("Delete this lead?")) return;
                            await deleteMutation.mutateAsync(leadNumericId(lead));
                            toast({ title: "Lead deleted" });
                          }}
                        >
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="px-2 text-xs text-muted-foreground">Page {page} / {totalPages}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}

      {canAddLead && <AddLeadDialog open={openAdd} onOpenChange={setOpenAdd} hrUsers={hrUsers} />}

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {detailLead ? (
            <>
              <SheetHeader className="pb-4 border-b border-border">
                <SheetTitle className="text-lg">{detailLead.full_name}</SheetTitle>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant="outline" className={`${statusColors[detailLead.status]} capitalize text-xs`}>
                    {detailLead.status.replace(/_/g, " ")}
                  </Badge>
                  <Badge variant="secondary" className="text-xs capitalize">
                    {detailLead.source?.replace(/^form_/, "Form ").replace(/_/g, " ") || "Other"}
                  </Badge>
                </div>
              </SheetHeader>

              <div className="mt-5 space-y-5">
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Contact Information
                  </h4>
                  <LeadContactBlock
                    email={detailLead.email}
                    phone={detailLead.phone}
                    notes={detailLead.notes}
                    variant="detail"
                  />
                  {detailLead.resume_path ? (
                    <div className="flex items-center gap-3 pt-3">
                      <div className="h-8 w-8 rounded-lg bg-teal-500/10 flex items-center justify-center">
                        <FileText className="h-4 w-4 text-teal-600" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Resume</p>
                        <Button
                          variant="link"
                          className="h-auto p-0 text-teal-600 text-sm"
                          type="button"
                          onClick={() => {
                            void openProtectedUpload(detailLead.resume_path).catch(() => {});
                          }}
                        >
                            View file
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-border pt-4 space-y-2.5">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="text-xs text-muted-foreground">HR (Added By)</p>
                      <p className="text-sm font-medium">{detailLead.hr_name || "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="text-xs text-muted-foreground">Assigned</p>
                      <p className="text-sm font-medium">
                        {Number(detailLead.is_assigned) ? detailLead.assigned_by_name || "Assigned" : "Unassigned"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="text-xs text-muted-foreground">Submitted On</p>
                      <p className="text-sm font-medium">
                        {new Date(detailLead.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                </div>

                <FormSubmissionDetails notes={detailLead.notes} resumePath={detailLead.resume_path} />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {canAssign && (
        <AssignHRLeadDialog
          open={!!assigningLead}
          onOpenChange={(o) => !o && setAssigningLead(null)}
          hrUsers={hrUsers}
          loading={assignMutation.isPending}
          onAssign={async (newHrId) => {
            if (!assigningLead) return;
            await assignMutation.mutateAsync({ id: assigningLead, hr_id: newHrId });
            toast({ title: "Lead reassigned" });
          }}
        />
      )}
      {canAssign && (
        <BulkAssignHRLeadsDialog
          open={bulkAssignOpen}
          onOpenChange={setBulkAssignOpen}
          hrUsers={hrUsers}
          selectedCount={selectedIds.size}
          loading={bulkAssigning}
          onAssign={async (hrIdsOrdered) => {
            const ids = Array.from(selectedIds);
            if (ids.length === 0 || hrIdsOrdered.length === 0) return;
            setBulkAssigning(true);
            try {
              const n = hrIdsOrdered.length;
              const assignments = ids.map((id, i) => ({ id, hr_id: hrIdsOrdered[i % n] }));
              const res = await bulkAssignMutation.mutateAsync(assignments);
              const { assigned, failed, results } = res;
              if (failed === 0) {
                toast({
                  title: "Bulk assign complete",
                  description: `${assigned} lead${assigned === 1 ? "" : "s"} split round-robin across ${n} HR user${n === 1 ? "" : "s"}.`,
                });
              } else {
                const firstErr = results.find((r) => !r.ok)?.error || "Some assignments failed";
                toast({
                  variant: "destructive",
                  title: `Bulk assign partial — ${assigned} done, ${failed} failed`,
                  description: firstErr,
                });
              }
              setBulkAssignOpen(false);
              setSelectedIds(new Set());
            } catch (err: any) {
              toast({
                variant: "destructive",
                title: "Bulk assign failed",
                description: err?.message || "Could not assign leads.",
              });
            } finally {
              setBulkAssigning(false);
            }
          }}
        />
      )}
    </div>
    </TooltipProvider>
  );
}
