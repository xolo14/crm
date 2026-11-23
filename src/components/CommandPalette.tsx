import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface CommandPage {
  to: string;
  label: string;
  icon: LucideIcon;
  group: string;
}

/** Ctrl/Cmd+K: jump to any page the current role can open. */
export function CommandPalette({ pages }: { pages: CommandPage[] }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("crm-open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("crm-open-command-palette", onOpen);
    };
  }, []);

  const groups = pages.reduce<Record<string, CommandPage[]>>((acc, p) => {
    (acc[p.group] ??= []).push(p);
    return acc;
  }, {});

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search pages">
      <CommandInput placeholder="Search pages…" />
      <CommandList>
        <CommandEmpty>No matching page.</CommandEmpty>
        {Object.entries(groups).map(([group, items]) => (
          <CommandGroup key={group} heading={group}>
            {items.map((p) => (
              <CommandItem
                key={p.to + p.label}
                value={`${p.label} ${group}`}
                onSelect={() => {
                  setOpen(false);
                  navigate(p.to);
                }}
              >
                <p.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                {p.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
