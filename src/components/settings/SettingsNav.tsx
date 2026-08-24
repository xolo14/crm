import {
  Building2,
  CreditCard,
  KeyRound,
  Lock,
  Logs,
  Mail,
  Megaphone,
  QrCode,
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
  showEmailSetup?: boolean;
  showRazorpaySetup?: boolean;
  showMetaAdsSetup?: boolean;
  /** Super Admin: Company Profile section is labeled Company Details. */
  isSuperAdmin?: boolean;
  /**
   * When true (HR portal), never render the desktop side rail — only top pills.
   * Prevents a second “pages” column beside the HR portal sidebar.
   */
  pillsOnly?: boolean;
}

const fullNavGroups = [
  {
    label: "General",
    items: [
      { id: "general", name: "General", icon: SlidersHorizontal },
      { id: "company-profile", name: "Company Profile", icon: Building2 },
      { id: "email-setup", name: "Email Setup", icon: Mail },
      { id: "razorpay-setup", name: "Razorpay Setup", icon: CreditCard },
      { id: "bank-payment", name: "Bank & QR", icon: QrCode },
      { id: "meta-ads", name: "Meta Ads", icon: Megaphone },
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
      { id: "general", name: "Personal Profile", icon: SlidersHorizontal },
      { id: "password", name: "Password Change", icon: KeyRound },
    ],
  },
];

export function SettingsNav({
  active,
  onChange,
  limited = false,
  showEmailSetup = false,
  showRazorpaySetup = false,
  showMetaAdsSetup = false,
  isSuperAdmin = false,
  pillsOnly = false,
}: SettingsNavProps) {
  const navGroups = (limited ? limitedNavGroups : fullNavGroups).map((group) => ({
    ...group,
    items: group.items
      .filter((item) => {
        if (item.id === "email-setup") return showEmailSetup;
        if (item.id === "razorpay-setup") return showRazorpaySetup;
        if (item.id === "meta-ads") return showMetaAdsSetup;
        return true;
      })
      .map((item) =>
        item.id === "company-profile" && isSuperAdmin
          ? { ...item, name: "Company Details" }
          : item,
      ),
  }));
  const flatItems = navGroups.flatMap((g) => g.items);

  const pills = (
    <div className={cn(pillsOnly ? "-mx-0" : "md:hidden -mx-4 px-4", "overflow-x-auto scrollbar-none")}>
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
  );

  if (pillsOnly) {
    return pills;
  }

  return (
    <>
      {/* Mobile: horizontal section pills */}
      {pills}

      {/* Desktop: side rail — stays put; right panel scrolls */}
      <aside className="hidden md:flex w-[240px] shrink-0 flex-col border-r border-border bg-card px-3 py-4 rounded-l-lg self-stretch">
        <div className="min-h-0 flex-1 overflow-y-auto">
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
                      {item.id === "security" && (
                        <Shield className="ml-auto h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
