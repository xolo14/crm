import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Loader2, Search, Send, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CampaignFormOption, FormLeadDestination, FormLeadRow } from "@/lib/campaignFormLeads";
import { formLeadPersonId, leadHasCampaignContact } from "@/lib/campaignFormLeads";

type Props = {
  forms: CampaignFormOption[];
  formsLoading: boolean;
  selectedFormId: string;
  onSelectedFormIdChange: (formId: string) => void;
  leads: FormLeadRow[];
  leadsLoading: boolean;
  destination: FormLeadDestination;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  contactKind: "email" | "phone";
  onSendSelected: () => void;
};

function formatLeadDate(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? "—" : format(d, "dd MMM yyyy");
}

export function FormLeadsCampaignTab({
  forms,
  formsLoading,
  selectedFormId,
  onSelectedFormIdChange,
  leads,
  leadsLoading,
  destination,
  selectedIds,
  onSelectedIdsChange,
  contactKind,
  onSendSelected,
}: Props) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((lead) => {
      const hay = [
        lead.name,
        lead.full_name,
        lead.email,
        lead.phone,
        lead.source,
        lead.status,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [leads, query]);

  const selectableIds = useMemo(
    () =>
      filtered
        .filter((lead) => leadHasCampaignContact(lead, contactKind))
        .map((lead) => formLeadPersonId(destination, String(lead.id ?? "")))
        .filter((id) => !id.endsWith(":")),
    [filtered, contactKind, destination],
  );

  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const tickedCount = selectableIds.filter((id) => selected.has(id)).length;

  const toggle = (id: string, enabled: boolean) => {
    if (!enabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange(Array.from(next));
  };

  const toggleAll = () => {
    if (allSelected) {
      const drop = new Set(selectableIds);
      onSelectedIdsChange(selectedIds.filter((id) => !drop.has(id)));
      return;
    }
    const next = new Set(selectedIds);
    for (const id of selectableIds) next.add(id);
    onSelectedIdsChange(Array.from(next));
  };

  return (
    <Card>
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-2">
          <Select
            value={selectedFormId || "__none__"}
            onValueChange={(v) => onSelectedFormIdChange(v === "__none__" ? "" : v)}
            disabled={formsLoading}
          >
            <SelectTrigger className="h-9 lg:w-[280px] text-sm">
              <SelectValue placeholder={formsLoading ? "Loading forms…" : "Select a form"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Select a form</SelectItem>
              {forms.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this form’s leads…"
              className="h-9 pl-8 text-sm"
              disabled={!selectedFormId}
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 text-xs"
              onClick={toggleAll}
              disabled={!selectedFormId || leadsLoading || selectableIds.length === 0}
            >
              {allSelected ? "Clear filtered" : "Select all with contact"}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 text-xs gap-1.5"
              onClick={onSendSelected}
              disabled={tickedCount === 0}
            >
              <Send className="h-3.5 w-3.5" />
              Send to {tickedCount} selected
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Only ticked leads with {contactKind === "email" ? "an email" : "a phone number"} are sent the draft / template.
        </p>
      </CardContent>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-xs" />
                <TableHead className="text-xs">#</TableHead>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Email</TableHead>
                <TableHead className="text-xs">Phone</TableHead>
                <TableHead className="text-xs">Source</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!selectedFormId ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                    <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                    Select a form to list its leads.
                  </TableCell>
                </TableRow>
              ) : leadsLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                    <Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin" />
                    Loading form leads…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                    <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                    {leads.length === 0 ? "No form leads on this form yet." : "No leads match this search."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((lead, i) => {
                  const id = formLeadPersonId(destination, String(lead.id ?? ""));
                  const canSend = leadHasCampaignContact(lead, contactKind);
                  return (
                    <TableRow key={id || i} className={canSend ? undefined : "opacity-70"}>
                      <TableCell>
                        <Checkbox
                          checked={canSend && selected.has(id)}
                          disabled={!canSend}
                          onCheckedChange={() => toggle(id, canSend)}
                          aria-label={canSend ? `Select ${lead.name || "lead"}` : `No ${contactKind} on this lead`}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-sm font-medium">{lead.name || lead.full_name || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{lead.email || "—"}</TableCell>
                      <TableCell className="text-xs">{lead.phone || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{lead.source || "form"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            lead.status === "converted" || lead.status === "enrolled"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : lead.status === "interested"
                                ? "bg-blue-50 text-blue-700 border-blue-200"
                                : lead.status === "lost"
                                  ? "bg-red-50 text-red-700 border-red-200"
                                  : "bg-gray-50 text-gray-700 border-gray-200"
                          }
                        >
                          {lead.status === "enrolled" ? "Enroll" : String(lead.status || "new").replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatLeadDate(lead.created_at)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
