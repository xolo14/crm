import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { formatCallDuration } from "@/lib/callDuration";
import { useAddCallLog, useUpdateCallLog } from "@/hooks/useCallLogs";
import { useToast } from "@/hooks/use-toast";
import { openProtectedUpload } from "@/lib/resumeHref";
import type { CallLog, CreateCallLogInput } from "@/types/callLog";

/** Mirrors CRM lead statuses (`leads.status`). Labels aligned with Leads UI; enroll maps to DB `enrolled`. */
export const LEAD_PIPELINE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "interested", label: "Interested" },
  { value: "demo_scheduled", label: "Demo Scheduled" },
  { value: "demo_attended", label: "Demo Attended" },
  { value: "enrolled", label: "Enroll" },
  { value: "lost", label: "Lost" },
];

/** Valid pipeline values; includes legacy `considering` for existing leads until changed. */
const PIPELINE_SET = new Set([...LEAD_PIPELINE_OPTIONS.map((o) => o.value), "considering"]);

const schema = z
  .object({
    call_type: z.enum(["incoming", "outgoing", "missed", "rejected"]),
    call_status: z.enum(["connected", "never_attended", "not_pickup_by_client"]),
    call_date: z.string().min(1, "Date required"),
    call_time: z.string().optional(),
    duration_min: z.coerce.number().min(0).default(0),
    duration_sec: z.coerce.number().min(0).max(59).default(0),
    notes: z.string().optional(),
    lead_id: z.string().optional(),
    lead_pipeline_status: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const lid = data.lead_id?.trim();
    if (!lid) return;
    const st = data.lead_pipeline_status?.trim();
    if (!st || !PIPELINE_SET.has(st)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select lead status",
        path: ["lead_pipeline_status"],
      });
    }
  });

type FormValues = z.infer<typeof schema>;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function secondsToMinSec(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return { m, s };
}

