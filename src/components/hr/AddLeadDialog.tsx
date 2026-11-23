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
import type { CreateHRLeadInput, HRLeadStats } from "@/types/hrLeads";
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

/** Local "YYYY-MM-DD" for today (date inputs compare as strings). */
function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const schema = z.object({
  full_name: z.string().trim().min(2, "Enter the candidate's full name"),
  // 10–15 digits; spaces, dashes, brackets and a leading + are allowed.
  phone: z
    .string()
    .trim()
    .refine((v) => /^\+?[\d\s()-]{10,20}$/.test(v) && v.replace(/\D/g, "").length >= 10 && v.replace(/\D/g, "").length <= 15, {
      message: "Enter a valid phone number (10–15 digits)",
    }),
  email: z.string().trim().email("Enter a valid email address").optional().or(z.literal("")),
  source: z.string().optional(),
  status: z.enum(["new", "contacted", "interested", "not_interested", "converted", "lost"]),
  priority: z.enum(["low", "medium", "high"]),
  notes: z.string().optional(),
  follow_up_date: z
    .string()
    .optional()
    .refine((v) => !v || v >= todayIso(), { message: "Follow-up date can't be in the past" }),
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
  const isAdminMode = role === "org" || role === "super_admin";
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
    await mutation.mutateAsync(values as CreateHRLeadInput);
    toast({ title: "Lead added successfully" });
    onOpenChange(false);
    form.reset();
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-xl gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="space-y-1 px-6 pt-6 pb-4 text-left">
          <DialogTitle>New Lead</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex w-full min-w-0 flex-col px-6 pb-6">
          <div className="grid w-full min-w-0 grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 sm:items-start">
            <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="add-full-name">Full Name <span className="text-destructive" aria-hidden>*</span></Label>
              <Input id="add-full-name" className="w-full" required aria-required="true" autoComplete="name" aria-invalid={Boolean(form.formState.errors.full_name)} {...form.register("full_name")} />
              {form.formState.errors.full_name?.message ? (
                <p id="add-full_name-error" role="alert" className="text-xs text-destructive">{form.formState.errors.full_name?.message}</p>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="add-phone">Phone <span className="text-destructive" aria-hidden>*</span></Label>
              <Input id="add-phone" className="w-full" type="tel" inputMode="tel" required aria-required="true" autoComplete="tel" placeholder="+91 98765 43210" aria-invalid={Boolean(form.formState.errors.phone)} {...form.register("phone")} />
              {form.formState.errors.phone?.message ? (
                <p id="add-phone-error" role="alert" className="text-xs text-destructive">{form.formState.errors.phone?.message}</p>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="add-email">Email <span className="text-xs font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="add-email" className="w-full" type="email" autoComplete="email" aria-invalid={Boolean(form.formState.errors.email)} {...form.register("email")} />
              {form.formState.errors.email?.message ? (
                <p id="add-email-error" role="alert" className="text-xs text-destructive">{form.formState.errors.email?.message}</p>
              ) : null}
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
                  <SelectItem value="converted">Converted</SelectItem>
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
              <Input id="add-follow-up" className="w-full" type="date" min={todayIso()} aria-invalid={Boolean(form.formState.errors.follow_up_date)} {...form.register("follow_up_date")} />
              {form.formState.errors.follow_up_date?.message ? (
                <p id="add-follow_up_date-error" role="alert" className="text-xs text-destructive">{form.formState.errors.follow_up_date?.message}</p>
              ) : null}
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
          <p className="mt-4 text-xs text-muted-foreground"><span className="text-destructive">*</span> Required</p>
          <DialogFooter className="mt-3 w-full flex-shrink-0 gap-2 border-t border-border pt-4 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || (isAdminMode && !form.watch("hr_id"))}>
              {mutation.isPending ? "Saving..." : "Add Lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
