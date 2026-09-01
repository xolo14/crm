import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callLogsApi } from "@/services/callLogs";
import type { CallLogPeriod, CallLogsQueryParams, CreateCallLogInput } from "@/types/callLog";

export type AddCallLogPayload = CreateCallLogInput & { recording?: File | null };
export type UpdateCallLogPayload = Partial<CreateCallLogInput> & { id: number; recording?: File | null };

export function useCallLogStats(params: CallLogPeriod | string | CallLogsQueryParams) {
  const key = typeof params === "string" ? { period: params } : params;
  return useQuery({
    queryKey: ["callLogs", "stats", key],
    queryFn: () => callLogsApi.getStats(params),
    select: (d) => d.stats,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    enabled:
      typeof params === "string" ||
      params.period !== "custom" ||
      Boolean(params.date_from || params.date_to),
  });
}

export function useCallLogs(params: CallLogsQueryParams) {
  return useQuery({
    queryKey: ["callLogs", "list", params],
    queryFn: () => callLogsApi.getLogs(params),
    enabled: params.period !== "custom" || Boolean(params.date_from || params.date_to),
  });
}

export function useAddCallLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AddCallLogPayload) => {
      const { recording, ...rest } = body;
      if (recording instanceof File) {
        return callLogsApi.addLogMultipart(rest as CreateCallLogInput, recording);
      }
      return callLogsApi.addLog(rest as CreateCallLogInput);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["callLogs"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dailyReports"] });
    },
  });
}

export function useUpdateCallLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateCallLogPayload) => {
      const { recording, id, ...rest } = body;
      if (recording instanceof File) {
        return callLogsApi.updateLogMultipart({ id, ...rest }, recording);
      }
      return callLogsApi.updateLog({ id, ...rest });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["callLogs"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dailyReports"] });
    },
  });
}

export function useDeleteCallLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => callLogsApi.deleteLog(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["callLogs"] });
      qc.invalidateQueries({ queryKey: ["dailyReports"] });
    },
  });
}
