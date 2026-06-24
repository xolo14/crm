import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

export type FresherTeamPick = {
  id: string;
  full_name: string;
  email: string;
  role: string;
};

export type AddMemberFormProps = {
  name: string;
  role: string;
  joiningDate: string;
  /** Sales reps, sales executives, and team leads (same org as caller). */
  picklist: FresherTeamPick[];
  picklistLoading?: boolean;
  picklistEmptyHint?: string;
  onPickMember: (member: FresherTeamPick) => void;
  onRoleChange: (v: string) => void;
  onJoiningDateChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  submitting?: boolean;
  className?: string;
};

function roleDisplayLabel(roleKey: string): string {
  const r = String(roleKey || "")
    .trim()
    .toLowerCase();
  if (r === "team_lead") return "Manager";
  if (r === "sales_representative") return "Sales Representative";
  return r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const inputClass =
  "w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm transition-shadow focus-visible:border-[#2ed573] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2ed573]/30";

export function AddMemberForm({
  name,
  role,
  joiningDate,
  picklist,
  picklistLoading,
  picklistEmptyHint,
  onPickMember,
  onRoleChange,
  onJoiningDateChange,
  onSubmit,
  disabled,
  submitting,
  className,
}: AddMemberFormProps) {
  const [open, setOpen] = useState(false);

  const selectedId = useMemo(
    () => picklist.find((p) => p.full_name.trim() === name.trim())?.id ?? "",
    [picklist, name],
  );

  const busy = !!(submitting || picklistLoading);
  const canSubmit = !disabled && !busy && !!name.trim() && !!selectedId;

  return (
    <section
      className={cn(
        "mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Add Fresher Member</h2>
          <p className="mt-0.5 text-xs text-gray-400">New member starts 15-day training immediately</p>
        </div>
        <span className="inline-flex w-fit items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs text-blue-600">
          Training starts today
        </span>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-gray-500">
        Choose someone from the team search so their CRM user is linked — this saves their training start date on the server.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs font-medium text-gray-600">Full name</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={open}
                disabled={disabled || busy}
                className={cn(
                  inputClass,
                  "h-auto min-h-[42px] justify-between border-gray-200 bg-white font-normal text-left hover:bg-gray-50/80",
                  !name.trim() && "text-gray-400",
                )}
              >
                <span className="truncate">
                  {picklistLoading ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading team…
                    </span>
                  ) : name.trim() ? (
                    name.trim()
                  ) : (
                    "e.g. search sales rep or team lead…"
                  )}
                </span>
                {picklistLoading ? null : <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search by name or email…" />
                <CommandList>
                  <CommandEmpty>
                    {picklistLoading
                      ? "Loading…"
                      : picklistEmptyHint || "No sales reps or team leads in your organisation."}
                  </CommandEmpty>
                  <CommandGroup>
                    {picklist.map((m) => {
                      return (
                        <CommandItem
                          key={m.id}
                          value={`${m.id} ${m.full_name} ${m.email} ${m.role ?? ""}`}
                          onSelect={() => {
                            onPickMember(m);
                            setOpen(false);
                          }}
                          className="flex items-start gap-2"
                        >
                          <Check
                            className={cn(
                              "mt-0.5 h-4 w-4 shrink-0",
                              selectedId === m.id ? "opacity-100 text-[#2ed573]" : "opacity-0",
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-gray-900">{m.full_name}</div>
                            <div className="truncate text-[11px] text-gray-500">
                              {m.email} · {roleDisplayLabel(m.role)}
                            </div>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-medium text-gray-600">Role</Label>
          <Input
            value={role}
            onChange={(e) => onRoleChange(e.target.value)}
            placeholder="e.g. Sales Executive"
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-medium text-gray-600">Joining date</Label>
          <Input
            type="date"
            value={joiningDate}
            onChange={(e) => onJoiningDateChange(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex items-end lg:col-span-1">
          <Button
            type="button"
            className={cn(
              "h-[42px] w-full rounded-xl bg-[#2ed573] px-5 text-sm font-semibold text-[#0f2318] transition-colors hover:bg-[#22c265] lg:w-auto lg:min-w-[160px]",
              !canSubmit && "cursor-not-allowed opacity-50",
            )}
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Adding…
              </span>
            ) : (
              <>+ Add to Training</>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}

export { roleDisplayLabel };
