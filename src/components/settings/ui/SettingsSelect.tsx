interface SettingsSelectOption {
  value: string;
  label: string;
}

interface SettingsSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SettingsSelectOption[];
}

export function SettingsSelect({ value, onChange, options }: SettingsSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2ed573] focus:ring-offset-1"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
