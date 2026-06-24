interface SettingsInputProps {
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}

export function SettingsInput({
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
}: SettingsInputProps) {
  return (
    <input
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm transition-all duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#2ed573] focus:ring-offset-1 disabled:cursor-not-allowed disabled:bg-gray-100"
    />
  );
}
