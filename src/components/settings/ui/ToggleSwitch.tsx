interface ToggleSwitchProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label?: string;
  size?: "sm" | "md";
}

export function ToggleSwitch({ enabled, onChange, label, size = "md" }: ToggleSwitchProps) {
  const dimensions = size === "sm" ? "h-5 w-9" : "h-6 w-11";
  const knob = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const move = size === "sm" ? "translate-x-4" : "translate-x-5";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className="inline-flex items-center gap-2"
    >
      <span
        className={`relative inline-flex ${dimensions} items-center rounded-full transition-all duration-200 ease-in-out ${
          enabled ? "bg-[#2ed573]" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block ${knob} transform rounded-full bg-white shadow transition-all duration-200 ease-in-out ${
            enabled ? move : "translate-x-0.5"
          }`}
        />
      </span>
      {label && <span className="text-sm text-gray-600">{label}</span>}
    </button>
  );
}
