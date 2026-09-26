import { useMemo, useState } from "react";
import { Upload, Search, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type CampaignPickPerson = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  group: "leads" | "members";
  college?: string;
  course?: string;
  company?: string;
  source?: string;
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?\d[\d\s().-]{8,}\d)/g;

function leftoverName(line: string, match: string): string | undefined {
  const name = line
    .replace(match, " ")
    .replace(/[<>"'()]/g, " ")
    .replace(/[,;|/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || undefined;
}

export type ManualEmailEntry = { email: string; name?: string };
export type ManualPhoneEntry = { phone: string; name?: string };

/** One row per line so "Tendu, tendu@x.com" keeps the name. */
export function parseManualEmailEntries(text: string): ManualEmailEntry[] {
  const seen = new Set<string>();
  const out: ManualEmailEntry[] = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    EMAIL_RE.lastIndex = 0;
    const found = [...line.matchAll(EMAIL_RE)].map((m) => m[0]);
    if (found.length === 0) continue;
    if (found.length === 1) {
      const email = found[0];
      const key = normalizeEmail(email);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ email, name: leftoverName(line, email) });
      continue;
    }
    for (const email of found) {
      const key = normalizeEmail(email);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ email });
    }
  }
  return out;
}

type Props = {
  mode: "email" | "phone";
  people: CampaignPickPerson[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  manualText: string;
  onManualTextChange: (value: string) => void;
  onUploadFile?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Override list section title (default: Select leads / members). */
  listLabel?: string;
  /** Override empty-state hint inside the scroll list. */
  emptyHint?: string;
  /** Called when the list search query changes (for remote lead lookup). */
  onSearchChange?: (query: string) => void;
  /** Hide the people list until the user types a search (email Send Campaign). */
  hideListUntilSearch?: boolean;
  /** Lead forms for the Send Campaign form dropdown (right of search). */
  forms?: Array<{ id: string; name: string }>;
  formsLoading?: boolean;
  selectedFormId?: string;
  onSelectedFormIdChange?: (formId: string) => void;
  formPeople?: CampaignPickPerson[];
  formPeopleLoading?: boolean;
};

function normalizeEmail(v: string) {
  return v.trim().toLowerCase();
}

function normalizePhone(v: string) {
  return v.replace(/\s+/g, "").trim();
}

export function parseManualEmails(text: string): string[] {
  return parseManualEmailEntries(text).map((e) => e.email);
}

export function parseManualPhoneEntries(text: string): ManualPhoneEntry[] {
  const seen = new Set<string>();
  const out: ManualPhoneEntry[] = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    PHONE_RE.lastIndex = 0;
    const found = [...line.matchAll(PHONE_RE)];
    const valid = found.filter((m) => m[0].replace(/\D+/g, "").length >= 10);
    if (valid.length === 0) continue;
    if (valid.length === 1) {
      const rawPhone = valid[0][0];
      const phone = normalizePhone(rawPhone);
      const digits = phone.replace(/\D+/g, "");
      if (seen.has(digits)) continue;
      seen.add(digits);
      out.push({ phone, name: leftoverName(line, rawPhone) });
      continue;
    }
    for (const m of valid) {
      const phone = normalizePhone(m[0]);
      const digits = phone.replace(/\D+/g, "");
      if (seen.has(digits)) continue;
      seen.add(digits);
      out.push({ phone });
    }
  }
  return out;
}

export function parseManualPhones(text: string): string[] {
  return parseManualPhoneEntries(text).map((p) => p.phone);
}

