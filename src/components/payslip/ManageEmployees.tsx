import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Pencil, Trash2, FileText } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Employee } from "@/types/payslip";
import { formatINR } from "@/types/payslip";

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "?";
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

interface ManageEmployeesProps {
  employees: Employee[];
  onEdit: (e: Employee) => void;
  onDelete: (id: string) => void;
  onViewPayslips: (employeeId: string) => void;
  onRequestAdd: () => void;
}

const DEPT_OPTIONS = ["All", "Technology", "Sales", "Operations", "Human Resources", "Finance", "Marketing", "Other"];

export default function ManageEmployees({ employees, onEdit, onDelete, onViewPayslips, onRequestAdd }: ManageEmployeesProps) {
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("All");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (dept !== "All" && e.department !== dept) return false;
      if (!q) return true;
      const blob = `${e.name} ${e.employeeCode} ${e.designation}`.toLowerCase();
      return blob.includes(q);
    });
  }, [employees, search, dept]);

  const empToDelete = employees.find((e) => e.id === deleteId) ?? null;

  return (
    <Card className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <span className="text-xs font-semibold text-gray-500">Search</span>
            <Input
              placeholder="Name, ID, or designation"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 rounded-lg focus-visible:ring-[#2ed573] focus-visible:ring-offset-1"
            />
          </div>
          <div className="w-full md:w-56 space-y-1.5">
            <span className="text-xs font-semibold text-gray-500">Department</span>
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger className="h-10 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEPT_OPTIONS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" className="h-10 rounded-lg bg-[#2ed573] font-semibold text-[#0f2318] md:ml-auto" onClick={onRequestAdd}>
            + Add Employee
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((e) => (
            <div key={e.id} className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e6faf0] text-sm font-bold text-[#0f5230]">
                  {initials(e.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-bold text-[#0f2318]">{e.name}</h3>
                    <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                      {e.employeeCode}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-600">
                    {e.designation} · {e.department}
                  </p>
                </div>
              </div>
              <div className="mt-3 space-y-1.5 text-xs text-gray-600">
                <div className="truncate">
                  <span className="font-medium text-gray-500">Email:</span> {e.email}
                </div>
                <div>
                  <span className="font-medium text-gray-500">Phone:</span> {e.phone}
                </div>
                <div className="font-semibold text-[#0f2318]">
                  CTC: ₹ {formatINR(e.ctc)} <span className="font-normal text-gray-500">per annum</span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Badge className={e.pfApplicable ? "bg-[#2ed573] text-[#0f2318]" : "bg-gray-100 text-gray-600"}>
                    PF: {e.pfApplicable ? "On" : "Off"}
                  </Badge>
                  <Badge className={e.ptApplicable ? "bg-[#2ed573] text-[#0f2318]" : "bg-gray-100 text-gray-600"}>
                    PT: {e.ptApplicable ? "On" : "Off"}
                  </Badge>
                </div>
                <div className="text-gray-500">
                  Joined:{" "}
                  <span className="font-medium text-gray-800">
                    {(() => {
                      try {
                        return format(parseISO(e.joiningDate), "dd MMM yyyy");
                      } catch {
                        return e.joiningDate;
                      }
                    })()}
                  </span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                <Button type="button" size="sm" variant="outline" className="rounded-lg border-gray-200" onClick={() => onEdit(e)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-lg border-gray-200"
                  onClick={() => onViewPayslips(e.id)}
                >
                  <FileText className="mr-1 h-3.5 w-3.5" />
                  View Payslips
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-lg border-red-200 bg-red-50 text-red-600"
                  onClick={() => setDeleteId(e.id)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete employee?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <span className="font-semibold">{empToDelete?.name}</span> ({empToDelete?.employeeCode}) from the directory. Payslip history entries are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-lg bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (deleteId) onDelete(deleteId);
                setDeleteId(null);
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
