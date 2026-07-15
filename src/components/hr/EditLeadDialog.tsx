import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import ResumeUploadBox from "@/components/hr/ResumeUploadBox";
import { useUpdateLead } from "@/hooks/useHRLeads";
import { useToast } from "@/hooks/use-toast";
import { openProtectedUpload } from "@/lib/resumeHref";
import type { HRLead } from "@/types/hrLeads";

const ALLOWED_RESUME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

const resumeSchema = z
  .custom<File | undefined>((v) => v === undefined || v instanceof File)
  .optional()
  .refine((f) => !f || f.size <= 5 * 1024 * 1024, { message: "Max 5MB" })
  .refine((f) => !f || ALLOWED_RESUME_TYPES.includes(f.type as (typeof ALLOWED_RESUME_TYPES)[number]), {
    message: "PDF or Word only",
  });

const schema = z.object({
  id: z.number(),
  full_name: z.string().min(2, "Name required"),
  phone: z.string().min(10, "Valid phone required"),
  email: z.string().email().optional().or(z.literal("")),
  source: z.string().optional(),
  status: z.enum(["new", "contacted", "interested", "not_interested", "converted", "lost"]),
  priority: z.enum(["low", "medium", "high"]),
  notes: z.string().optional(),
  follow_up_date: z.string().optional(),
  resume: resumeSchema,
});

type FormData = z.infer<typeof schema>;

export default function EditLeadDialog({
  open,
  onOpenChange,
  lead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: HRLead | null;
}) {
  const { toast } = useToast();
  const mutation = useUpdateLead();
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      id: 0,
      full_name: "",
      phone: "",
      email: "",
      source: "Online",
      status: "new",
      priority: "medium",
      notes: "",
      follow_up_date: "",
      resume: undefined,
    },
  });

  useEffect(() => {
    if (!lead) return;
    form.reset({
      id: lead.id,
      full_name: lead.full_name,
      phone: lead.phone,
      email: lead.email || "",
      source: lead.source || "Online",
      status: lead.status,
      priority: lead.priority,
      notes: lead.notes || "",
      follow_up_date: lead.follow_up_date || "",
      resume: undefined,
    });
  }, [lead, form]);

  const submit = form.handleSubmit(async (values) => {
    if (!lead) return;
    const { resume, ...rest } = values;
    if (resume instanceof File) {
      await mutation.mutateAsync({ ...rest, id: lead.id, resume });
    } else {
      await mutation.mutateAsync({ ...rest, id: lead.id });
    }
    toast({ title: "Lead updated successfully" });
    onOpenChange(false);
  });

  const hasResume = Boolean(lead?.resume_path);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Lead</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="edit-full-name">Full Name</Label>
            <Input id="edit-full-name" {...form.register("full_name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-phone">Phone</Label>
            <Input id="edit-phone" inputMode="tel" {...form.register("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-email">Email</Label>
            <Input id="edit-email" type="email" {...form.register("email")} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Source</Label>
            <Select value={form.watch("source")} onValueChange={(v) => form.setValue("source", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Walk-in">Walk-in</SelectItem>
                <SelectItem value="Referral">Referral</SelectItem>
                <SelectItem value="Online">Online</SelectItem>
                <SelectItem value="Cold Call">Cold Call</SelectItem>
                <SelectItem value="Social Media">Social Media</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={form.watch("status")} onValueChange={(v: any) => form.setValue("status", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="contacted">Contacted</SelectItem>
                <SelectItem value="interested">Interested</SelectItem>
                <SelectItem value="not_interested">Not Interested</SelectItem>
                <SelectItem value="converted">Enroll</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={form.watch("priority")} onValueChange={(v: any) => form.setValue("priority", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="edit-follow-up">Follow Up Date</Label>
            <Input id="edit-follow-up" type="date" {...form.register("follow_up_date")} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea id="edit-notes" {...form.register("notes")} rows={3} className="min-h-[80px] resize-y" />
          </div>
          {hasResume ? (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Current resume:{" "}
              <button
                type="button"
                className="text-teal-600 underline bg-transparent border-0 p-0 cursor-pointer"
                onClick={() => {
                  void openProtectedUpload(lead?.resume_path).catch(() => {});
                }}
              >
                View
              </button>
            </p>
          ) : null}
          <Controller
            name="resume"
            control={form.control}
            render={({ field }) => (
              <ResumeUploadBox
                className="sm:col-span-2 w-full min-w-0"
                value={field.value}
                onChange={field.onChange}
                error={form.formState.errors.resume?.message}
              />
            )}
          />
          <DialogFooter className="sm:col-span-2 w-full pt-1">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Update Lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
