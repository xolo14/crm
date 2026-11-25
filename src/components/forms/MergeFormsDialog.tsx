import { useEffect, useMemo, useState } from "react";
import { Loader2, Merge, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { confirmAction } from "@/components/ConfirmDialogHost";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type MergeableForm = {
  id: string;
  name: string;
  slug: string;
  submission_count?: number;
  created_by_name?: string | null;
  org_id?: string | null;
  org_name?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Forms of one kind (Leads or HR) — the server refuses mixing kinds or organizations. */
  forms: MergeableForm[];
  onMerged: () => void;
};

/**
 * Pick several forms and the one to keep. Every lead of the others moves to the kept form
 * (one card on Form Leads); their links keep working and open the kept form.
 */
export function MergeFormsDialog({ open, onOpenChange, forms, onMerged }: Props) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [keepId, setKeepId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected([]);
    setKeepId(null);
    setName("");
    setNameTouched(false);
  }, [open]);

  const byId = useMemo(() => new Map(forms.map((f) => [f.id, f])), [forms]);
  const keep = keepId ? byId.get(keepId) ?? null : null;

  // Selecting forms: the first pick (or the one with most leads) becomes the form to keep.
  useEffect(() => {
    if (selected.length === 0) {
      setKeepId(null);
      return;
    }
    if (keepId && selected.includes(keepId)) return;
    const best = [...selected].sort(
      (a, b) => Number(byId.get(b)?.submission_count ?? 0) - Number(byId.get(a)?.submission_count ?? 0),
    )[0];
    setKeepId(best);
  }, [selected, keepId, byId]);

  useEffect(() => {
    if (!nameTouched) setName(keep?.name ?? "");
  }, [keep, nameTouched]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? forms.filter((f) => f.name.toLowerCase().includes(q) || f.slug.toLowerCase().includes(q))
      : forms;
    // Selected forms stay on top so the choice is easy to review.
    return [...list].sort((a, b) => Number(selected.includes(b.id)) - Number(selected.includes(a.id)));
  }, [forms, query, selected]);

  const others = selected.filter((id) => id !== keepId);
  const totalLeads = selected.reduce((s, id) => s + Number(byId.get(id)?.submission_count ?? 0), 0);
  const orgs = new Set(selected.map((id) => String(byId.get(id)?.org_id ?? "")));
  const mixedOrgs = orgs.size > 1;
  const canMerge = !!keep && others.length > 0 && !mixedOrgs && name.trim().length > 0 && !busy;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => (on ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));

  const selectMatches = () => {
    const ids = visible.map((f) => f.id);
    setSelected((prev) => Array.from(new Set([...prev, ...ids])));
  };

  const runMerge = async () => {
    if (!keep || !canMerge) return;
    const otherNames = others.map((id) => byId.get(id)?.name || id);
    const ok = await confirmAction({
      title: `Merge ${others.length + 1} forms into one?`,
      description:
        `All ${totalLeads.toLocaleString("en-IN")} leads will be in “${name.trim()}”. ` +
        `${otherNames.length === 1 ? "This form" : `These ${otherNames.length} forms`} will be switched off and removed from the list: ` +
        `${otherNames.join(", ")}. Their links and QR codes will keep working and open “${name.trim()}”. ` +
        "This can't be undone from the app.",
      confirmLabel: "Merge forms",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.forms.merge({
        target_id: keep.id,
        source_ids: others,
        name: name.trim() !== keep.name ? name.trim() : undefined,
      });
      toast({
        title: "Forms merged",
        description: `${Number(res?.moved_leads ?? 0).toLocaleString("en-IN")} leads moved into “${name.trim()}”.`,
      });
      onOpenChange(false);
      onMerged();
    } catch (err) {
      toast({ variant: "destructive", title: "Merge failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Merge className="h-5 w-5" />Merge forms</DialogTitle>
          <DialogDescription>
            Tick the forms to combine and choose the one to keep. All their leads move into one form, so they show as a
            single card on Form Leads. Old links and QR codes keep working.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search forms, e.g. cybersecurity"
                aria-label="Search forms"
                className="pl-8"
              />
            </div>
            <Button type="button" variant="outline" onClick={selectMatches} disabled={visible.length === 0}>
              Select {query.trim() ? "matches" : "all"}
            </Button>
          </div>

          <ul className="max-h-[42vh] divide-y overflow-y-auto rounded-md border" aria-label="Forms">
            {visible.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">No forms match.</li>
            ) : (
              visible.map((f) => {
                const isSel = selected.includes(f.id);
                const isKeep = keepId === f.id;
                return (
                  <li key={f.id} className={cn("flex items-center gap-3 px-3 py-2", isKeep && "bg-primary/5")}>
                    <Checkbox
                      id={`merge-${f.id}`}
                      checked={isSel}
                      onCheckedChange={(v) => toggle(f.id, v === true)}
                      aria-label={`Include ${f.name}`}
                    />
                    <label htmlFor={`merge-${f.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block truncate text-sm font-medium">{f.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {f.slug}
                        {f.created_by_name ? ` · ${f.created_by_name}` : ""}
                        {f.org_name ? ` · ${f.org_name}` : ""}
                      </span>
                    </label>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {Number(f.submission_count ?? 0).toLocaleString("en-IN")} leads
                    </span>
                    {isSel ? (
                      isKeep ? (
                        <Badge className="shrink-0">Keep</Badge>
                      ) : (
                        <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 text-xs" onClick={() => setKeepId(f.id)}>
                          Keep this
                        </Button>
                      )
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>

          {selected.length > 0 ? (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="space-y-1">
                <Label htmlFor="merge-name">Name of the merged form</Label>
                <Input
                  id="merge-name"
                  value={name}
                  maxLength={180}
                  onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {others.length === 0
                  ? "Tick at least one more form to merge into the kept form."
                  : `${others.length + 1} forms · ${totalLeads.toLocaleString("en-IN")} leads → one form with the link ${keep?.slug ?? ""}. The kept form's questions and settings are used from now on.`}
              </p>
              {mixedOrgs ? (
                <p className="text-xs text-destructive">These forms belong to different organizations and can't be merged.</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={() => void runMerge()} disabled={!canMerge} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />}
            Merge {others.length > 0 ? others.length + 1 : ""} forms
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
