import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrLeadsApi } from "@/services/hrLeads";
import { getCurrentWeekKeyIST } from "@/lib/hrLeadsWeek";
import type { AdminHRLeadQueryParams, HRLeadQueryParams } from "@/types/hrLeads";

export const useMyLeads = (params: HRLeadQueryParams) =>
  useQuery({
    queryKey: ["hrLeads", "my", getCurrentWeekKeyIST(), params],
    queryFn: () => hrLeadsApi.getMyLeads(params),
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: true,
  });

export const useAssignedLeads = (params: HRLeadQueryParams) =>
  useQuery({
    queryKey: ["hrLeads", "assigned", params],
    queryFn: () => hrLeadsApi.getAssigned(params),
  });

export const useAllHRLeads = (params: AdminHRLeadQueryParams) =>
  useQuery({
    queryKey: ["hrLeads", "all", params],
    queryFn: () => hrLeadsApi.getAllLeads(params),
  });

export const useHRLeadStats = (orgId?: string) =>
  useQuery({
    queryKey: ["hrLeads", "stats", orgId || "all"],
    queryFn: () => hrLeadsApi.getStats(orgId),
  });

export const useHRLeadDetail = (id?: number) =>
  useQuery({
    queryKey: ["hrLeads", "detail", id],
    queryFn: () => hrLeadsApi.getLead(id as number),
    enabled: !!id,
  });

export const useAddLead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: hrLeadsApi.addLead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "my"] });
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "all"] });
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["hr", "dashboard"] });
    },
  });
};

export const useUpdateLead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: hrLeadsApi.updateLead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "my"] });
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "assigned"] });
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "all"] });
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["hr", "dashboard"] });
    },
  });
};

export const useDeleteLead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: hrLeadsApi.deleteLead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "my"] });
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "all"] });
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["hr", "dashboard"] });
    },
  });
};

export const useAssignLead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hr_id }: { id: number; hr_id: string }) => hrLeadsApi.assignLead(id, hr_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "all"] });
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "assigned"] });
    },
  });
};

export const useBulkAssignLeads = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignments: Array<{ id: number; hr_id: string }>) => hrLeadsApi.bulkAssignLeads(assignments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "all"] });
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["hrLeads", "assigned"] });
    },
  });
};
