import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateTempPassword } from "@/lib/randomPassword";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  department: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function CreateHRDialog({ onSuccess }: { onSuccess?: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: "", email: "", password: generateTempPassword(), phone: "", department: "HR" },
  });

  const mutation = useMutation({
    mutationFn: (payload: FormValues) => api.hr.create(payload),
    onSuccess: (data: { email_sent?: boolean; email_error?: string }) => {
      if (data?.email_sent) {
        toast({ title: "HR account created", description: "Welcome email with login credentials sent from support@syncpedia.in." });
      } else if (data?.email_error) {
        toast({
          variant: "destructive",
          title: "HR account created",
          description: `Email could not be sent: ${data.email_error}`,
        });
      } else {
        toast({ title: "HR account created" });
      }
      queryClient.invalidateQueries({ queryKey: ["hr", "list"] });
      onSuccess?.();
      setOpen(false);
      form.reset();
    },
    onError: (err: any) => toast({ variant: "destructive", title: "Failed", description: err.message }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Create HR</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create HR</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="space-y-3">
          <div><Label>Full Name</Label><Input {...form.register("full_name")} /></div>
          <div><Label>Email</Label><Input type="email" {...form.register("email")} /></div>
          <div><Label>Password</Label><Input type="password" {...form.register("password")} /></div>
          <div><Label>Phone</Label><Input {...form.register("phone")} /></div>
          <div><Label>Department</Label><Input {...form.register("department")} /></div>
          <DialogFooter><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Creating..." : "Create HR"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
