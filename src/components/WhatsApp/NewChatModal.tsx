import { useEffect, useState } from "react";
import { communicationsApi } from "@/services/communications";
import type { DialerContact } from "@/types/communications";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function NewChatModal({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onStart: (opts: { phone: string; name?: string; leadId?: string }) => void;
}) {
  const [search, setSearch] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualName, setManualName] = useState("");
  const [results, setResults] = useState<DialerContact[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setManualPhone("");
    setManualName("");
    setResults([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = search.trim();
    if (q.length < 1) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await communicationsApi.dialerContacts(q);
        setResults(res.data ?? []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [search, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[min(92dvh,calc(100dvh-1rem))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Search leads</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or phone…" />
          </div>
          <div className="max-h-48 overflow-y-auto border rounded-md">
            {loading ? (
              <p className="p-3 text-sm text-muted-foreground">Searching…</p>
            ) : results.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {search.trim() ? "No leads found" : "Type to search leads"}
              </p>
            ) : (
              results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted border-b last:border-0"
                  onClick={() => {
                    onStart({ phone: c.phone, name: c.full_name, leadId: c.id });
                    onOpenChange(false);
                  }}
                >
                  <span className="font-medium block truncate">{c.full_name}</span>
                  <span className="text-xs text-muted-foreground">{c.phone}</span>
                </button>
              ))
            )}
          </div>
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs text-muted-foreground">Or enter a number manually</p>
            <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Name (optional)" />
            <Input value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} placeholder="Phone e.g. 9198…" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-[#25d366] hover:bg-[#1da851]"
            disabled={!manualPhone.trim()}
            onClick={() => {
              onStart({ phone: manualPhone.trim(), name: manualName.trim() || undefined });
              onOpenChange(false);
            }}
          >
            Start chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
