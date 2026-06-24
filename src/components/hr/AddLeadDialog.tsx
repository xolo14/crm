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
import { useAddLead } from "@/hooks/useHRLeads";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

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
  full_name: z.string().min(2, "Name required"),
  phone: z.string().min(10, "Valid phone required"),
  email: z.string().email().optional().or(z.literal("")),
  source: z.string().optional(),
  status: z.enum(["new", "contacted", "interested", "not_interested", "converted", "lost"]),
  priority: z.enum(["low", "medium", "high"]),
  notes: z.string().optional(),
  follow_up_date: z.string().optional(),
  hr_id: z.string().optional(),
  resume: resumeSchema,
});

type FormData = z.infer<typeof schema>;

export default function AddLeadDialog({
  open,
  onOpenChange,
  hrUsers = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hrUsers?: Array<{ id: string; full_name: string }>;
}) {
  const { role } = useAuth();
  const { toast } = useToast();
  const mutation = useAddLead();
  const isAdminMode = role === "admin" || role === "super_admin";
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: "",
      phone: "",
      email: "",
      source: "Online",
      status: "new",
      priority: "medium",
      notes: "",
      follow_up_date: "",
      hr_id: "",
      resume: undefined,
    },
  });

  const submit = form.handleSubmit(async (values) => {
    if (isAdminMode && !values.hr_id) {
      toast({ variant: "destructive", title: "Select HR user" });
      return;
    }
    await mutation.mutateAsync(values);
    toast({ title: "Lead added successfully" });
    onOpenChange(false);
    form.reset();
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="space-y-1 px-6 pt-6 pb-4 text-left">
          <DialogTitle>New Lead</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex w-full min-w-0 flex-col px-6 pb-6">
          <div className="grid w-full min-w-0 grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 sm:items-start">
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="add-full-name">Full Name</Label>
              <Input id="add-full-name" className="w-full" {...form.register("full_name")} />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="add-phone">Phone</Label>
              <Input id="add-phone" className="w-full" inputMode="tel" {...form.register("phone")} />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="add-email">Email</Label>
              <Input id="add-email" className="w-full" type="email" {...form.register("email")} />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
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
            {isAdminMode && hrUsers.length > 0 && (
              <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                <Label>HR User</Label>
                <Select value={form.watch("hr_id") || ""} onValueChange={(v) => form.setValue("hr_id", v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select HR user" />
                  </SelectTrigger>
                  <SelectContent>
                    {hrUsers.map((hr) => (
                      <SelectItem key={hr.id} value={hr.id}>
                        {hr.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-1.5">
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
            <div className="flex min-w-0 flex-col gap-1.5">
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
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="add-follow-up">Follow Up Date</Label>
              <Input id="add-follow-up" className="w-full" type="date" {...form.register("follow_up_date")} />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="add-notes">Notes</Label>
              <Textarea id="add-notes" {...form.register("notes")} rows={3} className="min-h-[80px] w-full resize-y" />
            </div>
            <Controller
              name="resume"
              control={form.control}
              render={({ field }) => (
                <ResumeUploadBox
                  className="w-full min-w-0 sm:col-span-2"
                  value={field.value}
                  onChange={field.onChange}
                  error={form.formState.errors.resume?.message}
                />
              )}
            />
          </div>
          <DialogFooter className="mt-6 w-full flex-shrink-0 border-t border-border pt-4 sm:justify-end">
            <Button type="submit" disabled={mutation.isPending || (isAdminMode && !form.watch("hr_id"))}>
              {mutation.isPending ? "Saving..." : "Add Lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
