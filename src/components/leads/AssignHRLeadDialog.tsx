import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export default function AssignHRLeadDialog({
  open,
  onOpenChange,
  hrUsers,
  onAssign,
  loading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hrUsers: Array<{ id: string; full_name: string }>;
  onAssign: (hrId: string, note?: string) => Promise<void> | void;
  loading?: boolean;
}) {
  const [hrId, setHrId] = useState("");
  const [note, setNote] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign HR Lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Assign to HR</Label>
            <Select value={hrId} onValueChange={setHrId}>
              <SelectTrigger><SelectValue placeholder="Select HR" /></SelectTrigger>
              <SelectContent>
                {hrUsers.map((hr) => (
                  <SelectItem key={hr.id} value={hr.id}>{hr.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button
            onClick={async () => {
              if (!hrId) return;
              await onAssign(hrId, note);
              setHrId("");
              setNote("");
              onOpenChange(false);
            }}
            disabled={!hrId || loading}
          >
            {loading ? "Assigning..." : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
