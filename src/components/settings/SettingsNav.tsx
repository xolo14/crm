import {
  Building2,
  Globe,
  KeyRound,
  Lock,
  Logs,
  Shield,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsNavProps {
  active: string;
  onChange: (section: string) => void;
  /** If true, only General + Password Change are shown (manager / L1). */
  limited?: boolean;
}

const fullNavGroups = [
  {
    label: "General",
    items: [
      { id: "general", name: "General", icon: SlidersHorizontal },
      { id: "company-profile", name: "Company Profile", icon: Building2 },
      { id: "localization", name: "Localization", icon: Globe },
    ],
  },
  {
    label: "Security",
    items: [
      { id: "security", name: "Security", icon: Lock },
      { id: "audit-logs", name: "Audit Logs", icon: Logs },
      { id: "data-privacy", name: "Data & Privacy", icon: Trash2 },
    ],
  },
];

const limitedNavGroups = [
  {
    label: "Account",
    items: [
      { id: "general", name: "General", icon: SlidersHorizontal },
      { id: "password", name: "Password Change", icon: KeyRound },
    ],
  },
];

export function SettingsNav({ active, onChange, limited = false }: SettingsNavProps) {
  const navGroups = limited ? limitedNavGroups : fullNavGroups;
  const flatItems = navGroups.flatMap((g) => g.items);

  return (
    <>
      {/* Mobile: horizontal section pills */}
      <div className="md:hidden -mx-4 px-4 overflow-x-auto scrollbar-none">
        <div className="flex gap-2 pb-1 min-w-0">
          {flatItems.map((item) => {
            const isActive = item.id === active;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChange(item.id)}
                className={cn(
                  "touch-target inline-flex items-center gap-1.5 shrink-0 rounded-full border px-3.5 py-2 text-xs font-medium transition-colors",
                  isActive
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                <item.icon className="h-3.5 w-3.5 shrink-0" />
                {item.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop: side rail */}
      <aside className="hidden md:block w-[240px] shrink-0 border-r border-border bg-card px-3 py-4 rounded-l-lg">
        {navGroups.map((group) => (
          <div key={group.label} className="mt-2 first:mt-0">
            <p className="mt-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[1px] text-muted-foreground">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive = item.id === active;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChange(item.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] transition-all duration-150 ease-in-out min-h-11",
                      isActive
                        ? "border-l-[3px] border-primary bg-primary/10 font-medium text-primary"
                        : "text-foreground/80 hover:bg-muted",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.name}</span>
                    {item.id === "security" && <Shield className="ml-auto h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </aside>
    </>
  );
}
