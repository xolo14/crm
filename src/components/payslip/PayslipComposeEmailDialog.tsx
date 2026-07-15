import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Send } from 'lucide-react';

import { api } from '@/lib/api';
import { buildDefaultPayslipEmailDraft, type PayslipEmailDraft } from '@/lib/payslipEmail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { Employee, Payslip } from '@/types/payslip';
import { buildPayslipPdfBase64 } from '@/utils/payslipExporter';

interface PayslipComposeEmailDialogProps {
  payslip: Payslip | null;
  employees: Employee[];
  printRef: RefObject<HTMLDivElement>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
}

export function PayslipComposeEmailDialog({
  payslip,
  employees,
  printRef,
  open,
  onOpenChange,
  onSent,
}: PayslipComposeEmailDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PayslipEmailDraft>({
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
    attachmentName: '',
  });
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open || !payslip) return;
    const emp = employees.find((e) => e.id === payslip.employeeId);
    const toEmail = emp?.email?.trim() ?? '';
    setDraft(buildDefaultPayslipEmailDraft(payslip, toEmail));
  }, [open, payslip, employees]);

  const handleSend = async () => {
    if (!payslip) return;
    if (!draft.to.trim() || !draft.subject.trim() || !draft.body.trim()) {
      toast({
        variant: 'destructive',
        title: 'Missing email fields',
        description: 'To, subject and body are required.',
      });
      return;
    }
    setSending(true);
    try {
      const pdfBase64 = await buildPayslipPdfBase64(printRef);
      await api.payslip.slips.sendEmail({
        id: payslip.id,
        to: draft.to.trim(),
        cc: draft.cc.trim() || undefined,
        bcc: draft.bcc.trim() || undefined,
        subject: draft.subject.trim(),
        body: draft.body.trim(),
        pdfBase64,
        fileName: draft.attachmentName || `${payslip.id}.pdf`,
      });
      void queryClient.invalidateQueries({ queryKey: ['payslips'] });
      onOpenChange(false);
      onSent?.();
      toast({
        title: 'Payslip email sent',
        description: `Sent to ${draft.to.trim()} from hr@syncpedia.in`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unable to send payslip email.';
      toast({ variant: 'destructive', title: 'Email failed', description: msg });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90dvh,100%)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compose Email</DialogTitle>
          <p className="text-sm text-muted-foreground">Resend the payslip PDF to the employee.</p>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
          <Card>
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm">Compose Email</CardTitle>
              <CardDescription className="text-xs">Edit before sending.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4">
              <div>
                <Label className="text-xs">To</Label>
                <Input
                  value={draft.to}
                  onChange={(e) => setDraft((p) => ({ ...p, to: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">CC (optional)</Label>
                  <Input
                    value={draft.cc}
                    onChange={(e) => setDraft((p) => ({ ...p, cc: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">BCC (optional)</Label>
                  <Input
                    value={draft.bcc}
                    onChange={(e) => setDraft((p) => ({ ...p, bcc: e.target.value }))}
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Subject</Label>
                <Input
                  value={draft.subject}
                  onChange={(e) => setDraft((p) => ({ ...p, subject: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Body</Label>
                <Textarea
                  rows={10}
                  value={draft.body}
                  onChange={(e) => setDraft((p) => ({ ...p, body: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <Badge variant="outline" className="text-[11px]">
                PDF · {draft.attachmentName || 'Payslip.pdf'}
              </Badge>
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm">Email Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4 pb-4 text-xs">
              <div>
                <span className="text-muted-foreground">From:</span> hr@syncpedia.in
              </div>
              <div>
                <span className="text-muted-foreground">To:</span> {draft.to || '—'}
              </div>
              {payslip && (
                <div>
                  <span className="text-muted-foreground">Payslip:</span> {payslip.id}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" className="rounded-lg border-gray-200" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="rounded-lg bg-[#2ed573] font-semibold text-[#0f2318] hover:bg-[#26c968]"
            disabled={sending || !payslip}
            onClick={() => void handleSend()}
          >
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {sending ? 'Sending…' : 'Send Payslip Mail'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