export default function LogCallDialog({
  open,
  onOpenChange,
  editLog,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editLog?: CallLog | null;
}) {
  const { toast } = useToast();
  const addMut = useAddCallLog();
  const updMut = useUpdateCallLog();
  const [recordingFile, setRecordingFile] = useState<File | null>(null);
  /** Portal selects into dialog root so dropdown aligns with triggers inside transformed / scrollable modals */
  const [dialogContentEl, setDialogContentEl] = useState<HTMLElement | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      call_type: "outgoing",
      call_status: "connected",
      call_date: todayISO(),
      call_time: "",
      duration_min: 0,
      duration_sec: 0,
      notes: "",
      lead_id: "",
      lead_pipeline_status: "",
    },
  });

  const { data: leadsRes } = useQuery({
    queryKey: ["leads", "pick-call-log"],
    queryFn: () => api.leads.list(),
    enabled: open,
  });
  const leads = Array.isArray(leadsRes) ? leadsRes : (leadsRes as any)?.data || [];

  const watchedLeadId = form.watch("lead_id")?.trim() || "";
  const selectedLead = useMemo(
    () => (watchedLeadId ? leads.find((l: { id: string }) => l.id === watchedLeadId) : null),
    [leads, watchedLeadId],
  );
  const prevLinkedLeadRef = useRef<string>("");

  useEffect(() => {
    if (!open) {
      prevLinkedLeadRef.current = "";
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setRecordingFile(null);
    if (editLog) {
      const { m, s } = secondsToMinSec(Number(editLog.duration_seconds || 0));
      let timeVal = editLog.call_time || "";
      if (timeVal.length >= 8) timeVal = timeVal.slice(0, 5);
      const linkedLead = editLog.lead_id ? leads.find((l: { id: string }) => l.id === editLog.lead_id) : null;
      const rawSt = linkedLead?.status ? String(linkedLead.status) : "";
      const pipeStatus =
        rawSt === "converted"
          ? "enrolled"
          : rawSt && PIPELINE_SET.has(rawSt)
            ? rawSt
            : "";
      form.reset({
        call_type: editLog.call_type,
        call_status: editLog.call_status,
        call_date: editLog.call_date?.slice(0, 10) || todayISO(),
        call_time: timeVal,
        duration_min: m,
        duration_sec: s,
        notes: editLog.notes || "",
        lead_id: editLog.lead_id || "",
        lead_pipeline_status: pipeStatus,
      });
    } else {
      form.reset({
        call_type: "outgoing",
        call_status: "connected",
        call_date: todayISO(),
        call_time: "",
        duration_min: 0,
        duration_sec: 0,
        notes: "",
        lead_id: "",
        lead_pipeline_status: "",
      });
    }
  }, [open, editLog, form, leads]);

  useEffect(() => {
    if (!open) return;
    if (!watchedLeadId) {
      prevLinkedLeadRef.current = "";
      form.setValue("lead_pipeline_status", "");
      return;
    }
    const L = leads.find((l: { id: string }) => l.id === watchedLeadId);
    const st = L?.status ? String(L.status) : "";
    const nextPipe =
      st === "converted" ? "enrolled" : st && PIPELINE_SET.has(st) ? st : "new";
    const leadChanged = prevLinkedLeadRef.current !== watchedLeadId;
    prevLinkedLeadRef.current = watchedLeadId;
    const cur = form.getValues("lead_pipeline_status")?.trim();
    if (leadChanged || !cur) {
      form.setValue("lead_pipeline_status", nextPipe);
    }
  }, [open, watchedLeadId, leads, form]);

  const submit = form.handleSubmit(async (vals) => {
    const duration_seconds = vals.duration_min * 60 + vals.duration_sec;
    const lid = vals.lead_id?.trim();
    const payload: CreateCallLogInput = {
      call_type: vals.call_type,
      call_status: vals.call_status,
      duration_seconds,
      notes: vals.notes?.trim() || undefined,
      call_date: vals.call_date,
      call_time: vals.call_time?.trim() || undefined,
      lead_id: lid || undefined,
      ...(lid && vals.lead_pipeline_status?.trim()
        ? { lead_status: vals.lead_pipeline_status.trim() }
        : {}),
    };
    try {
      if (editLog) {
        await updMut.mutateAsync({
          id: editLog.id,
          ...payload,
          ...(recordingFile ? { recording: recordingFile } : {}),
        });
        toast({ title: "Call updated" });
      } else {
        await addMut.mutateAsync({
          ...payload,
          ...(recordingFile ? { recording: recordingFile } : {}),
        });
        toast({ title: "Call logged" });
      }
      onOpenChange(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e?.message || "Failed" });
    }
  });

  const previewSec = form.watch("duration_min") * 60 + form.watch("duration_sec");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={(node) => setDialogContentEl(node)}
        className="max-w-lg max-h-[min(90dvh,calc(100dvh-2rem))] flex flex-col gap-0 overflow-hidden p-6"
      >
        <DialogHeader className="shrink-0 space-y-1.5 pb-4">
          <DialogTitle>{editLog ? "Edit Call" : "Log Call"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Call Type *</Label>
                <Select value={form.watch("call_type")} onValueChange={(v: string) => form.setValue("call_type", v as FormValues["call_type"])}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent container={dialogContentEl} side="bottom" sideOffset={4} align="start">
                    <SelectItem value="incoming">Incoming</SelectItem>
                    <SelectItem value="outgoing">Outgoing</SelectItem>
                    <SelectItem value="missed">Missed</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Call Status *</Label>
                <Select value={form.watch("call_status")} onValueChange={(v: string) => form.setValue("call_status", v as FormValues["call_status"])}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent container={dialogContentEl} side="bottom" sideOffset={4} align="start">
                    <SelectItem value="connected">Connected</SelectItem>
                    <SelectItem value="never_attended">Never Attended</SelectItem>
                    <SelectItem value="not_pickup_by_client">Not Picked Up by Client</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date *</Label>
                <Input className="mt-1" type="date" {...form.register("call_date")} />
              </div>
              <div>
                <Label>Time</Label>
                <Input className="mt-1" type="time" {...form.register("call_time")} />
              </div>
            </div>
            <div>
              <Label>Duration</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input type="number" min={0} className="w-20" {...form.register("duration_min")} />
                <span className="text-muted-foreground text-sm">min</span>
                <span className="text-muted-foreground">:</span>
                <Input type="number" min={0} max={59} className="w-20" {...form.register("duration_sec")} />
                <span className="text-muted-foreground text-sm">sec</span>
                <span className="text-xs text-muted-foreground ml-auto">{formatCallDuration(previewSec)}</span>
              </div>
            </div>
            <div>
              <Label>Link to Lead</Label>
              <Select
                value={form.watch("lead_id") || "__none__"}
                onValueChange={(v) => form.setValue("lead_id", v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent
                  container={dialogContentEl}
                  side="bottom"
                  sideOffset={4}
                  align="start"
                  className="max-h-[min(20rem,45vh)] w-[var(--radix-select-trigger-width)]"
                >
                  <SelectItem value="__none__">None</SelectItem>
                  {leads.map((l: { id: string; name?: string; email?: string; phone?: string }) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name || l.email || l.phone || l.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedLead ? (
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  <span className="font-medium text-foreground/80">From lead:</span>{" "}
                  {[selectedLead.name, selectedLead.phone].filter(Boolean).join(" · ") ||
                    selectedLead.email ||
                    "—"}
                </p>
              ) : null}
            </div>
            <div>
              <Label>Lead Status</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5 mb-1">
                Shown on the Call Log table; updates the linked lead’s CRM pipeline when you save.
              </p>
              <Select
                value={form.watch("lead_pipeline_status") || undefined}
                onValueChange={(v) => form.setValue("lead_pipeline_status", v)}
                disabled={!watchedLeadId}
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue placeholder={watchedLeadId ? "Select status" : "Choose a lead first"} />
                </SelectTrigger>
                <SelectContent
                  container={dialogContentEl}
                  side="bottom"
                  sideOffset={4}
                  align="start"
                  className="max-h-[min(18rem,40vh)] w-[var(--radix-select-trigger-width)]"
                >
                  {LEAD_PIPELINE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                  {selectedLead?.status === "considering" && (
                    <SelectItem value="considering">Considering</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea className="mt-1" rows={3} {...form.register("notes")} />
            </div>
            <div>
              <Label>Recording / attachment</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1">Optional audio or PDF (max 30MB).</p>
              <Input
                className="mt-1 cursor-pointer"
                type="file"
                accept="audio/*,.pdf,application/pdf"
                onChange={(e) => setRecordingFile(e.target.files?.[0] ?? null)}
              />
              {recordingFile ? (
                <p className="text-xs text-muted-foreground mt-1 truncate" title={recordingFile.name}>
                  Selected: {recordingFile.name}
                </p>
              ) : null}
              {editLog?.attachment_path ? (
                <p className="text-xs mt-2">
                  Current file:{" "}
                  <button
                    type="button"
                    className="text-teal-600 hover:underline bg-transparent border-0 p-0 cursor-pointer"
                    onClick={() => {
                      void openProtectedUpload(editLog.attachment_path).catch(() => {});
                    }}
                  >
                    Open
                  </button>
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border/60 pt-4 mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={addMut.isPending || updMut.isPending}>
              {editLog ? "Save" : "Log Call"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
