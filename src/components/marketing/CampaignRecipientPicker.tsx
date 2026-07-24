import { useMemo, useState } from "react";
import { Upload, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type CampaignPickPerson = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  group: "leads" | "members";
};

type Props = {
  mode: "email" | "phone";
  people: CampaignPickPerson[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  manualText: string;
  onManualTextChange: (value: string) => void;
  onUploadFile?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef?: React.RefObject<HTMLInputElement | null>;
};

function normalizeEmail(v: string) {
  return v.trim().toLowerCase();
}

function normalizePhone(v: string) {
  return v.replace(/\s+/g, "").trim();
}

export function parseManualEmails(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/[\n,;]+/)) {
    const e = line.trim();
    if (!e || !e.includes("@")) continue;
    const key = normalizeEmail(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export function parseManualPhones(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/[\n,;]+/)) {
    const p = normalizePhone(line);
    const digits = p.replace(/\D+/g, "");
    if (!p || digits.length < 10) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push(p);
  }
  return out;
}

export function CampaignRecipientPicker({
  mode,
  people,
  selectedIds,
  onSelectedIdsChange,
  manualText,
  onManualTextChange,
  onUploadFile,
  fileInputRef,
}: Props) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (mode === "email" && !String(p.email || "").includes("@")) return false;
      if (mode === "phone") {
        const digits = String(p.phone || "").replace(/\D+/g, "");
        if (digits.length < 10) return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        String(p.email || "").toLowerCase().includes(q) ||
        String(p.phone || "").toLowerCase().includes(q) ||
        p.group.includes(q)
      );
    });
  }, [people, query, mode]);

  const selectableIds = filtered.map((p) => p.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange(Array.from(next));
  }

  function toggleAll() {
    if (allSelected) {
      const drop = new Set(selectableIds);
      onSelectedIdsChange(selectedIds.filter((id) => !drop.has(id)));
      return;
    }
    onSelectedIdsChange(Array.from(new Set([...selectedIds, ...selectableIds])));
  }

  const selectedContacts = people.filter((p) => selected.has(p.id));
  const fromPicker =
    mode === "email"
      ? selectedContacts.map((p) => String(p.email || "").trim()).filter((e) => e.includes("@"))
      : selectedContacts.map((p) => normalizePhone(String(p.phone || ""))).filter((p) => p.replace(/\D+/g, "").length >= 10);

  const fromManual = mode === "email" ? parseManualEmails(manualText) : parseManualPhones(manualText);
  const totalUnique =
    mode === "email"
      ? new Set([...fromPicker.map(normalizeEmail), ...fromManual.map(normalizeEmail)]).size
      : new Set([
          ...fromPicker.map((p) => p.replace(/\D+/g, "")),
          ...fromManual.map((p) => p.replace(/\D+/g, "")),
        ]).size;

  const leads = filtered.filter((p) => p.group === "leads");
  const members = filtered.filter((p) => p.group === "members");

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <Label className="text-xs font-medium">
            {mode === "email" ? "Select leads / members" : "Select leads / members"}
          </Label>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={toggleAll} disabled={selectableIds.length === 0}>
            {allSelected ? "Clear filtered" : "Select filtered"}
          </Button>
        </div>
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or phone…"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <ScrollArea className="h-[160px] rounded-md border">
          <div className="p-2 space-y-3">
            {leads.length === 0 && members.length === 0 ? (
              <p className="text-xs text-muted-foreground px-1 py-4 text-center">
                No {mode === "email" ? "emails" : "phone numbers"} found on leads/members.
              </p>
            ) : null}
            {leads.length > 0 ? (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-1">Leads ({leads.length})</p>
                <div className="space-y-0.5">
                  {leads.map((p) => (
                    <label
                      key={p.id}
                      className={cn(
                        "flex items-start gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/60",
                        selected.has(p.id) && "bg-emerald-50",
                      )}
                    >
                      <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="font-medium block truncate">{p.name || "Unnamed"}</span>
                        <span className="text-[11px] text-muted-foreground block truncate">
                          {mode === "email" ? p.email : p.phone}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            {members.length > 0 ? (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-1">Members ({members.length})</p>
                <div className="space-y-0.5">
                  {members.map((p) => (
                    <label
                      key={p.id}
                      className={cn(
                        "flex items-start gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/60",
                        selected.has(p.id) && "bg-emerald-50",
                      )}
                    >
                      <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="font-medium block truncate">{p.name || "Unnamed"}</span>
                        <span className="text-[11px] text-muted-foreground block truncate">
                          {mode === "email" ? p.email : p.phone}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </ScrollArea>
        <p className="text-[10px] text-muted-foreground mt-1">{selectedIds.length} selected from list</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs font-medium">
            {mode === "email" ? "Or enter emails manually" : "Or enter phones manually"} *
          </Label>
          {onUploadFile && fileInputRef ? (
            <>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" type="button" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3 w-3" />Upload CSV
              </Button>
              <input ref={fileInputRef} type="file" accept=".csv,.txt,.xlsx" className="hidden" onChange={onUploadFile} />
            </>
          ) : null}
        </div>
        <Textarea
          value={manualText}
          onChange={(e) => onManualTextChange(e.target.value)}
          placeholder={
            mode === "email"
              ? "Enter emails, one per line...\njohn@example.com\njane@example.com"
              : "Enter phone numbers, one per line...\n+919876543210\n+918765432109"
          }
          className={cn("min-h-[110px] text-sm", mode === "phone" && "font-mono")}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          {totalUnique} unique recipient{totalUnique === 1 ? "" : "s"} (list + manual combined)
        </p>
      </div>
    </div>
  );
}

/** Merge picker + manual into a unique recipient list. */
export function mergeCampaignRecipients(
  mode: "email" | "phone",
  people: CampaignPickPerson[],
  selectedIds: string[],
  manualText: string,
): string[] {
  const selected = new Set(selectedIds);
  const fromList = people
    .filter((p) => selected.has(p.id))
    .map((p) => (mode === "email" ? String(p.email || "").trim() : normalizePhone(String(p.phone || ""))))
    .filter((v) => (mode === "email" ? v.includes("@") : v.replace(/\D+/g, "").length >= 10));
  const fromManual = mode === "email" ? parseManualEmails(manualText) : parseManualPhones(manualText);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...fromList, ...fromManual]) {
    const key = mode === "email" ? normalizeEmail(v) : v.replace(/\D+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export type CampaignPhoneRecipient = { phone: string; name?: string };

/** Phone recipients with optional names from selected leads/members. */
export function mergeCampaignPhoneRecipients(
  people: CampaignPickPerson[],
  selectedIds: string[],
  manualText: string,
): CampaignPhoneRecipient[] {
  const selected = new Set(selectedIds);
  const byDigits = new Map<string, CampaignPhoneRecipient>();

  for (const p of people) {
    if (!selected.has(p.id)) continue;
    const phone = normalizePhone(String(p.phone || ""));
    const digits = phone.replace(/\D+/g, "");
    if (digits.length < 10) continue;
    if (!byDigits.has(digits)) {
      byDigits.set(digits, { phone, name: p.name || undefined });
    }
  }

  for (const phone of parseManualPhones(manualText)) {
    const digits = phone.replace(/\D+/g, "");
    if (!byDigits.has(digits)) {
      byDigits.set(digits, { phone });
    }
  }

  return Array.from(byDigits.values());
}
