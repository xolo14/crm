import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { DocForm, DocFormSubmission } from "@/modules/docForms/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Download, ExternalLink, Loader2, Pencil, FileStack } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: DocForm | null;
  publicLink?: string;
  canEdit?: boolean;
  createdByLabel?: string;
  onEdit?: () => void;
  onOpenSubmissions?: () => void;
  onCopyLink?: (url: string, label: string) => void;
};

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export function DocFormDetailDialog({
  open,
  onOpenChange,
  form,
  publicLink = "",
  canEdit = false,
  createdByLabel,
  onEdit,
  onOpenSubmissions,
  onCopyLink,
}: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submissions, setSubmissions] = useState<DocFormSubmission[]>([]);
  const [search, setSearch] = useState("");

  const loadSubmissions = useCallback(async () => {
    if (!form?.id) return;
    setLoading(true);
    try {
      const res = await api.docForms.submissions(form.id);
      setSubmissions(Array.isArray((res as { data?: DocFormSubmission[] })?.data) ? (res as { data: DocFormSubmission[] }).data : []);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Try again.";
      toast({ variant: "destructive", title: "Failed to load submissions", description: message });
    } finally {
      setLoading(false);
    }
  }, [form?.id, toast]);

  useEffect(() => {
    if (!open || !form?.id) return;
    setSearch("");
    void loadSubmissions();
  }, [open, form?.id, loadSubmissions]);

  if (!form) return null;

  const isActive = !!form.is_active;
  const typeLabel = form.form_type === "certificate" ? "Certificate" : "Offer Letter";
  const q = search.trim().toLowerCase();
  const filtered = !q
    ? submissions
    : submissions.filter((s) =>
        `${s.respondent_name || ""} ${s.respondent_email || ""} ${s.status || ""}`.toLowerCase().includes(q),
      );

  const handleExportCsv = () => {
    if (filtered.length === 0) {
      toast({ title: "No submissions to export" });
      return;
    }
    setExporting(true);
    try {
      const headers = ["Name", "Email", "Status", "Submitted"];
      const lines = [headers.join(",")];
      const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
      for (const row of filtered) {
        lines.push(
          [
            esc(String(row.respondent_name || row.values_json?.name || "")),
            esc(String(row.respondent_email || row.values_json?.email || "")),
            esc(String(row.status || "")),
            esc(formatDate(row.created_at)),
          ].join(","),
        );
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${form.slug || form.name || "form"}_submissions.csv`.replace(/[^\w.-]+/g, "_");
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "CSV downloaded", description: `${filtered.length} row(s) exported` });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-4xl max-h-[min(90dvh,100%)] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            {form.name}
            <Badge variant="secondary">{typeLabel}</Badge>
            <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "Active" : "Inactive"}</Badge>
          </DialogTitle>
          <DialogDescription>Form details and submissions for this document form.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Slug</p>
            <code className="text-xs">{form.slug}</code>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Submissions</p>
            <p className="font-medium">{submissions.length || form.submission_count || 0}</p>
          </div>
          {form.org_name ? (
            <div>
              <p className="text-xs text-muted-foreground">Organization</p>
              <p>{form.org_name}</p>
            </div>
          ) : null}
          {createdByLabel ? (
            <div>
              <p className="text-xs text-muted-foreground">Created by</p>
              <p>{createdByLabel}</p>
            </div>
          ) : null}
          {form.created_at ? (
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p>{formatDate(form.created_at)}</p>
            </div>
          ) : null}
          {form.description ? (
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">Description</p>
              <p className="whitespace-pre-wrap text-sm">
                {String(form.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || form.description}
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {publicLink ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCopyLink?.(publicLink, "Form link")}
            >
              <Copy className="h-3.5 w-3.5 mr-1" />
              Copy link
            </Button>
          ) : null}
          {publicLink ? (
            <Button variant="outline" size="sm" asChild>
              <a href={publicLink} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Open form
              </a>
            </Button>
          ) : null}
          {canEdit && onEdit ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onEdit();
              }}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Edit form
            </Button>
          ) : null}
          {onOpenSubmissions ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onOpenSubmissions();
              }}
            >
              <FileStack className="h-3.5 w-3.5 mr-1" />
              Open submissions
            </Button>
          ) : null}
        </div>

        <div className="border-t pt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-sm">Submissions ({filtered.length})</h3>
            <Button variant="outline" size="sm" disabled={exporting || filtered.length === 0} onClick={handleExportCsv}>
              {exporting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
              Export CSV
            </Button>
          </div>
          <Input
            placeholder="Search name, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:max-w-xs h-9"
          />
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No submissions yet.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.respondent_name || row.values_json?.name || "—"}</TableCell>
                      <TableCell>{row.respondent_email || row.values_json?.email || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.status || "—"}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{formatDate(row.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
