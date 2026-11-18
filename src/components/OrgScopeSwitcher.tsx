import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { api } from "@/lib/api";
import { ORG_SCOPE_ALL, useOrgScope } from "@/hooks/useOrgScope";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface OrgOption {
  id: string;
  name: string;
}

/** Organizations visible to a super admin, cached across pages. */
export function useOrgOptions(enabled = true) {
  return useQuery({
    queryKey: ["org_scope_options"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OrgOption[]> => {
      const res = (await api.organizations.list()) as { data?: Array<{ id?: string; name?: string }> };
      const rows = Array.isArray(res?.data) ? res.data : [];
      return rows
        .map((o) => ({ id: String(o.id || "").trim(), name: String(o.name || "Unnamed org").trim() }))
        .filter((o) => o.id !== "")
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/** Header control: which organization every page is looking at (super admin only). */
export function OrgScopeSwitcher({ className }: { className?: string }) {
  const [scope, setScope] = useOrgScope();
  const { data: orgs = [] } = useOrgOptions();
  const known = scope === ORG_SCOPE_ALL || orgs.some((o) => o.id === scope);

  return (
    <Select value={known ? scope : ORG_SCOPE_ALL} onValueChange={setScope}>
      <SelectTrigger
        className={className ?? "h-8 w-[200px] gap-2 rounded-lg text-xs font-medium"}
        aria-label="Organization scope"
      >
        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <SelectValue placeholder="All organizations" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ORG_SCOPE_ALL}>All organizations</SelectItem>
        {orgs.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
