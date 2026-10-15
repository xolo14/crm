import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { isSyncpediaOrganization } from "@/lib/orgFeatures";
import { normalizeAppRole } from "@/lib/roleUtils";
import { GitCompareArrows, Loader2 } from "lucide-react";

export type LmsMatchResource = "courses" | "batches";

type MatchRow = {
  lms_id?: string;
  lms_name?: string;
  name?: string;
  crm_id?: string;
  crm_name?: string;
  lms_course_name?: string;
  crm_course_name?: string;
  course_name?: string;
  description?: string;
  price?: number;
};

type MatchPayload = {
  matched?: MatchRow[];
  lmsOnly?: MatchRow[];
  crmOnly?: MatchRow[];
  error?: string;
  hint?: string;
};

function canUseLmsMatch(role: string | null | undefined, org: { slug?: string | null } | null): boolean {
  const r = normalizeAppRole(role);
  if (r === "super_admin") return true;
  if (!isSyncpediaOrganization(org)) return false;
  return r === "org" || r === "manager";
}

function errMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { message?: string; error?: string; hint?: string };
    const base = e.message || e.error || "Request failed";
    return e.hint ? `${base} — ${e.hint}` : base;
  }
  return "Request failed";
}

export function useCanMatchLms(): boolean {
  const { role, organization } = useAuth();
  return canUseLmsMatch(role, organization);
}

export function MatchLmsButton({
  resource,
  onApplied,
}: {
  resource: LmsMatchResource;
  onApplied?: () => void;
}) {
  const can = useCanMatchLms();
  const [open, setOpen] = useState(false);
  if (!can) return null;
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <GitCompareArrows className="h-4 w-4" />
        Match LMS
      </Button>
      <MatchLmsDialog
        open={open}
        onOpenChange={setOpen}
        resource={resource}
        onApplied={onApplied}
      />
    </>
  );
}

export function MatchLmsDialog({
  open,
  onOpenChange,
  resource,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: LmsMatchResource;
  onApplied?: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [data, setData] = useState<MatchPayload | null>(null);
  const [addIds, setAddIds] = useState<Set<string>>(new Set());
  const [deleteIds, setDeleteIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setData(null);
    setAddIds(new Set());
    setDeleteIds(new Set());
    try {
      const res = (await api.lmsSync.match(resource)) as MatchPayload;
      setData(res);
      const only = Array.isArray(res.lmsOnly) ? res.lmsOnly : [];
      setAddIds(new Set(only.map((r) => String(r.lms_id || "")).filter(Boolean)));
      const crmOnly = Array.isArray(res.crmOnly) ? res.crmOnly : [];
      setDeleteIds(new Set(crmOnly.map((r) => String(r.crm_id || "")).filter(Boolean)));
    } catch (err) {
      toast({ title: "Match failed", description: errMessage(err), variant: "destructive" });
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }, [resource, toast, onOpenChange]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };

  const apply = async () => {
    setApplying(true);
    try {
      const res = (await api.lmsSync.apply({
        resource,
        add: Array.from(addIds),
        delete: Array.from(deleteIds),
      })) as { created?: number; deleted?: number; errors?: string[] };
      const errs = Array.isArray(res.errors) ? res.errors : [];
      toast({
        title: "LMS match applied",
        description: `Added ${res.created ?? 0}, deleted ${res.deleted ?? 0}${
          errs.length ? `. ${errs.length} issue(s).` : ""
        }`,
        variant: errs.length ? "destructive" : "default",
      });
      onOpenChange(false);
      onApplied?.();
    } catch (err) {
      toast({ title: "Apply failed", description: errMessage(err), variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const label = resource === "courses" ? "courses" : "batches";
  const matched = data?.matched ?? [];
  const lmsOnly = data?.lmsOnly ?? [];
  const crmOnly = data?.crmOnly ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Match LMS {label}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Comparing with LMS…
          </div>
        ) : (
          <div className="space-y-5 overflow-y-auto pr-1 flex-1 min-h-0">
            <section>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-semibold">Matched</h3>
                <Badge variant="secondary">{matched.length}</Badge>
              </div>
              {matched.length === 0 ? (
                <p className="text-xs text-muted-foreground">No linked {label} yet.</p>
              ) : (
                <ul className="text-sm space-y-1.5 border rounded-md p-2 max-h-36 overflow-y-auto">
                  {matched.map((r) => (
                    <li key={`${r.lms_id}-${r.crm_id}`} className="flex justify-between gap-2">
                      <span className="truncate">
                        {r.lms_name || r.name}
                        {r.lms_course_name || r.crm_course_name
                          ? ` · ${r.lms_course_name || r.crm_course_name}`
                          : ""}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">CRM linked</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-semibold">In LMS only — Add to CRM</h3>
                <Badge>{lmsOnly.length}</Badge>
              </div>
              {lmsOnly.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing new to add.</p>
              ) : (
                <ul className="text-sm space-y-2 border rounded-md p-2 max-h-48 overflow-y-auto">
                  {lmsOnly.map((r) => {
                    const id = String(r.lms_id || "");
                    return (
                      <li key={id} className="flex items-start gap-2">
                        <Checkbox
                          checked={addIds.has(id)}
                          onCheckedChange={(v) => setAddIds((s) => toggle(s, id, v === true))}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{r.name}</p>
                          {(r.lms_course_name || r.description) && (
                            <p className="text-xs text-muted-foreground truncate">
                              {r.lms_course_name || r.description}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-semibold">In CRM only (LMS-linked) — Delete</h3>
                <Badge variant="destructive">{crmOnly.length}</Badge>
              </div>
              {crmOnly.length === 0 ? (
                <p className="text-xs text-muted-foreground">No stale LMS-linked rows.</p>
              ) : (
                <ul className="text-sm space-y-2 border rounded-md p-2 max-h-40 overflow-y-auto">
                  {crmOnly.map((r) => {
                    const id = String(r.crm_id || "");
                    return (
                      <li key={id} className="flex items-start gap-2">
                        <Checkbox
                          checked={deleteIds.has(id)}
                          onCheckedChange={(v) => setDeleteIds((s) => toggle(s, id, v === true))}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{r.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {r.course_name ? `${r.course_name} · ` : ""}
                            lms_id {r.lms_id}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            Cancel
          </Button>
          <Button
            onClick={() => void apply()}
            disabled={loading || applying || (addIds.size === 0 && deleteIds.size === 0)}
          >
            {applying ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Apply ({addIds.size} add, {deleteIds.size} delete)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
