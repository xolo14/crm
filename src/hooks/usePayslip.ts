import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Employee, Payslip, PayslipStatus } from "@/types/payslip";

// ── Employees ───────────────────────────────────────────────────────────────
export const employeesQueryKey = (orgId?: string) => ["payslip-employees", orgId ?? "self"] as const;

export function usePayslipEmployees(orgId?: string) {
  return useQuery({
    queryKey: employeesQueryKey(orgId),
    queryFn: async () => {
      const res = await api.payslip.employees.list(orgId);
      return (res?.data ?? []) as Employee[];
    },
    staleTime: 60_000,
  });
}

export function useCreatePayslipEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Employee>) => {
      const res = await api.payslip.employees.create(payload as Record<string, unknown>);
      return res?.data as Employee;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslip-employees"] });
    },
  });
}

export function useUpdatePayslipEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Employee> }) => {
      const res = await api.payslip.employees.update(id, patch as Record<string, unknown>);
      return res?.data as Employee;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslip-employees"] });
    },
  });
}

export function useDeletePayslipEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.payslip.employees.delete(id);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslip-employees"] });
      qc.invalidateQueries({ queryKey: ["payslips"] });
    },
  });
}

// ── Payslips ────────────────────────────────────────────────────────────────
export const payslipsQueryKey = (filters?: { employeeId?: string; month?: string; status?: string; orgId?: string }) =>
  ["payslips", filters ?? {}] as const;

export function usePayslips(filters?: { employeeId?: string; month?: string; status?: string; orgId?: string }) {
  return useQuery({
    queryKey: payslipsQueryKey(filters),
    queryFn: async () => {
      const res = await api.payslip.slips.list(filters);
      return (res?.data ?? []) as Payslip[];
    },
    staleTime: 30_000,
  });
}

export function useCreatePayslip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Payslip) => {
      const res = await api.payslip.slips.create(payload as unknown as Record<string, unknown>);
      return res?.data as Payslip;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslips"] });
    },
  });
}

export function useUpdatePayslipStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PayslipStatus }) => {
      await api.payslip.slips.updateStatus(id, status);
      return { id, status };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslips"] });
    },
  });
}

export function useDeletePayslip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.payslip.slips.delete(id);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payslips"] });
    },
  });
}