export function formatManualEmailLine(entry: ManualEmailEntry): string {
  const name = String(entry.name || "").trim();
  return name ? `${name} <${entry.email}>` : entry.email;
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
  listLabel,
  emptyHint,
  onSearchChange,
  hideListUntilSearch,
  forms,
  formsLoading,
  selectedFormId,
  onSelectedFormIdChange,
  formPeople,
  formPeopleLoading,
}: Props) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const searchActive = query.trim().length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (hideListUntilSearch && !q) return [];
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
  }, [people, query, mode, hideListUntilSearch]);

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
  const showFormDropdown = typeof onSelectedFormIdChange === "function";
  const formList = formPeople ?? [];
  const formSelected = Boolean(selectedFormId);
  const formIds = formList.map((p) => p.id);
  const formAllSelected = formIds.length > 0 && formIds.every((id) => selected.has(id));
  const formIdsSet = new Set(formIds);
  const searchLeads = leads.filter((p) => !formIdsSet.has(p.id));
  const searchMembers = members.filter((p) => !formIdsSet.has(p.id));
  const showSearchList = !hideListUntilSearch || searchActive;

  function toggleFormAll() {
    if (formAllSelected) {
      const drop = new Set(formIds);
      onSelectedIdsChange(selectedIds.filter((id) => !drop.has(id)));
      return;
    }
    onSelectedIdsChange(Array.from(new Set([...selectedIds, ...formIds])));
  }

  function personRow(p: CampaignPickPerson) {
    return (
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
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <Label className="text-xs font-medium">
            {listLabel || (hideListUntilSearch ? "Search leads / members" : "Select leads / members")}
          </Label>
          {searchActive ? (
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={toggleAll} disabled={selectableIds.length === 0}>
              {allSelected ? "Clear filtered" : "Select filtered"}
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start mb-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                const v = e.target.value;
                setQuery(v);
                onSearchChange?.(v);
              }}
              placeholder={
                hideListUntilSearch
                  ? "Type to search by name, email, or phone…"
                  : "Search all leads and members by name, email, or phone…"
              }
              className="h-9 pl-8 text-sm"
            />
          </div>
          {showFormDropdown ? (
            <Select
              value={selectedFormId || "__none__"}
              onValueChange={(v) => onSelectedFormIdChange?.(v === "__none__" ? "" : v)}
              disabled={formsLoading}
            >
              <SelectTrigger className="h-9 sm:w-[240px] text-sm shrink-0">
                <SelectValue placeholder={formsLoading ? "Loading forms…" : "Select a form"} />
              </SelectTrigger>
              <SelectContent className="z-[210]">
                <SelectItem value="__none__">No form</SelectItem>
                {(forms ?? []).map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        {formSelected ? (
          <div className="mb-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-1">
                Form leads{formPeopleLoading ? "" : ` (${formList.length})`}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={toggleFormAll}
                disabled={formPeopleLoading || formIds.length === 0}
              >
                {formAllSelected ? "Clear form" : "Select all in form"}
              </Button>
            </div>
            <ScrollArea className="h-[220px] rounded-md border">
              <div className="p-2 space-y-0.5">
                {formPeopleLoading ? (
                  <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground px-1 py-8">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading form leads…
                  </p>
                ) : formList.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-1 py-4 text-center">
                    No leads with {mode === "email" ? "email" : "phone"} on this form.
                  </p>
                ) : (
                  formList.map((p) => personRow(p))
                )}
              </div>
            </ScrollArea>
            <p className="text-[10px] text-muted-foreground mt-1 px-0.5">
              Only ticked form leads are added to the send list.
            </p>
          </div>
        ) : null}
        {hideListUntilSearch && !searchActive && !formSelected ? (
          <p className="text-[11px] text-muted-foreground">
            {emptyHint ||
              `Type to search, pick a form to list its leads, or enter ${mode === "email" ? "emails" : "phone numbers"} manually below.`}
          </p>
        ) : showSearchList ? (
          <ScrollArea className="h-[220px] rounded-md border">
            <div className="p-2 space-y-3">
              {searchLeads.length === 0 && searchMembers.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1 py-4 text-center">
                  {hideListUntilSearch
                    ? "No matches. Try another search, pick a form, or enter recipients manually below."
                    : emptyHint ||
                      `Search your leads, or enter ${mode === "email" ? "emails" : "phone numbers"} manually below.`}
                </p>
              ) : null}
              {searchLeads.length > 0 ? (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-1">Leads ({searchLeads.length})</p>
                  <div className="space-y-0.5">{searchLeads.map((p) => personRow(p))}</div>
                </div>
              ) : null}
              {searchMembers.length > 0 ? (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-1">Members ({searchMembers.length})</p>
                  <div className="space-y-0.5">{searchMembers.map((p) => personRow(p))}</div>
                </div>
              ) : null}
            </div>
          </ScrollArea>
        ) : null}
        {selectedContacts.length > 0 ? (
          <div className="flex flex-wrap gap-1 mt-2">
            {selectedContacts.map((p) => (
              <button
                key={p.id}
                type="button"
                className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] hover:bg-muted"
                onClick={() => toggle(p.id)}
                title="Remove"
              >
                <span className="max-w-[140px] truncate">{p.name || (mode === "email" ? p.email : p.phone)}</span>
                <X className="h-3 w-3 shrink-0" />
              </button>
            ))}
          </div>
        ) : null}
        <p className="text-[10px] text-muted-foreground mt-1">
          {selectedIds.length} selected from search / form
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs font-medium">
            {mode === "email" ? "Or enter emails manually" : "Or enter phones manually"}
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
              ? "One per line only"
              : "One per line only"
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

export type CampaignEmailRecipient = {
  email: string;
  name?: string;
  personId?: string;
  group?: CampaignPickPerson["group"] | "manual";
};

/** Merge picker + manual into unique email recipients with names when known. */
export function mergeCampaignEmailRecipients(
  people: CampaignPickPerson[],
  selectedIds: string[],
  manualText: string,
): CampaignEmailRecipient[] {
  const selected = new Set(selectedIds);
  const byEmail = new Map<string, CampaignEmailRecipient>();

  for (const p of people) {
    if (!selected.has(p.id)) continue;
    const email = String(p.email || "").trim();
    if (!email.includes("@")) continue;
    const key = normalizeEmail(email);
    if (!byEmail.has(key)) {
      byEmail.set(key, {
        email,
        name: p.name || undefined,
        personId: p.id,
        group: p.group,
      });
    }
  }

  for (const entry of parseManualEmailEntries(manualText)) {
    const key = normalizeEmail(entry.email);
    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, {
        email: entry.email,
        name: entry.name,
        group: "manual",
      });
    } else if (entry.name && !existing.name) {
      existing.name = entry.name;
    }
  }

  return Array.from(byEmail.values());
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

  for (const entry of parseManualPhoneEntries(manualText)) {
    const digits = entry.phone.replace(/\D+/g, "");
    const existing = byDigits.get(digits);
    if (!existing) {
      byDigits.set(digits, { phone: entry.phone, name: entry.name });
    } else if (entry.name && !existing.name) {
      existing.name = entry.name;
    }
  }

  return Array.from(byDigits.values());
}
