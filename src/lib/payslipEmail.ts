import type { Payslip } from '@/types/payslip';

export interface PayslipEmailDraft {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  attachmentName: string;
}

export function buildDefaultPayslipEmailDraft(payslip: Payslip, toEmail: string): PayslipEmailDraft {
  const monthLabel = payslip.monthLabel || payslip.month;
  const attachmentName = `Payslip_${payslip.employeeName.replace(/\s+/g, '_')}_${payslip.id}.pdf`;
  return {
    to: toEmail,
    cc: '',
    bcc: '',
    subject: `Your Payslip is Ready — ${payslip.id}`,
    body: `Dear ${payslip.employeeName},

We are pleased to share your payslip${monthLabel ? ` for ${monthLabel}` : ''}.

Please find the attached payslip (PDF) for your records. Payslip reference: ${payslip.id}

If you have any questions regarding your salary or deductions, please reply to this email.

Warm regards,
Syncpedia HR`,
    attachmentName,
  };
}
