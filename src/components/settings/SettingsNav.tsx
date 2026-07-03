import {
  Building2,
  Globe,
  ListTree,
  Lock,
  Logs,
  Shield,
  SlidersHorizontal,
  Tags,
  Trash2,
} from "lucide-react";

interface SettingsNavProps {
  active: string;
  onChange: (section: string) => void;
}

const navGroups = [
  {
    label: "General",
    items: [
      { id: "general", name: "General", icon: SlidersHorizontal },
      { id: "company-profile", name: "Company Profile", icon: Building2 },
      { id: "localization", name: "Localization", icon: Globe },
    ],
  },
  {
    label: "CRM Config",
    items: [
      { id: "pipeline-stages", name: "Pipeline Stages", icon: ListTree },
      { id: "tags-labels", name: "Tags & Labels", icon: Tags },
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

export function SettingsNav({ active, onChange }: SettingsNavProps) {
  return (
    <aside className="w-[240px] shrink-0 border-r border-gray-200 bg-white px-3 py-4">
      {navGroups.map((group) => (
        <div key={group.label} className="mt-2">
          <p className="mt-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-[1px] text-gray-400">
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
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-all duration-150 ease-in-out ${
                    isActive
                      ? "border-l-[3px] border-[#2ed573] bg-[#e6faf0] font-medium text-[#0f5230]"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                  {item.id === "security" && <Shield className="ml-auto h-3.5 w-3.5 text-gray-400" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </aside>
  );
}
