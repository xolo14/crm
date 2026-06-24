import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Shuffle, Users } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

/** Round-robin counts: first `remainder` HRs get base+1 leads (same pattern as Form Leads bulk). */
export function roundRobinCounts(leadCount: number, hrIdsOrdered: string[]): Record<string, number> {
  const n = hrIdsOrdered.length;
  if (n === 0 || leadCount <= 0) return {};
  const base = Math.floor(leadCount / n);
  const remainder = leadCount % n;
  const out: Record<string, number> = {};
  hrIdsOrdered.forEach((id, i) => {
    out[id] = base + (i < remainder ? 1 : 0);
  });
  return out;
}

export default function BulkAssignHRLeadsDialog({
  open,
  onOpenChange,
  hrUsers,
  selectedCount,
  onAssign,
  loading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hrUsers: Array<{ id: string; full_name: string }>;
  selectedCount: number;
  /** Ordered HR ids (checkbox order); leads are assigned round-robin in this order. */
  onAssign: (hrIdsOrdered: string[]) => Promise<void>;
  loading?: boolean;
}) {
  const [selectedHrIds, setSelectedHrIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) setSelectedHrIds([]);
  }, [open]);

  const countsByHr = useMemo(
    () => roundRobinCounts(selectedCount, selectedHrIds),
    [selectedCount, selectedHrIds],
  );

  const toggleHr = (id: string) => {
    setSelectedHrIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllHr = () => {
    if (selectedHrIds.length === hrUsers.length) setSelectedHrIds([]);
    else setSelectedHrIds(hrUsers.map((h) => h.id));
  };

  const nameById = useMemo(() => Object.fromEntries(hrUsers.map((h) => [h.id, h.full_name])), [hrUsers]);

  const canSubmit =
    selectedCount >= 1 && selectedHrIds.length > 0 && hrUsers.length > 0 && !loading;

  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shuffle className="h-5 w-5 text-primary" />
            Bulk assign to HR (round-robin)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1 text-sm">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
              Selected leads
            </Label>
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{selectedCount}</span> lead
              {selectedCount === 1 ? "" : "s"} will be split evenly across the HR users you choose (round-robin).
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                HR recipients
              </Label>
              <button
                type="button"
                onClick={selectAllHr}
                disabled={loading || hrUsers.length === 0}
                className="text-xs text-primary hover:underline disabled:opacity-50"
              >
                {selectedHrIds.length === hrUsers.length ? "Deselect all" : "Select all"}
              </button>
            </div>

            {hrUsers.length === 0 ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-200/50">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                <p className="text-xs text-amber-800">No HR users available.</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {hrUsers.map((hr) => (
                  <label
                    key={hr.id}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      selectedHrIds.includes(hr.id)
                        ? "bg-primary/5 border-primary/30"
                        : "bg-muted/30 border-border hover:bg-muted/50"
                    } ${loading ? "opacity-60 pointer-events-none" : ""}`}
                  >
                    <Checkbox
                      checked={selectedHrIds.includes(hr.id)}
                      onCheckedChange={() => toggleHr(hr.id)}
                      disabled={loading}
                    />
                    <span className="text-sm font-medium flex-1">{hr.full_name}</span>
                    {selectedHrIds.includes(hr.id) && selectedCount > 0 && (
                      <Badge variant="secondary" className="text-[10px] tabular-nums">
                        ~{countsByHr[hr.id] ?? 0} leads
                      </Badge>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {selectedHrIds.length > 0 && selectedCount > 0 && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-primary">Round-robin preview</p>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Lead 1 → first HR, lead 2 → second HR, … then repeat. Totals per HR:
              </p>
              <ul className="text-xs space-y-1">
                {selectedHrIds.map((hid) => (
                  <li key={hid} className="flex justify-between gap-2">
                    <span className="truncate text-foreground">{nameById[hid] ?? hid}</span>
                    <span className="font-medium tabular-nums">{countsByHr[hid] ?? 0}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              if (!canSubmit) return;
              await onAssign(selectedHrIds);
            }}
            disabled={!canSubmit}
            className="gap-1.5"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Assigning…
              </>
            ) : (
              <>
                <Shuffle className="h-4 w-4" />
                Assign {selectedCount} lead{selectedCount === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
