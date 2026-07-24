import { useEffect, useMemo, useState } from "react";
import type { DialerContact, WaConversation, WhatsappTemplate } from "@/types/communications";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { countTemplateVars } from "./waUtils";

function buildInitialVars(
  template: WhatsappTemplate,
  conversation: WaConversation | null,
  leadHint?: DialerContact | null,
): string[] {
  const n = countTemplateVars(template.body || "");
  return Array.from({ length: n }, (_, i) => {
    if (i === 0) return (leadHint?.full_name || conversation?.contact_name || "").trim();
    return "";
  });
}

export default function TemplateModal({
  open,
  onOpenChange,
  templates,
  conversation,
  leadHint,
  sending,
  onSend,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  templates: WhatsappTemplate[];
  conversation: WaConversation | null;
  leadHint?: DialerContact | null;
  sending?: boolean;
  onSend: (payload: {
    template_id: string;
    variables: string[];
    recipient_phone: string;
    recipient_name?: string;
    lead_id?: string;
  }) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [vars, setVars] = useState<string[]>([]);
  const [formError, setFormError] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.body || "").toLowerCase().includes(q),
    );
  }, [templates, search]);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) || null,
    [templates, selectedId],
  );
  const varCount = selected ? countTemplateVars(selected.body || "") : 0;

  // Only reset when modal opens or template list first loads with modal open.
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setFormError("");
    const first = templates[0];
    const id = first?.id || "";
    setSelectedId(id);
    if (first) {
      setVars(buildInitialVars(first, conversation, leadHint));
    } else {
      setVars([]);
    }
  }, [open]); // conversation/leadHint applied once at open

  // When user picks another template, re-seed vars (not on poll).
  useEffect(() => {
    if (!open || !selectedId) return;
    const tpl = templates.find((t) => t.id === selectedId);
    if (!tpl) return;
    setVars(buildInitialVars(tpl, conversation, leadHint));
    setFormError("");
  }, [selectedId]); // intentionally not templates/conversation

  const preview = useMemo(() => {
    if (!selected) return "";
    let body = selected.body || "";
    for (let i = 0; i < varCount; i++) {
      const v = (vars[i] ?? "").trim();
      body = body.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, "g"), v || `{{${i + 1}}}`);
    }
    return body;
  }, [selected, vars, varCount]);

  const missingIndexes = useMemo(() => {
    const missing: number[] = [];
    for (let i = 0; i < varCount; i++) {
      if (!(vars[i] ?? "").trim()) missing.push(i + 1);
    }
    return missing;
  }, [vars, varCount]);

  const updateVar = (index: number, value: string) => {
    setVars((prev) => {
      const next = Array.from({ length: Math.max(varCount, prev.length) }, (_, i) => prev[i] ?? "");
      next[index] = value;
      return next;
    });
    setFormError("");
  };

  const handleSend = () => {
    if (!selected || !conversation?.contact_phone) return;
    if (missingIndexes.length > 0) {
      setFormError(
        `Fill all template variables before sending (missing {{${missingIndexes.join("}}, {{")}}}). Meta rejects empty values.`,
      );
      return;
    }
    const clean = Array.from({ length: varCount }, (_, i) => (vars[i] ?? "").trim());
    onSend({
      template_id: selected.id,
      variables: clean,
      recipient_phone: conversation.contact_phone,
      recipient_name: conversation.contact_name || undefined,
      lead_id: conversation.lead_id || leadHint?.id || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[min(92dvh,calc(100dvh-1rem))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send template</DialogTitle>
        </DialogHeader>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates…"
          className="h-10"
        />
        <div className="max-h-40 overflow-y-auto border rounded-md divide-y">
          {filtered.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No approved templates</p>
          ) : (
            filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${selectedId === t.id ? "bg-muted" : ""}`}
                onClick={() => setSelectedId(t.id)}
              >
                <span className="font-medium block truncate">{t.name}</span>
                <span className="text-xs text-muted-foreground line-clamp-1">{t.body}</span>
              </button>
            ))
          )}
        </div>
        {selected ? (
          <div className="space-y-3">
            {Array.from({ length: varCount }, (_, i) => (
              <div key={i} className="space-y-1">
                <Label htmlFor={`wa-tpl-var-${i}`}>{`{{${i + 1}}}`}</Label>
                <Input
                  id={`wa-tpl-var-${i}`}
                  value={vars[i] ?? ""}
                  onChange={(e) => updateVar(i, e.target.value)}
                  placeholder={i === 0 ? "Name" : i === 1 ? "Course / topic" : `Value ${i + 1}`}
                  className={!(vars[i] ?? "").trim() ? "border-amber-400" : undefined}
                />
              </div>
            ))}
            <div className="rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap">{preview}</div>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
        ) : null}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-[#25d366] hover:bg-[#1da851]"
            disabled={!selected || sending || !conversation?.contact_phone || missingIndexes.length > 0}
            onClick={handleSend}
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
