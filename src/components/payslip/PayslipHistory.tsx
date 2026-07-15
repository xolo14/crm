import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Mail, Printer, Trash2, Eye } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import type { Employee, Payslip, PayslipStatus } from "@/types/payslip";
import { formatINR } from "@/types/payslip";
import { exportPayslipPDF, printPayslip } from "@/utils/payslipExporter";
import { parsePayslipID } from "@/utils/payslipIDGenerator";

import PayslipPrintTemplate from "./PayslipPrintTemplate";
import { PayslipComposeEmailDialog } from "./PayslipComposeEmailDialog";

const ID_SEGMENTS = [
  { key: "prefix" as const, className: "bg-[#e6faf0] text-[#0f5230]" },
  { key: "type" as const, className: "bg-[#e6f0fb] text-[#0c447c]" },
  { key: "period" as const, className: "bg-[#faeeda] text-[#633806]" },
  { key: "suffix" as const, className: "bg-[#eeedfe] text-[#3c3489]" },
];

function PayslipIdCell({ id, onCopy }: { id: string; onCopy: () => void }) {
  const parts = parsePayslipID(id);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(id);
            onCopy();
          }}
          className="inline-flex flex-wrap items-center gap-0.5 rounded-md text-left font-mono text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2ed573] focus-visible:ring-offset-1"
        >
          {parts ? (
            ID_SEGMENTS.map((seg) => (
              <span key={seg.key} className={`rounded px-1.5 py-0.5 ${seg.className}`}>
                {parts[seg.key]}
              </span>
            ))
          ) : (
            <span>{id}</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Click to copy</TooltipContent>
    </Tooltip>
  );
}

function statusBadge(status: PayslipStatus) {
  if (status === "draft") return <Badge variant="secondary">Draft</Badge>;
  if (status === "generated") return <Badge className="bg-[#2ed573] font-semibold text-[#0f2318]">Generated</Badge>;
  return <Badge className="bg-blue-600 text-white hover:bg-blue-600">Sent</Badge>;
}

interface PayslipHistoryProps {
  payslips: Payslip[];
  employees: Employee[];
  onDelete: (id: string) => void;
  highlightEmployeeId?: string | null;
  onGoToGenerate: () => void;
}

