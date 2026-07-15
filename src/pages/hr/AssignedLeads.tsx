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

export default function AssignedLeads() {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const { data, isLoading } = useAssignedLeads({ status, search, page: 1, limit: 200 });
  const mutation = useUpdateLead();
  const leads = useMemo(() => data?.data || [], [data]) as HRLead[];
  const statuses = ["new", "contacted", "interested", "not_interested", "converted", "lost"];

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
        <Input className="h-9" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="h-9 rounded-md border px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All</option>{statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {isLoading ? (
        <p className="py-8 text-sm text-muted-foreground">Loading...</p>
      ) : isMobile ? (
        <div className="space-y-2.5">
          {leads.map((lead) => (
            <Card key={lead.id} className="border-border/50 shadow-none">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{lead.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{lead.email || "—"}</p>
                  </div>
                  <Badge variant="outline" className="capitalize">{lead.status.replace(/_/g, " ")}</Badge>
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
                    {statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
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
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Email</TableHead><TableHead>Assigned By</TableHead><TableHead>Resume</TableHead><TableHead>Status</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">{lead.full_name}</TableCell>
                  <TableCell>{lead.phone}</TableCell>
                  <TableCell className="text-muted-foreground">{lead.email || "—"}</TableCell>
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
                      className="h-8 rounded-md border px-2 text-xs"
                      value={lead.status}
                      onChange={(e) => handleUpdate(lead, { status: e.target.value as any })}
                    >
                      {statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-xs"
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
        </Card>
      )}
    </div>
  );
}
