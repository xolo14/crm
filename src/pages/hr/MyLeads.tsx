import { useState } from "react";
import { Calendar, FileText, Plus, Pencil, Trash2, Eye, UserPlus } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import AddLeadDialog from "@/components/hr/AddLeadDialog";
import EditLeadDialog from "@/components/hr/EditLeadDialog";
import { useDeleteLead, useMyLeads } from "@/hooks/useHRLeads";
import type { HRLead } from "@/types/hrLeads";
import { openProtectedUpload } from "@/lib/resumeHref";

const statusClass: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-700 border-blue-200",
  contacted: "bg-amber-500/10 text-amber-700 border-amber-200",
  interested: "bg-green-500/10 text-green-700 border-green-200",
  not_interested: "bg-red-500/10 text-red-700 border-red-200",
  converted: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  lost: "bg-gray-500/10 text-gray-700 border-gray-200",
};
const priorityClass: Record<string, string> = {
  high: "bg-red-500/10 text-red-700 border-red-200",
  medium: "bg-amber-500/10 text-amber-700 border-amber-200",
  low: "bg-green-500/10 text-green-700 border-green-200",
};

export default function MyLeads() {
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [openAdd, setOpenAdd] = useState(false);
  const [editingLead, setEditingLead] = useState<HRLead | null>(null);
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState("all");
  const { data, isLoading } = useMyLeads({ status: statusTab, search, page: 1, limit: 200 });
  const deleteMutation = useDeleteLead();
  const leads = data?.data ?? data?.leads ?? [];
  const total = Number(data?.total ?? leads.length);
  const week = data?.week;

  const onDelete = async (id: number) => {
    if (!confirm("Delete this lead?")) return;
    await deleteMutation.mutateAsync(id);
    toast({ title: "Lead deleted" });
  };

  const emptyWeek = !isLoading && total === 0;

  return (
    <div>
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">My Leads</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">{total} leads this week</p>
        </div>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setOpenAdd(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add Lead
        </Button>
      </div>

      {week && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4 shrink-0 text-teal-500" />
          <span>
            Showing leads for <strong className="text-foreground">{week.label}</strong>
          </span>
          <span className="ml-auto text-xs">Resets {week.resets_in}</span>
        </div>
      )}

      <div className="mb-3">
        <Tabs value={statusTab} onValueChange={setStatusTab}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="new">New</TabsTrigger>
            <TabsTrigger value="contacted">Contacted</TabsTrigger>
            <TabsTrigger value="interested">Interested</TabsTrigger>
            <TabsTrigger value="converted">Enroll</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="mb-4">
        <Input className="h-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone, email..." />
      </div>

      {isLoading ? (
        <p className="py-8 text-sm text-muted-foreground">Loading...</p>
      ) : emptyWeek ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <UserPlus className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-semibold">No leads this week</h3>
          <p className="mt-1 text-sm text-muted-foreground">Start adding leads — your count resets every Monday.</p>
          <Button className="mt-4" onClick={() => setOpenAdd(true)}>
            + Add Your First Lead
          </Button>
        </div>
      ) : isMobile ? (
        <div className="space-y-2.5">
          {leads.map((lead) => (
            <Card key={lead.id} className="border-border/50 shadow-none">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{lead.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{lead.phone}</p>
                  </div>
                  <Badge variant="outline" className={`capitalize ${statusClass[lead.status]}`}>{lead.status.replace(/_/g, " ")}</Badge>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Badge variant="outline" className={`capitalize ${priorityClass[lead.priority]}`}>{lead.priority}</Badge>
                  <p className="text-xs text-muted-foreground">{lead.follow_up_date || "—"}</p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingLead(lead)}>
                    <Pencil className="mr-1 h-3 w-3" />Edit
                  </Button>
                  {lead.resume_path ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs text-teal-600"
                      type="button"
                      onClick={() => {
                        void openProtectedUpload(lead.resume_path).catch(() => {});
                      }}
                    >
                        <FileText className="h-3 w-3" />Resume
                    </Button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground px-1">Resume —</span>
                  )}
                  <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => onDelete(lead.id)}>
                    <Trash2 className="mr-1 h-3 w-3" />Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-border/50 shadow-none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Follow-up</TableHead>
                <TableHead>Resume</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">{lead.full_name}</TableCell>
                  <TableCell>{lead.phone}</TableCell>
                  <TableCell className="text-muted-foreground">{lead.email || "—"}</TableCell>
                  <TableCell>{lead.source || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`capitalize ${statusClass[lead.status]}`}>{lead.status.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`capitalize ${priorityClass[lead.priority]}`}>{lead.priority}</Badge>
                  </TableCell>
                  <TableCell>{lead.follow_up_date || "—"}</TableCell>
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
                  <TableCell className="space-x-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingLead(lead)}>Edit</Button>
                    <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => onDelete(lead.id)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <AddLeadDialog open={openAdd} onOpenChange={setOpenAdd} />
      <EditLeadDialog open={!!editingLead} onOpenChange={(o) => !o && setEditingLead(null)} lead={editingLead} />
    </div>
  );
}
