import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import {
  canManageFresherSalaryRoster,
  canAccessFresherSalary,
} from "@/lib/orgAccess";
import { normalizeAppRole } from "@/lib/roleUtils";
import { FEATURE_FRESHER_SALARY, isOrgFeatureEnabled } from "@/lib/orgFeatures";

/**
 * Fresher Salary visibility:
 * - Org admins: always (when feature on)
 * - Sales reps / managers: only if enrolled (added on the tracker)
 */
export function useFresherSalaryAccess() {
  const { user, role, organization } = useAuth();
  const r = normalizeAppRole(role);
  const featureOn = isOrgFeatureEnabled(role, organization, FEATURE_FRESHER_SALARY);
  const canManage = canManageFresherSalaryRoster(role);
  const traineeRole = r === "sales_representative" || r === "manager";

  const enrolledQuery = useQuery({
    queryKey: ["fresher-salary-enrolled", user?.id, organization?.id],
    queryFn: async () => {
      const p = await api.fresherSalary.myProgress();
      return Boolean(p?.enrolled);
    },
    enabled: Boolean(user?.id && featureOn && traineeRole && !canManage),
    staleTime: 60_000,
    retry: 1,
  });

  if (!featureOn || !canAccessFresherSalary(role, organization, user?.page_access)) {
    return { loading: false, allowed: false, canManage: false, enrolled: false as boolean };
  }

  if (canManage) {
    return { loading: false, allowed: true, canManage: true, enrolled: true as boolean };
  }

  if (!traineeRole) {
    return { loading: false, allowed: false, canManage: false, enrolled: false as boolean };
  }

  const enrolled = Boolean(enrolledQuery.data);
  const loading = enrolledQuery.isPending;

  return {
    loading,
    allowed: enrolled,
    canManage: false,
    enrolled,
  };
}