export default function PayslipHistory({
  payslips,
  employees,
  onDelete,
  highlightEmployeeId,
  onGoToGenerate,
}: PayslipHistoryProps) {
  const { toast } = useToast();
  const viewRef = useRef<HTMLDivElement>(null);

  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [employeeId, setEmployeeId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");

  const [viewOpen, setViewOpen] = useState(false);
  const [viewing, setViewing] = useState<Payslip | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Payslip | null>(null);
  const [afterOpenAction, setAfterOpenAction] = useState<null | "print" | "pdf">(null);
  const [composeOpen, setComposeOpen] = useState(false);

  useEffect(() => {
    if (highlightEmployeeId) {
      setEmployeeId(highlightEmployeeId);
    }
  }, [highlightEmployeeId]);

  useEffect(() => {
    if (!viewOpen || !viewing || !afterOpenAction) return;
    const t = window.setTimeout(() => {
      if (afterOpenAction === "print") void printPayslip(viewRef);
      if (afterOpenAction === "pdf") void exportPayslipPDF(viewRef, viewing.id);
      setAfterOpenAction(null);
    }, 400);
    return () => window.clearTimeout(t);
  }, [viewOpen, viewing, afterOpenAction]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payslips.filter((p) => {
      if (q && !p.employeeName.toLowerCase().includes(q) && !p.id.toLowerCase().includes(q)) return false;
      if (month && p.month !== month) return false;
      if (employeeId !== "all" && p.employeeId !== employeeId) return false;
      if (status !== "all" && p.status !== status) return false;
      return true;
    });
  }, [payslips, search, month, employeeId, status]);

  const openResendMail = () => {
    if (!viewing) return;
    const emp = employees.find((e) => e.id === viewing.employeeId);
    if (!emp?.email?.trim()) {
      toast({
        variant: "destructive",
        title: "No employee email",
        description: "Add an email address on the employee record before resending the payslip.",
      });
      return;
    }
    setComposeOpen(true);
  };

  const exportCsv = () => {
    const header = ["Payslip ID", "Employee", "Month", "Gross", "Deductions", "Net Pay", "Status"];
    const rows = filtered.map((p) => [
      p.id,
      p.employeeName,
      p.monthLabel,
      String(p.components.grossEarnings),
      String(p.components.totalDeductions),
      String(p.components.netPay),
      p.status,
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payslip-history.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: "payslip-history.csv" });
  };

  return (
    <Card className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <span className="text-xs font-semibold text-gray-500">Search</span>
            <Input
              placeholder="Name or Payslip ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 rounded-lg focus-visible:ring-[#2ed573] focus-visible:ring-offset-1"
            />
          </div>
          <div className="w-44 space-y-1.5">
            <span className="text-xs font-semibold text-gray-500">Month</span>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 rounded-lg" />
          </div>
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <span className="text-xs font-semibold text-gray-500">Employee</span>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="h-10 rounded-lg">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40 space-y-1.5">
            <span className="text-xs font-semibold text-gray-500">Status</span>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-10 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="generated">Generated</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" className="h-10 rounded-lg border-gray-200" onClick={exportCsv}>
            Export CSV
          </Button>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-[#f9fafb] py-16 text-center">
            <p className="text-sm font-medium text-gray-600">No payslips generated yet</p>
            <Button type="button" className="mt-4 rounded-lg bg-[#2ed573] font-semibold text-[#0f2318]" onClick={onGoToGenerate}>
              Generate First Payslip
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead>Payslip ID</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">Net Pay</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="align-top">
                      <PayslipIdCell
                        id={p.id}
                        onCopy={() => toast({ title: "Copied!", description: p.id })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{p.employeeName}</TableCell>
                    <TableCell className="text-gray-600">{p.monthLabel}</TableCell>
                    <TableCell className="text-right">₹ {formatINR(p.components.grossEarnings)}</TableCell>
                    <TableCell className="text-right">₹ {formatINR(p.components.totalDeductions)}</TableCell>
                    <TableCell className="text-right font-bold text-[#0f5230]">₹ {formatINR(p.components.netPay)}</TableCell>
                    <TableCell>{statusBadge(p.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg border-gray-200 px-2"
                          onClick={() => {
                            setAfterOpenAction(null);
                            setViewing(p);
                            setViewOpen(true);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg border-gray-200 px-2"
                          onClick={() => {
                            setViewing(p);
                            setAfterOpenAction("print");
                            setViewOpen(true);
                          }}
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg border-gray-200 px-2"
                          onClick={() => {
                            setViewing(p);
                            setAfterOpenAction("pdf");
                            setViewOpen(true);
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg border-red-200 bg-red-50 px-2 text-red-600"
                          onClick={() => setDeleteTarget(p)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={viewOpen} onOpenChange={(o) => {
        setViewOpen(o);
        if (!o) {
          setViewing(null);
          setAfterOpenAction(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[min(90dvh,100%)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>View Payslip</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <PayslipPrintTemplate ref={viewRef} payslip={viewing} isPrintTarget />
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="rounded-lg border-gray-200" onClick={() => void printPayslip(viewRef)}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <Button
              type="button"
              className="rounded-lg bg-[#2ed573] font-semibold text-[#0f2318]"
              onClick={() => viewing && void exportPayslipPDF(viewRef, viewing.id)}
            >
              <Download className="mr-2 h-4 w-4" />
              PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-lg border-[#2ed573]/50 text-[#0f2318] hover:bg-[#2ed573]/10"
              onClick={openResendMail}
              disabled={!viewing}
            >
              <Mail className="mr-2 h-4 w-4" />
              Resend Mail
            </Button>
            <Button type="button" variant="outline" className="rounded-lg border-gray-200" onClick={() => setViewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PayslipComposeEmailDialog
        payslip={viewing}
        employees={employees}
        printRef={viewRef}
        open={composeOpen}
        onOpenChange={setComposeOpen}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete payslip?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <span className="font-mono font-semibold">{deleteTarget?.id}</span> from your local history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-lg bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (deleteTarget) onDelete(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
