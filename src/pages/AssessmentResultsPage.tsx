import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileDown, FileText } from "lucide-react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { normalizeAppRole } from "@/lib/roleUtils";
import { downloadProtectedUpload } from "@/lib/resumeHref";
import {
  assessmentsApi,
  type PeaklyyAttemptAnswerDetail,
  type PeaklyyAttemptRow,
} from "@/services/assessments";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

function downloadTextFile(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function notepadName(candidate: string | undefined, answer: PeaklyyAttemptAnswerDetail): string {
  const base = (candidate || "candidate").replace(/[^\w.-]+/g, "_").slice(0, 40);
  const n = answer.question_number || "task";
  return `${base}-q${n}.txt`;
}

function passLabel(passed: number | null | undefined): string {
  if (passed == null) return "—";
  return Number(passed) ? "Pass" : "Not pass";
}

export default function AssessmentResultsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = normalizeAppRole(user?.role);
  const assessmentId = String(user?.result_assessment_id || "");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [zipBusy, setZipBusy] = useState(false);

  const attemptsQ = useQuery({
    queryKey: ["assessment-results", assessmentId],
    queryFn: () => assessmentsApi.attempts(assessmentId),
    enabled: role === "assessment_viewer" && assessmentId !== "",
  });
  const detailQ = useQuery({
    queryKey: ["assessment-results-detail", detailId],
    queryFn: () => assessmentsApi.attemptDetail(detailId!),
    enabled: !!detailId,
  });

  if (role !== "assessment_viewer") {
    return <Navigate to="/" replace />;
  }

  const rows = attemptsQ.data?.data ?? [];
  const title = attemptsQ.data?.assessment?.title || "Assignment results";

  const downloadZip = async () => {
    if (!detailId) return;
    setZipBusy(true);
    try {
      await assessmentsApi.downloadTasksZip(detailId);
    } catch (e) {
      toast({
        variant: "destructive",
        title: e instanceof Error ? e.message : "ZIP download failed",
      });
    } finally {
      setZipBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Candidates for this assignment. Open a row for answers and task files.</CardDescription>
        </CardHeader>
        <CardContent>
          {!assessmentId ? (
            <p className="text-sm text-muted-foreground">This login is not linked to an assignment.</p>
          ) : attemptsQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading results…</p>
          ) : attemptsQ.isError ? (
            <p className="text-sm text-destructive">
              {attemptsQ.error instanceof Error ? attemptsQ.error.message : "Could not load results"}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Pass</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm text-muted-foreground">
                        No candidates have taken this assignment yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r: PeaklyyAttemptRow) => (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                        <TableCell>
                          <div className="font-medium text-sm">{r.full_name}</div>
                          <div className="text-xs text-muted-foreground">{r.email}</div>
                        </TableCell>
                        <TableCell className="text-sm">{r.domain_label || r.domain_key || "—"}</TableCell>
                        <TableCell className="font-semibold">{r.score ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={Number(r.passed) ? "default" : "outline"}>{passLabel(r.passed)}</Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailId} onOpenChange={(open) => { if (!open) setDetailId(null); }}>
        <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailQ.data?.data?.full_name || "Candidate"}</DialogTitle>
            <DialogDescription>
              {detailQ.data?.data?.email || "Loading…"}
              {detailQ.data?.data ? ` · ${detailQ.data.data.domain_label || detailQ.data.data.domain_key || "—"} · score ${detailQ.data.data.score ?? "—"} · ${passLabel(detailQ.data.data.passed)}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button type="button" size="sm" className="gap-1.5" disabled={zipBusy || !detailId} onClick={() => void downloadZip()}>
              <Download className="h-3.5 w-3.5" />
              {zipBusy ? "Preparing ZIP…" : "Download task files"}
            </Button>
          </div>
          {detailQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading answers…</p>
          ) : (detailQ.data?.answers ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved answers for this attempt yet.</p>
          ) : (
            <div className="space-y-3">
              {(detailQ.data?.answers ?? []).map((a, idx) => (
                <div key={a.question_id} className="rounded-md border p-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Q{a.question_number || idx + 1} · {a.part === "task" ? "Task" : "MCQ"}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{a.prompt || "(no prompt)"}</p>
                  {a.answer_option ? (
                    <p className="text-sm">
                      Selected: <span className="font-medium uppercase">{a.answer_option}</span>
                      {a.is_correct ? <Badge className="ml-2">Correct</Badge> : null}
                    </p>
                  ) : null}
                  {a.text ? (
                    <div className="rounded-md border bg-muted/30 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <FileText className="h-3.5 w-3.5" /> Notepad
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          onClick={() => {
                            const name = notepadName(detailQ.data?.data?.full_name, a);
                            if (a.notepad_file_path) {
                              void downloadProtectedUpload(a.notepad_file_path, name).catch((e) =>
                                toast({ variant: "destructive", title: e instanceof Error ? e.message : "Download failed" }),
                              );
                            } else {
                              downloadTextFile(a.text, name);
                            }
                          }}
                        >
                          <FileDown className="h-3 w-3" /> .txt
                        </Button>
                      </div>
                      <pre className="text-sm whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">{a.text}</pre>
                    </div>
                  ) : null}
                  {a.file_path ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() =>
                        void downloadProtectedUpload(a.file_path, a.file_name || undefined).catch((e) =>
                          toast({ variant: "destructive", title: e instanceof Error ? e.message : "Download failed" }),
                        )
                      }
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      {a.file_name || "Download upload"}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
