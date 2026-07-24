import { useMemo, useState } from "react";
import { Lock, Plus, Loader2 } from "lucide-react";

import AddEmployeeModal from "@/components/payslip/AddEmployeeModal";
import GeneratePayslip from "@/components/payslip/GeneratePayslip";
import ManageEmployees from "@/components/payslip/ManageEmployees";
import PayslipHistory from "@/components/payslip/PayslipHistory";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  useCreatePayslip,
  useCreatePayslipEmployee,
  useDeletePayslip,
  useDeletePayslipEmployee,
  usePayslipEmployees,
  usePayslips,
  useUpdatePayslipEmployee,
} from "@/hooks/usePayslip";
import type { Employee, Payslip } from "@/types/payslip";

type PayslipTab = "generate" | "history" | "employees";

function AccessDenied() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
        <Lock className="h-7 w-7 text-gray-500" />
      </div>
      <h1 className="text-lg font-bold text-[#0f2318]">Access denied</h1>
      <p className="mt-2 max-w-sm text-sm text-gray-600">You don&apos;t have permission to view this page.</p>
    </div>
  );
}

export default function PayslipPage() {
  const { role, profile } = useAuth();
  const { toast } = useToast();

  const normalizedRole = (() => {
    const r = String(role || "").toLowerCase();
    if (r === "superadmin") return "super_admin";
    if (r === "organisation") return "org";
    return r;
  })();
  const canAccess = normalizedRole === "super_admin" || normalizedRole === "admin" || normalizedRole === "org";

  const employeesQ = usePayslipEmployees();
  const payslipsQ = usePayslips();

  const createEmpMut = useCreatePayslipEmployee();
  const updateEmpMut = useUpdatePayslipEmployee();
  const deleteEmpMut = useDeletePayslipEmployee();
  const createSlipMut = useCreatePayslip();
  const deleteSlipMut = useDeletePayslip();

  const employees: Employee[] = employeesQ.data ?? [];
  const payslips: Payslip[] = payslipsQ.data ?? [];

  const [activeTab, setActiveTab] = useState<PayslipTab>("generate");
  const [addEmpOpen, setAddEmpOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [historyEmployeeId, setHistoryEmployeeId] = useState<string | null>(null);

  const generatedBy = useMemo(() => profile?.full_name || profile?.email || "Administrator", [profile]);

  const handlePayslipCreated = async (p: Payslip) => {
    try {
      await createSlipMut.mutateAsync(p);
    } catch (err) {
      toast({
        title: "Could not save payslip",
        description: err instanceof Error ? err.message : "Server rejected the request",
        variant: "destructive",
      });
      throw err;
    }
  };

  const handleDeletePayslip = (id: string) => {
    deleteSlipMut.mutate(id, {
      onError: (err) =>
        toast({
          title: "Could not delete payslip",
          description: err instanceof Error ? err.message : "Server rejected the request",
          variant: "destructive",
        }),
    });
  };

  const handleSaveEmployee = async (e: Employee) => {
    const isNew = !employees.some((x) => x.id === e.id);
    try {
      if (isNew) {
        await createEmpMut.mutateAsync(e);
      } else {
        await updateEmpMut.mutateAsync({ id: e.id, patch: e });
      }
    } catch (err) {
      toast({
        title: isNew ? "Could not add employee" : "Could not update employee",
        description: err instanceof Error ? err.message : "Server rejected the request",
        variant: "destructive",
      });
      throw err;
    }
  };

  const handleDeleteEmployee = (id: string) => {
    deleteEmpMut.mutate(id, {
      onError: (err) =>
        toast({
          title: "Could not delete employee",
          description: err instanceof Error ? err.message : "Server rejected the request",
          variant: "destructive",
        }),
    });
  };

  if (!canAccess) {
    return (
      <div className="min-h-[calc(100dvh-8rem)] bg-[#f9fafb]">
        <AccessDenied />
      </div>
    );
  }

  const isLoading = employeesQ.isLoading || payslipsQ.isLoading;

  return (
    <div className="space-y-6 bg-[#f9fafb] pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0f2318] md:text-3xl">Payslip Generator</h1>
          <p className="mt-1 text-sm text-gray-600">Generate and manage employee payslips</p>
        </div>
        <Button
          type="button"
          className="h-11 shrink-0 rounded-lg bg-[#2ed573] font-semibold text-[#0f2318] hover:bg-[#26c968]"
          onClick={() => {
            setEditingEmp(null);
            setAddEmpOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Employee
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin text-[#2ed573]" />
          Loading payslip data…
        </div>
      ) : null}

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          const t = v as PayslipTab;
          setActiveTab(t);
          if (t !== "history") setHistoryEmployeeId(null);
        }}
        className="w-full"
      >
        <TabsList className="grid h-auto w-full max-w-2xl grid-cols-3 rounded-xl bg-white p-1 shadow-sm ring-1 ring-gray-200">
          <TabsTrigger value="generate" className="rounded-lg data-[state=active]:bg-[#0f2318] data-[state=active]:text-white">
            Generate
          </TabsTrigger>
          <TabsTrigger value="history" className="rounded-lg data-[state=active]:bg-[#0f2318] data-[state=active]:text-white">
            History
          </TabsTrigger>
          <TabsTrigger value="employees" className="rounded-lg data-[state=active]:bg-[#0f2318] data-[state=active]:text-white">
            Employees
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="mt-6 focus-visible:outline-none">
          <GeneratePayslip employees={employees} onGenerate={handlePayslipCreated} generatedBy={generatedBy} />
        </TabsContent>

        <TabsContent value="history" className="mt-6 focus-visible:outline-none">
          <PayslipHistory
            payslips={payslips}
            employees={employees}
            onDelete={handleDeletePayslip}
            highlightEmployeeId={historyEmployeeId}
            onGoToGenerate={() => setActiveTab("generate")}
          />
        </TabsContent>

        <TabsContent value="employees" className="mt-6 focus-visible:outline-none">
          <ManageEmployees
            employees={employees}
            onEdit={(e) => {
              setEditingEmp(e);
              setAddEmpOpen(true);
            }}
            onDelete={handleDeleteEmployee}
            onViewPayslips={(employeeId) => {
              setHistoryEmployeeId(employeeId);
              setActiveTab("history");
            }}
            onRequestAdd={() => {
              setEditingEmp(null);
              setAddEmpOpen(true);
            }}
          />
        </TabsContent>
      </Tabs>

      <AddEmployeeModal
        open={addEmpOpen}
        employee={editingEmp}
        existingEmployees={employees}
        onSave={handleSaveEmployee}
        onClose={() => {
          setAddEmpOpen(false);
          setEditingEmp(null);
        }}
      />
    </div>
  );
}
