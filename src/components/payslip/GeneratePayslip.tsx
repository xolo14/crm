import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Printer, Download, Mail, Send } from "lucide-react";
import { api } from "@/lib/api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Employee, Payslip, PayslipStatus } from "@/types/payslip";
import { amountInWords, calculateSalaryComponents, formatINR } from "@/types/payslip";
import { buildDefaultPayslipEmailDraft, type PayslipEmailDraft } from "@/lib/payslipEmail";
import { buildPayslipPdfBase64, exportPayslipPDF, printPayslip } from "@/utils/payslipExporter";
import { generatePayslipID } from "@/utils/payslipIDGenerator";

import PayslipPreview from "./PayslipPreview";
import PayslipPrintTemplate from "./PayslipPrintTemplate";

function currentMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabelFromYm(ym: string): string {
  const [y, m] = ym.split("-").map((x) => Number(x));
  if (!y || !m) return ym;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function buildPayslip(opts: {
  employee: Employee;
  month: string;
  workingDays: number;
  paidDays: number;
  components: ReturnType<typeof calculateSalaryComponents>;
  generatedBy: string;
  status: PayslipStatus;
  id?: string;
}): Payslip {
  const { employee, month, workingDays, paidDays, components, generatedBy, status, id } = opts;
  return {
    id: id ?? generatePayslipID(month),
    employeeId: employee.id,
    employeeName: employee.name,
    employeeCode: employee.employeeCode,
    designation: employee.designation,
    department: employee.department,
    panNumber: employee.panNumber,
    bankName: employee.bankName,
    accountNumber: employee.accountNumber,
    ifscCode: employee.ifscCode,
    month,
    monthLabel: monthLabelFromYm(month),
    components,
    pfApplicable: employee.pfApplicable,
    ptApplicable: employee.ptApplicable,
    workingDays,
    paidDays,
    generatedBy,
    generatedAt: new Date().toISOString(),
    status,
  };
}

interface GeneratePayslipProps {
  employees: Employee[];
  onGenerate: (payslip: Payslip) => void | Promise<void>;
  generatedBy: string;
}

export default function GeneratePayslip({ employees, onGenerate, generatedBy }: GeneratePayslipProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);

  const [employeeId, setEmployeeId] = useState<string>(employees[0]?.id ?? "");
  const [payMonth, setPayMonth] = useState(currentMonth());
  const [workingDays, setWorkingDays] = useState(26);
  const [paidDays, setPaidDays] = useState(26);
  const [tds, setTds] = useState(0);
  const [otherDeductions, setOtherDeductions] = useState(0);

  const [postGenOpen, setPostGenOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<Payslip | null>(null);
  const [emailDraft, setEmailDraft] = useState<PayslipEmailDraft>({
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    attachmentName: "",
  });
  const [sendingMail, setSendingMail] = useState(false);
  const [mailSent, setMailSent] = useState(false);
  const storedPdfForId = useRef<string | null>(null);

  const employee = useMemo(() => employees.find((e) => e.id === employeeId) ?? null, [employees, employeeId]);

  useEffect(() => {
    if (paidDays > workingDays) setPaidDays(workingDays);
  }, [workingDays, paidDays]);

  useEffect(() => {
    if (!postGenOpen || !lastGenerated) return;
    if (storedPdfForId.current === lastGenerated.id) return;
    const slipId = lastGenerated.id;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const pdfBase64 = await buildPayslipPdfBase64(printRef);
          await api.payslip.slips.savePdf({ id: slipId, pdfBase64 });
          storedPdfForId.current = slipId;
        } catch {
          /* non-fatal; user can still send mail which also saves */
        }
      })();
    }, 450);
    return () => window.clearTimeout(t);
  }, [postGenOpen, lastGenerated]);

  const components = useMemo(() => {
    if (!employee) {
      return calculateSalaryComponents(0, 0, 1, false, false, 0, 0);
    }
    return calculateSalaryComponents(employee.ctc, paidDays, workingDays, employee.pfApplicable, employee.ptApplicable, tds, otherDeductions);
  }, [employee, paidDays, workingDays, tds, otherDeductions]);

  const previewPayslip = useMemo(() => {
    if (!employee) return null;
    return buildPayslip({
      employee,
      month: payMonth,
      workingDays,
      paidDays,
      components,
      generatedBy,
      status: "draft",
      id: `SYNC-PAY-${payMonth.replace("-", "")}-PREVIEW`,
    });
  }, [employee, payMonth, workingDays, paidDays, components, generatedBy]);

  const [submitting, setSubmitting] = useState(false);

  const handleSaveDraft = async () => {
    if (!employee) {
      toast({ title: "Select an employee", variant: "destructive" });
      return;
    }
    const slip = buildPayslip({
      employee,
      month: payMonth,
      workingDays,
      paidDays,
      components,
      generatedBy,
      status: "draft",
    });
    setSubmitting(true);
    try {
      await Promise.resolve(onGenerate(slip));
      toast({ title: "Draft saved", description: slip.id });
    } catch {
      /* parent already toasts */
    } finally {
      setSubmitting(false);
    }
  };

  const handleGenerate = async () => {
    if (!employee) {
      toast({ title: "Select an employee", variant: "destructive" });
      return;
    }
    const slip = buildPayslip({
      employee,
      month: payMonth,
      workingDays,
      paidDays,
      components,
      generatedBy,
      status: "generated",
    });
    setSubmitting(true);
    try {
      await Promise.resolve(onGenerate(slip));
      setLastGenerated(slip);
      setMailSent(false);
      setPostGenOpen(true);
      toast({ title: "Payslip generated successfully", description: slip.id });
    } catch {
      /* parent already toasts */
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreview = () => {
    toast({ title: "Preview updated", description: "The live preview reflects your latest inputs." });
  };

  const openComposeMail = () => {
    if (!lastGenerated) return;
    const emp = employees.find((e) => e.id === lastGenerated.employeeId);
    const toEmail = emp?.email?.trim() ?? "";
    if (!toEmail) {
      toast({
        variant: "destructive",
        title: "No employee email",
        description: "Add an email address on the employee record before sending the payslip.",
      });
      return;
    }
    setEmailDraft(buildDefaultPayslipEmailDraft(lastGenerated, toEmail));
    setComposeOpen(true);
  };

  const handleSendPayslipMail = async () => {
    if (!lastGenerated) return;
    if (!emailDraft.to.trim() || !emailDraft.subject.trim() || !emailDraft.body.trim()) {
      toast({
        variant: "destructive",
        title: "Missing email fields",
        description: "To, subject and body are required.",
      });
      return;
    }
    setSendingMail(true);
    try {
      const pdfBase64 = await buildPayslipPdfBase64(printRef);
      await api.payslip.slips.sendEmail({
        id: lastGenerated.id,
        to: emailDraft.to.trim(),
        cc: emailDraft.cc.trim() || undefined,
        bcc: emailDraft.bcc.trim() || undefined,
        subject: emailDraft.subject.trim(),
        body: emailDraft.body.trim(),
        pdfBase64,
        fileName: emailDraft.attachmentName || `${lastGenerated.id}.pdf`,
      });
      setMailSent(true);
      setLastGenerated((prev) => (prev ? { ...prev, status: "sent" } : prev));
      void queryClient.invalidateQueries({ queryKey: ["payslips"] });
      setComposeOpen(false);
      toast({
        title: "Payslip email sent",
        description: `Sent to ${emailDraft.to.trim()} from hr@syncpedia.in`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unable to send payslip email.";
      toast({ variant: "destructive", title: "Email failed", description: msg });
    } finally {
      setSendingMail(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <Card className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-[#0f2318]">Generate Payslip</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Employee */}
          <div className="space-y-3">
            <Label className="text-[#0f2318]">Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="h-11 rounded-lg focus-visible:ring-[#2ed573] focus-visible:ring-offset-1">
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.employeeCode} — {e.name} ({e.designation})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {employee && (
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Employee ID", employee.employeeCode],
                  ["Designation", employee.designation],
                  ["Department", employee.department],
                  ["PAN Number", employee.panNumber],
                  ["Bank Name", employee.bankName],
                  ["Account No", employee.accountNumber],
                  ["IFSC", employee.ifscCode],
                ].map(([k, v]) => (
                  <div key={k as string} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{k}</div>
                    <div className="text-sm font-medium text-gray-900">{v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pay period */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-1">
              <Label htmlFor="pay-month" className="text-[#0f2318]">
                Pay Month
              </Label>
              <Input
                id="pay-month"
                type="month"
                value={payMonth}
                onChange={(e) => setPayMonth(e.target.value)}
                className="h-11 rounded-lg focus-visible:ring-[#2ed573] focus-visible:ring-offset-1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wd" className="text-[#0f2318]">
                Working Days
              </Label>
              <Input
                id="wd"
                type="number"
                min={1}
                value={workingDays}
                onChange={(e) => setWorkingDays(Math.max(1, Number(e.target.value) || 1))}
                className="h-11 rounded-lg focus-visible:ring-[#2ed573] focus-visible:ring-offset-1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pd" className="text-[#0f2318]">
                Paid Days
              </Label>
              <Input
                id="pd"
                type="number"
                min={0}
                max={workingDays}
                value={paidDays}
                onChange={(e) => setPaidDays(Math.min(workingDays, Math.max(0, Number(e.target.value) || 0)))}
                className="h-11 rounded-lg focus-visible:ring-[#2ed573] focus-visible:ring-offset-1"
              />
            </div>
          </div>

          {/* Salary breakdown */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-4 border-l-4 border-l-[#2ed573]">
              <div className="mb-3 text-xs font-bold uppercase tracking-wide text-[#0f2318]">Earnings</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Basic Salary</span>
                  <span className="font-semibold text-gray-900">₹ {formatINR(components.basic)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">HRA</span>
                  <span className="font-semibold text-gray-900">₹ {formatINR(components.hra)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Special Allowance</span>
                  <span className="font-semibold text-gray-900">₹ {formatINR(components.specialAllowance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Other Allowance</span>
                  <span className="font-semibold text-gray-900">₹ {formatINR(components.otherAllowance)}</span>
                </div>
                <div className="my-2 border-t border-gray-200" />
                <div className="flex justify-between text-base font-bold text-[#0f2318]">
                  <span>Gross Earnings</span>
                  <span>₹ {formatINR(components.grossEarnings)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4 border-l-4 border-l-red-400">
              <div className="mb-3 text-xs font-bold uppercase tracking-wide text-[#0f2318]">Deductions</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">PF (Employee 12%)</span>
                  <span className="font-semibold text-gray-900">₹ {formatINR(components.pfEmployee)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Professional Tax</span>
                  <span className="font-semibold text-gray-900">₹ {formatINR(components.professionalTax)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="tds" className="text-gray-600">
                    TDS
                  </Label>
                  <Input
                    id="tds"
                    type="number"
                    min={0}
                    className="h-9 w-32 rounded-lg text-right focus-visible:ring-[#2ed573] focus-visible:ring-offset-1"
                    value={tds}
                    onChange={(e) => setTds(Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="other-ded" className="text-gray-600">
                    Other Deductions
                  </Label>
                  <Input
                    id="other-ded"
                    type="number"
                    min={0}
                    className="h-9 w-32 rounded-lg text-right focus-visible:ring-[#2ed573] focus-visible:ring-offset-1"
                    value={otherDeductions}
                    onChange={(e) => setOtherDeductions(Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>
                <div className="my-2 border-t border-gray-200" />
                <div className="flex justify-between text-base font-bold text-[#0f2318]">
                  <span>Total Deductions</span>
                  <span>₹ {formatINR(components.totalDeductions)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Net pay */}
          <div className="rounded-xl border-2 border-[#2ed573] bg-[#e6faf0] p-4">
            <div className="text-2xl font-extrabold text-[#0f2318]">Net Pay: ₹ {formatINR(components.netPay)}</div>
            <div className="mt-1 text-sm italic text-gray-700">Amount in Words: {amountInWords(components.netPay)}</div>
          </div>

          {/* PF / PT badges */}
          {employee && (
            <div className="flex flex-wrap gap-2">
              <Badge className={employee.pfApplicable ? "bg-[#2ed573] text-[#0f2318]" : "bg-gray-100 text-gray-600"}>
                PF: {employee.pfApplicable ? "Applicable ✓" : "Not Applicable"}
              </Badge>
              <Badge className={employee.ptApplicable ? "bg-[#2ed573] text-[#0f2318]" : "bg-gray-100 text-gray-600"}>
                PT: {employee.ptApplicable ? "Applicable ✓" : "Not Applicable"}
              </Badge>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" className="rounded-lg border-gray-200" onClick={handlePreview} disabled={submitting}>
              Preview
            </Button>
            <Button type="button" variant="outline" className="rounded-lg border-gray-200" onClick={handleSaveDraft} disabled={submitting || !employee}>
              {submitting ? "Saving…" : "Save Draft"}
            </Button>
            <Button
              type="button"
              className="rounded-lg bg-[#2ed573] font-semibold text-[#0f2318] hover:bg-[#26c968]"
              onClick={handleGenerate}
              disabled={submitting || !employee}
            >
              {submitting ? "Generating…" : "Generate Payslip"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div>{previewPayslip ? <PayslipPreview payslip={previewPayslip} /> : <div className="text-sm text-gray-500">Select an employee to preview.</div>}</div>

      <Dialog open={postGenOpen} onOpenChange={setPostGenOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Payslip ready</DialogTitle>
          </DialogHeader>
          {lastGenerated && (
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3">
              <PayslipPrintTemplate ref={printRef} payslip={lastGenerated} isPrintTarget />
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <p className="mr-auto w-full text-xs text-muted-foreground sm:w-auto">
              From: hr@syncpedia.in
              {lastGenerated
                ? ` · To: ${employees.find((e) => e.id === lastGenerated.employeeId)?.email || "—"}`
                : null}
            </p>
            <Button type="button" variant="outline" className="rounded-lg border-gray-200" onClick={() => setPostGenOpen(false)}>
              Close
            </Button>
            <Button type="button" variant="outline" className="rounded-lg border-gray-200" onClick={() => void printPayslip(printRef)}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-lg border-gray-200"
              onClick={() => lastGenerated && void exportPayslipPDF(printRef, lastGenerated.id)}
            >
              <Download className="mr-2 h-4 w-4" />
              Download PDF
            </Button>
            <Button
              type="button"
              className="rounded-lg bg-[#2ed573] font-semibold text-[#0f2318] hover:bg-[#26c968]"
              onClick={openComposeMail}
              disabled={mailSent || !lastGenerated}
            >
              <Mail className="mr-2 h-4 w-4" />
              {mailSent ? "Email Sent" : "Send Mail"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-4xl max-h-[min(90dvh,100%)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Compose Email</DialogTitle>
            <p className="text-sm text-muted-foreground">Edit before sending the payslip email.</p>
          </DialogHeader>

          {mailSent ? (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Payslip email sent!</CardTitle>
                <CardDescription className="text-xs">
                  The payslip PDF was delivered to {emailDraft.to || "the recipient"}.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">Compose Email</CardTitle>
                  <CardDescription className="text-xs">Edit before sending the payslip email.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 px-4 pb-4">
                  <div>
                    <Label className="text-xs">To</Label>
                    <Input
                      value={emailDraft.to}
                      onChange={(e) => setEmailDraft((p) => ({ ...p, to: e.target.value }))}
                      className="mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">CC (optional)</Label>
                      <Input
                        value={emailDraft.cc}
                        onChange={(e) => setEmailDraft((p) => ({ ...p, cc: e.target.value }))}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">BCC (optional)</Label>
                      <Input
                        value={emailDraft.bcc}
                        onChange={(e) => setEmailDraft((p) => ({ ...p, bcc: e.target.value }))}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Subject</Label>
                    <Input
                      value={emailDraft.subject}
                      onChange={(e) => setEmailDraft((p) => ({ ...p, subject: e.target.value }))}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Body</Label>
                    <Textarea
                      rows={10}
                      value={emailDraft.body}
                      onChange={(e) => setEmailDraft((p) => ({ ...p, body: e.target.value }))}
                      className="mt-1"
                    />
                  </div>
                  <Badge variant="outline" className="text-[11px]">
                    PDF · {emailDraft.attachmentName || "Payslip.pdf"}
                  </Badge>
                </CardContent>
              </Card>

              <Card className="h-fit">
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">Email Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 px-4 pb-4 text-xs">
                  <div>
                    <span className="text-muted-foreground">From:</span> hr@syncpedia.in
                  </div>
                  <div>
                    <span className="text-muted-foreground">To:</span> {emailDraft.to || "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Attachment:</span> {emailDraft.attachmentName || "—"}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" className="rounded-lg border-gray-200" onClick={() => setComposeOpen(false)}>
              Back
            </Button>
            {!mailSent ? (
              <Button
                type="button"
                className="rounded-lg bg-[#2ed573] font-semibold text-[#0f2318] hover:bg-[#26c968]"
                onClick={() => void handleSendPayslipMail()}
                disabled={sendingMail}
              >
                <Send className="mr-2 h-4 w-4" />
                {sendingMail ? "Sending email with payslip…" : "Send Payslip Mail"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
