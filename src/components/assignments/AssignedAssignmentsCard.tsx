import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Copy, ExternalLink } from "lucide-react";
import { assessmentsApi, type PeaklyyAssessment } from "@/services/assessments";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

function assessmentPublicPath(a: PeaklyyAssessment | null | undefined): string {
  if (!a) return "";
  const key = a.result_api_key ? `#key=${encodeURIComponent(a.result_api_key)}` : "";
  if (typeof window === "undefined") return `/assessment/${a.slug}${key}`;
  return `${window.location.origin}/assessment/${a.slug}${key}`;
}

export default function AssignedAssignmentsCard({ variant = "dashboard" }: { variant?: "dashboard" | "page" }) {
  const { toast } = useToast();
  const [selectedModal, setSelectedModal] = useState<PeaklyyAssessment | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["my_assignments"],
    queryFn: () => assessmentsApi.myAssignments(),
  });

  const assignments = data?.data || [];

  if (isLoading) {
    if (variant === "dashboard") return null;
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground text-center">Loading your assignments…</CardContent>
      </Card>
    );
  }

  if (assignments.length === 0) {
    if (variant === "dashboard") return null;
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground text-center">
          No assignments have been assigned to you yet. Contact a Super Admin.
        </CardContent>
      </Card>
    );
  }

  const handleCopyLink = (a: PeaklyyAssessment) => {
    const url = assessmentPublicPath(a);
    void navigator.clipboard.writeText(url);
    toast({ title: "Assignment link copied to clipboard" });
  };

  return (
    <>
      <Card className="mb-4 border-border/50 shadow-none border-emerald-500/20 bg-emerald-500/[0.03]">
        <CardHeader className="px-3 sm:px-4 pb-2 pt-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-emerald-600" />
            Your assigned assignments
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground font-normal leading-snug mt-1">
            Assignments assigned to you by admin. Share the link with candidates or click to view details.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-3 sm:px-4 pb-4">
          <div className="space-y-2">
            {assignments.map((a) => {
              const fullUrl = assessmentPublicPath(a);
              return (
                <div
                  key={a.id}
                  className="rounded-lg border border-border/60 bg-background p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors hover:border-emerald-500/40"
                >
                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => setSelectedModal(a)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium hover:text-emerald-700 transition-colors">
                        {a.title}
                      </p>
                      <Badge variant="outline" className="text-[10px] py-0">
                        {a.source_mode === "custom" ? "Custom" : "Domain"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {a.question_count} Q ·{" "}
                      {a.source_mode === "domain_bank" || !a.duration_minutes
                        ? "untimed"
                        : `${a.duration_minutes} min`}{" "}
                      · /{a.slug}
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground truncate mt-1">
                      {fullUrl}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1.5 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyLink(a);
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy link
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1.5"
                      onClick={() => setSelectedModal(a)}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Details
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Assignment Details Popup Modal (matching picture) */}
      <Dialog open={!!selectedModal} onOpenChange={(open) => { if (!open) setSelectedModal(null); }}>
        <DialogContent className="max-w-lg w-[min(32rem,calc(100vw-1.25rem))] overflow-x-hidden overflow-y-auto">
          {selectedModal && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6">{selectedModal.title || "Assignment link"}</DialogTitle>
                <DialogDescription>
                  Permanent candidate link and partner API key · /{selectedModal.slug}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Permanent assessment link</Label>
                  <div className="flex items-center gap-2 min-w-0">
                    <Input readOnly value={assessmentPublicPath(selectedModal)} className="min-w-0 flex-1 text-xs" />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => handleCopyLink(selectedModal)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="outline" size="icon" asChild>
                      <a href={assessmentPublicPath(selectedModal)} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Permanent API key</Label>
                  <div className="flex items-center gap-2 min-w-0">
                    <Input
                      readOnly
                      value={selectedModal.result_api_key || "(none)"}
                      className="min-w-0 flex-1 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={!selectedModal.result_api_key}
                      onClick={() => {
                        void navigator.clipboard.writeText(String(selectedModal.result_api_key || ""));
                        toast({ title: "API key copied" });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {selectedModal.result_api_key && (
                  <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground space-y-1.5 leading-relaxed">
                    <p className="font-medium text-foreground">Partner website</p>
                    <p>
                      Header:{" "}
                      <code className="text-[10px]">X-Assessment-Api-Key: {selectedModal.result_api_key}</code>
                    </p>
                    <p>
                      List attempts:{" "}
                      <code className="text-[10px] break-all">GET /api/assessments.php?action=partner_attempts</code>
                    </p>
                    <p>
                      Score JSON:{" "}
                      <code className="text-[10px] break-all">
                        GET /api/assessments.php?action=partner_result&amp;attempt_id=…
                      </code>
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
