import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { useAssignedLeads, useUpdateLead } from "@/hooks/useHRLeads";
import type { HRLead } from "@/types/hrLeads";
import { openProtectedUpload } from "@/lib/resumeHref";
import { statusLabel } from "@/lib/hrFormat";

const PAGE_SIZE = 25;

export default function AssignedLeads() {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAssignedLeads({ status, search, page: 1, limit: 10000 });
  const mutation = useUpdateLead();
  const leads = useMemo(() => data?.data || [], [data]) as HRLead[];
  const statuses = ["new", "contacted", "interested", "not_interested", "converted", "lost"];
  const totalPages = Math.max(1, Math.ceil(leads.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageLeads = leads.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleUpdate = async (lead: HRLead, patch: Partial<HRLead>) => {
    await mutation.mutateAsync({ id: lead.id, ...patch });
    toast({ title: "Lead updated" });
  };

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Assigned Leads</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">Leads assigned by admin/super admin</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Input className="h-9" aria-label="Search assigned leads" placeholder="Search name, email or phone..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select aria-label="Filter by status" className="h-9 rounded-md border px-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="all">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </div>
      {isLoading ? (
        <p className="py-8 text-sm text-muted-foreground">Loading...</p>
      ) : isMobile ? (
        <div className="space-y-2.5">
          {pageLeads.map((lead) => (
            <Card key={lead.id} className="border-border/50 shadow-none">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{lead.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{lead.email || "—"}</p>
                  </div>
                  <Badge variant="outline">{statusLabel(lead.status)}</Badge>
                </div>
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-muted-foreground">Assigned by: {lead.assigned_by_name || "—"}</p>
                  {lead.resume_path ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs text-teal-600 font-medium bg-transparent border-0 p-0 cursor-pointer"
                      onClick={() => {
                        void openProtectedUpload(lead.resume_path).catch(() => {});
                      }}
                    >
                      <FileText className="h-3 w-3" /> View resume
                    </button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Resume —</span>
                  )}
                  <select
                    className="h-8 w-full rounded-md border px-2 text-xs"
                    value={lead.status}
                    onChange={(e) => handleUpdate(lead, { status: e.target.value as any })}
                  >
                    {statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                  <Input
                    className="h-8 text-xs"
                    defaultValue={lead.notes || ""}
                    placeholder="Update notes..."
                    onBlur={(e) => {
                      if ((lead.notes || "") !== e.target.value) {
                        handleUpdate(lead, { notes: e.target.value });
                      }
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-border/50 shadow-none">
          <div className="overflow-x-auto">
          <Table className="min-w-[860px]">
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Assigned By</TableHead><TableHead>Resume</TableHead><TableHead className="w-40">Status</TableHead><TableHead className="w-72">Notes</TableHead></TableRow></TableHeader>
            <TableBody>
              {pageLeads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">{lead.full_name}</TableCell>
                  <TableCell>
                    <div className="text-sm">{lead.phone || "—"}</div>
                    <div className="max-w-[220px] truncate text-xs text-muted-foreground" title={lead.email || ""}>{lead.email || "—"}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{lead.assigned_by_name || "—"}</TableCell>
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
                    <select
                      aria-label={`Status for ${lead.full_name}`}
                      className="h-8 rounded-md border px-2 text-xs"
                      value={lead.status}
                      onChange={(e) => handleUpdate(lead, { status: e.target.value as any })}
                    >
                      {statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Notes for ${lead.full_name}`}
                      className="h-8 text-xs"
                      title={lead.notes || ""}
                      defaultValue={lead.notes || ""}
                      placeholder="Add note"
                      onBlur={(e) => {
                        if ((lead.notes || "") !== e.target.value) {
                          handleUpdate(lead, { notes: e.target.value });
                        }
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </Card>
      )}
      {!isLoading && leads.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No assigned leads match these filters.</p>
      ) : null}
      {!isLoading && leads.length > PAGE_SIZE ? (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, leads.length)} of {leads.length}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
            <span>Page {currentPage} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Next</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
